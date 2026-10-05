"""
⚙️ 01/10 — Persistance des réglages Live (promotions + mode d'accès), au bon niveau :
 - la SESSION garde ses propres réglages (écriture robuste, vérifiée — plus d'upsert ON CONFLICT muet) ;
 - le COACH garde son dernier réglage ENREGISTRÉ (profiles.live_preferences) → un NOUVEAU Live
   (nouveau code de session) le reprend, au lieu de repartir sur « Avec crédits / aucune promo ».
Faux PostgREST fidèle : playlists SANS contrainte unique (ON CONFLICT → 400/42P10), profiles.
"""
import asyncio
import importlib.util
import os
import sys

import pytest
from fastapi import HTTPException

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")
sys.path.insert(0, os.path.join(ICI, ".."))
import live_promo as LP  # noqa: E402

HOTE, AUTRE = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"


def lancer(coro):
    b = asyncio.new_event_loop()
    try:
        return b.run_until_complete(coro)
    finally:
        b.close(); asyncio.set_event_loop(asyncio.new_event_loop())


class Rep:
    def __init__(self, code, data=None):
        self.status_code, self._d = code, data
        self.content = b"x" if data is not None else b""
        self.text = str(data)

    def json(self):
        return self._d


class Base:
    def __init__(self):
        self.playlists, self.profiles = [], {HOTE: {"id": HOTE}, AUTRE: {"id": AUTRE}}
        self.colonne_prefs = True                      # 05/10 : la migration profiles.live_preferences peut manquer en prod
        self.auth = {HOTE: {"id": HOTE, "app_metadata": {}}, AUTRE: {"id": AUTRE, "app_metadata": {}}}

    def client(self):
        base = self

        def filtre(params, cle):
            v = str((params or {}).get(cle, "")).replace("eq.", "")
            return v

        class C:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False

            async def get(self, url, headers=None, params=None):
                if "/playlists" in url:
                    sid = filtre(params, "session_id")
                    return Rep(200, [dict(r) for r in base.playlists if r["session_id"] == sid])
                if "/profiles" in url:
                    if not base.colonne_prefs and "live_preferences" in str((params or {}).get("select", "")):
                        return Rep(400, {"code": "42703"})                  # colonne inexistante
                    p = base.profiles.get(filtre(params, "id"))
                    return Rep(200, [dict(p)] if p else [])
                if "/auth/v1/admin/users/" in url:
                    u = base.auth.get(url.rsplit("/", 1)[-1])
                    return Rep(200, dict(u)) if u else Rep(404, {})
                return Rep(404, {})

            async def put(self, url, headers=None, params=None, json=None):
                if "/auth/v1/admin/users/" in url:
                    u = base.auth.get(url.rsplit("/", 1)[-1])
                    if not u:
                        return Rep(404, {})
                    u["app_metadata"] = {**u.get("app_metadata", {}), **((json or {}).get("app_metadata") or {})}
                    return Rep(200, dict(u))
                return Rep(404, {})

            async def patch(self, url, headers=None, params=None, json=None):
                if "/playlists" in url:
                    sid = filtre(params, "session_id")
                    lignes = [r for r in base.playlists if r["session_id"] == sid]
                    for r in lignes:
                        r.update(json or {})
                    return Rep(200, [dict(r) for r in lignes])
                if "/profiles" in url:
                    if not base.colonne_prefs and "live_preferences" in (json or {}):
                        return Rep(400, {"code": "PGRST204"})               # colonne inexistante
                    p = base.profiles.get(filtre(params, "id"))
                    if p is not None:
                        p.update(json or {})
                    return Rep(200, [dict(p)] if p else [])
                return Rep(404, {})

            async def post(self, url, headers=None, params=None, json=None):
                if "/playlists" in url:
                    if (params or {}).get("on_conflict"):
                        return Rep(400, {"code": "42P10"})          # aucune contrainte unique
                    base.playlists.append(dict(json))
                    return Rep(201, [dict(json)])
                return Rep(404, {})
        return C


@pytest.fixture()
def m():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x",
                 "SUPABASE_ANON_KEY": "x", "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "k",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_prefs", MAIN)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    base = Base(); mod.httpx.AsyncClient = base.client(); mod._base = base

    async def user(auth):
        return {"Bearer hote": {"id": HOTE, "email": "a@x.ch"}, "Bearer autre": {"id": AUTRE, "email": "b@x.ch"}}[auth]

    async def ptype(uid):
        return "commission" if uid == HOTE else "subscription"

    async def faux(*a, **k):
        return False

    async def coach(uid):
        return True

    async def authz(sid):
        rows = [r for r in base.playlists if r["session_id"] == sid]
        return {"host_id": rows[0].get("host_id")} if rows else None
    mod.get_user_from_token, mod.get_coach_payment_type, mod._lp_hote_super_admin = user, ptype, faux
    mod._est_espace_coach, mod.get_session_authz = coach, authz
    return mod


def test_preferences_pures():
    p = LP.fusionner_preferences({}, {"entree": "private", "prix_chf": 12, "capacite": 5})
    assert p == {"entree": "private", "prix_chf": None, "capacite": None}
    p = LP.fusionner_preferences(p, {"acces": "account"})
    assert p["entree"] == "private" and p["acces"] == "account"
    p = LP.fusionner_preferences(p, {"promo": {"enabled": True, "offres": [{"duree_s": 30, "type": "free"}]}})
    assert p["promo"]["enabled"] is True and p["promo"]["offres"][0]["type"] == "free"
    for mauvais in ({"entree": "x"}, {"acces": "admin"}, {"promo": {"offres": [{"duree_s": 30, "prix": 0}]}}):
        with pytest.raises(LP.RegleRefusee):
            LP.fusionner_preferences({}, mauvais)


def test_mode_d_entree_ecrit_reellement_et_jamais_de_faux_ok(m):
    """ROUGE sur l'ancien code : upsert ON CONFLICT refusé (400) mais réponse ok:true."""
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE, "mode": "open"})
    r = lancer(m.session_configure(m.SessionConfigBody(session_id="LIVE1-AAAA", mode="private"), authorization="Bearer hote"))
    assert r["ok"] is True and m._base.playlists[0]["mode"] == "private"                 # vraiment en base
    assert m._base.profiles[HOTE]["live_preferences"]["entree"] == "private"              # préférence du coach


def test_mode_d_entree_session_absente_inseree(m):
    lancer(m.session_configure(m.SessionConfigBody(session_id="LIVE2-BBBB", mode="private"), authorization="Bearer hote"))
    assert m._base.playlists == [{"session_id": "LIVE2-BBBB", "mode": "private", "price_chf": None, "capacity": None, "host_id": HOTE}]


def test_promotions_memorisees_puis_reprises_dans_un_nouveau_live_vierge(m):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []})
    corps = m.LivePromoConfigBody(session_id="LIVE1-AAAA", enabled=True,
                                  offres=[{"id": "", "duree_s": 30, "type": "free"}, {"id": "", "duree_s": 60, "prix": 10}])
    lancer(m.live_promo_save_config(corps, authorization="Bearer hote"))
    prefs = m._base.profiles[HOTE]["live_preferences"]["promo"]
    assert prefs["enabled"] is True and [(o["duree_s"], o["type"]) for o in prefs["offres"]] == [(30, "free"), (60, "paid")]
    # le coach quitte, revient plus tard : NOUVEAU Live (nouveau code), jamais réglé
    m._base.playlists.append({"session_id": "LIVE9-ZZZZ", "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []})
    r = lancer(m.live_promo_appliquer_preferences(m.LivePromoAppliquerBody(session_id="LIVE9-ZZZZ"), authorization="Bearer hote"))
    assert r["applique"] is True
    vu = lancer(m.live_promo_config("LIVE9-ZZZZ", authorization=None))                                     # ce que voient les participants
    assert vu["enabled"] is True and [(o["duree_s"], o["type"]) for o in vu["offres"]] == [(30, "free"), (60, "paid")]


def test_un_live_deja_regle_n_est_jamais_ecrase_par_les_preferences(m):
    m._base.profiles[HOTE]["live_preferences"] = {"promo": {"enabled": True, "offres": [{"id": "a", "duree_s": 30, "prix": 0, "actif": True, "type": "free"}]}}
    m._base.playlists.append({"session_id": "LIVE3-CCCC", "host_id": HOTE, "live_promo_enabled": True,
                              "live_promo_offres": [{"id": "b", "duree_s": 90, "prix": 25, "actif": True, "type": "paid"}]})
    r = lancer(m.live_promo_appliquer_preferences(m.LivePromoAppliquerBody(session_id="LIVE3-CCCC"), authorization="Bearer hote"))
    assert r["applique"] is False and m._base.playlists[0]["live_promo_offres"][0]["duree_s"] == 90


def test_un_autre_compte_n_applique_rien_sur_le_live_d_un_coach(m):
    m._base.playlists.append({"session_id": "LIVE4-DDDD", "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []})
    with pytest.raises(HTTPException) as e:
        lancer(m.live_promo_appliquer_preferences(m.LivePromoAppliquerBody(session_id="LIVE4-DDDD"), authorization="Bearer autre"))
    assert e.value.status_code == 403


def test_droits_des_invites_memorises_et_relus(m):
    lancer(m.coach_preferences_live_maj(m.PreferencesLiveBody(acces="account"), authorization="Bearer hote"))
    assert lancer(m.coach_preferences_live(authorization="Bearer hote"))["preferences"]["acces"] == "account"
    assert lancer(m.coach_preferences_live(authorization="Bearer autre"))["preferences"] == {}          # isolé par coach
    with pytest.raises(HTTPException):
        lancer(m.coach_preferences_live_maj(m.PreferencesLiveBody(acces="admin"), authorization="Bearer hote"))


# ─── 05/10 — CONFIGURATION LIVE NON MÉMORISÉE (Gratuit + Accès visio → « Avec crédits » au retour) ───
# Deux pannes que l'ancien code ne voyait pas : `update_profile` ne fait que JOURNALISER un échec,
# donc colonne absente ou ligne `profiles` absente = préférence perdue avec une réponse « ok ».
# Et la reprise côté navigateur n'avait lieu que si `access_mode` était VIDE sur le nouveau Live.

def _choisir_gratuit_visio(m, sid="LIVE1-AAAA"):
    m._base.playlists.append({"session_id": sid, "host_id": HOTE, "mode": "open", "access_mode": "account"})
    lancer(m.session_configure(m.SessionConfigBody(session_id=sid, mode="private"), authorization="Bearer hote"))
    lancer(m.coach_preferences_live_maj(m.PreferencesLiveBody(acces="account", session_id=sid), authorization="Bearer hote"))


def _nouveau_live(m, sid="LIVE2-BBBB"):
    # Nouveau Live : la ligne existe déjà avec des VALEURS PAR DÉFAUT (mode open, access_mode posé).
    m._base.playlists.append({"session_id": sid, "host_id": HOTE, "mode": "open", "access_mode": "guest"})
    return lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id=sid), authorization="Bearer hote"))


def _ligne(m, sid):
    return next(r for r in m._base.playlists if r["session_id"] == sid)


@pytest.mark.parametrize("panne", ["aucune", "colonne_absente", "ligne_profiles_absente"])
def test_gratuit_et_acces_visio_repris_au_prochain_live(m, panne):
    if panne == "colonne_absente":
        m._base.colonne_prefs = False
    if panne == "ligne_profiles_absente":
        del m._base.profiles[HOTE]
    _choisir_gratuit_visio(m)
    assert lancer(m.coach_preferences_live(authorization="Bearer hote"))["preferences"]["entree"] == "private"
    r = _nouveau_live(m)
    assert r["applique"] is True and r["entree"] == "private" and r["acces"] == "account"
    assert _ligne(m, "LIVE2-BBBB")["mode"] == "private" and _ligne(m, "LIVE2-BBBB")["access_mode"] == "account"


def test_avec_credits_et_ecoute_memorises_si_choisis(m):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE, "mode": "private"})
    lancer(m.session_configure(m.SessionConfigBody(session_id="LIVE1-AAAA", mode="open"), authorization="Bearer hote"))
    lancer(m.coach_preferences_live_maj(m.PreferencesLiveBody(acces="guest", session_id="LIVE1-AAAA"), authorization="Bearer hote"))
    m._base.playlists.append({"session_id": "LIVE2-BBBB", "host_id": HOTE, "mode": "private", "access_mode": "account"})
    r = lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE2-BBBB"), authorization="Bearer hote"))
    assert r["applique"] is True and _ligne(m, "LIVE2-BBBB")["mode"] == "open" and _ligne(m, "LIVE2-BBBB")["access_mode"] == "guest"


def test_un_live_regle_dans_cette_session_n_est_jamais_ecrase(m):
    _choisir_gratuit_visio(m)
    # Le coach rouvre LE MÊME Live (refresh, retour) : son réglage propre reste, rien n'est réécrit.
    r = lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE1-AAAA"), authorization="Bearer hote"))
    assert r["applique"] is False and _ligne(m, "LIVE1-AAAA")["mode"] == "private"
    # Un 2e Live réglé à la main sur « Avec crédits » garde « Avec crédits » au retour.
    m._base.playlists.append({"session_id": "LIVE5-EEEE", "host_id": HOTE, "mode": "private"})
    lancer(m.session_configure(m.SessionConfigBody(session_id="LIVE5-EEEE", mode="open"), authorization="Bearer hote"))
    lancer(m.session_configure(m.SessionConfigBody(session_id="LIVE1-AAAA", mode="private"), authorization="Bearer hote"))
    r = lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE5-EEEE"), authorization="Bearer hote"))
    assert r["applique"] is False and _ligne(m, "LIVE5-EEEE")["mode"] == "open"


def test_appliquer_reserve_a_l_hote_du_live(m):
    _choisir_gratuit_visio(m)
    m._base.playlists.append({"session_id": "LIVE3-CCCC", "host_id": AUTRE, "mode": "open"})
    with pytest.raises(HTTPException) as e:
        lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE3-CCCC"), authorization="Bearer hote"))
    assert e.value.status_code == 403 and _ligne(m, "LIVE3-CCCC")["mode"] == "open"


def test_promo_reprise_meme_sans_colonne_profiles(m):
    m._base.colonne_prefs = False
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []})
    lancer(m.live_promo_save_config(m.LivePromoConfigBody(session_id="LIVE1-AAAA", enabled=True,
                                    offres=[{"id": "", "duree_s": 30, "type": "free"}]), authorization="Bearer hote"))
    m._base.playlists.append({"session_id": "LIVE9-ZZZZ", "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []})
    r = lancer(m.live_promo_appliquer_preferences(m.LivePromoAppliquerBody(session_id="LIVE9-ZZZZ"), authorization="Bearer hote"))
    assert r["applique"] is True and lancer(m.live_promo_config("LIVE9-ZZZZ", authorization=None))["enabled"] is True
