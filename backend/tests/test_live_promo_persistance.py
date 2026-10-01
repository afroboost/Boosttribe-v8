"""
📣 01/10 — « Faire ma promo » ABSENT en production : la config de la session n'était pas en base.

Mesure prod (sessions Live réelles du 01/10, dont D4T93R7U-MRP2PD à 07:32 UTC, après l'enregistrement
automatique) : /live-promo/config → {"enabled": false, "offres": []}. Le banc historique REMPLACE
`_lp_session` et `upsert_playlist_fields` par des doubles : la vraie écriture n'était jamais testée.

Ce banc parle à un FAUX PostgREST fidèle à une table `playlists` SANS contrainte unique sur
`session_id` (cas déjà rencontré par le projet, cf. saveAccessMode « avec doublons ») :
  - POST …?on_conflict=session_id → 400 / 42P10 (aucune contrainte ne correspond) ;
  - deux lignes pour la même session (doublon), dont une plus ancienne sans host_id.
Attendu : l'hôte enregistre « activé + 30 s / 10 CHF » ; le participant LIT exactement cela.
"""
import asyncio
import importlib.util
import os
import sys
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")
sys.path.insert(0, os.path.join(ICI, ".."))

HOTE = "11111111-1111-1111-1111-111111111111"
SID = "D4T93R7U-MRP2PD"


def lancer(coro):
    boucle = asyncio.new_event_loop()
    try:
        return boucle.run_until_complete(coro)
    finally:
        boucle.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x",
                 "SUPABASE_ANON_KEY": "x", "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "k",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_lp_persist", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Rep:
    def __init__(self, code, data=None):
        self.status_code, self._d = code, data
        self.content = b"x" if data is not None else b""
        self.text = str(data)

    def json(self):
        return self._d


class FauxPostgrest:
    """Table playlists SANS contrainte unique : ON CONFLICT refusé, doublons possibles."""

    def __init__(self, lignes):
        self.lignes = lignes

    def _filtre(self, params):
        sid = str((params or {}).get("session_id", "")).replace("eq.", "")
        return [r for r in self.lignes if r["session_id"] == sid]

    def client(self):
        base = self

        class C:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url, headers=None, params=None):
                if "/rest/v1/playlists" not in url:
                    return Rep(404, {})
                rows = base._filtre(params)
                if str((params or {}).get("order", "")).startswith("updated_at.desc"):
                    rows = sorted(rows, key=lambda r: r.get("updated_at") or "", reverse=True)
                return Rep(200, [dict(r) for r in rows])

            async def post(self, url, headers=None, params=None, json=None):
                if "/rest/v1/playlists" in url and (params or {}).get("on_conflict"):
                    return Rep(400, {"code": "42P10", "message": "there is no unique or exclusion constraint matching the ON CONFLICT specification"})
                return Rep(404, {})

            async def patch(self, url, headers=None, params=None, json=None):
                if "/rest/v1/playlists" not in url:
                    return Rep(404, {})
                rows = base._filtre(params)
                for r in rows:
                    r.update(json or {})
                return Rep(200, [dict(r) for r in rows])

        return C


def monde(lignes):
    m = charger_main()
    pg = FauxPostgrest(lignes)
    m.httpx.AsyncClient = pg.client()

    async def user(auth):
        if auth == "Bearer hote":
            return {"id": HOTE, "email": "coach-a@x.ch"}
        if auth == "Bearer coachB":
            return {"id": "99999999-9999-9999-9999-999999999999", "email": "coach-b@x.ch"}
        raise HTTPException(status_code=401, detail="Token invalide")

    async def ptype(uid):
        return "commission" if uid == HOTE else "subscription"

    async def pas_admin(uid):
        return False
    m.get_user_from_token = user
    m.get_coach_payment_type = ptype

    async def coach(uid):
        return uid == HOTE                         # 01/10 : l'hôte du banc est un Espace Coach
    m._est_espace_coach = coach
    m._lp_hote_super_admin = pas_admin
    return m, pg


def enregistrer(m, jeton="Bearer hote"):
    corps = m.LivePromoConfigBody(session_id=SID, enabled=True, offres=[{"id": "", "duree_s": 30, "prix": 10, "actif": True}])
    return lancer(m.live_promo_save_config(corps, authorization=jeton))


def test_rouge_table_sans_contrainte_unique_la_config_arrive_chez_le_participant():
    m, pg = monde([{"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": [], "updated_at": "2026-10-01T07:32:19"}])
    r = enregistrer(m)
    assert r["ok"] is True
    vu = lancer(m.live_promo_config(SID))                      # ce que lit le participant (coach B compris)
    assert vu["enabled"] is True
    assert [(o["duree_s"], o["prix"]) for o in vu["offres"]] == [(30, 10.0)]


def test_doublon_de_ligne_toutes_les_lignes_de_la_session_portent_la_config():
    m, pg = monde([
        {"session_id": SID, "host_id": None, "live_promo_enabled": False, "live_promo_offres": [], "updated_at": "2026-10-01T07:30:00"},
        {"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": [], "updated_at": "2026-10-01T07:32:19"},
    ])
    enregistrer(m)
    assert all(l["live_promo_enabled"] is True and len(l["live_promo_offres"]) == 1 for l in pg.lignes)
    vu = lancer(m.live_promo_config(SID))
    assert vu["enabled"] is True and len(vu["offres"]) == 1
    # la ligne qui fait foi pour l'hôte est celle qui PORTE un host_id
    assert lancer(m._lp_session(SID))["host_id"] == HOTE


def test_coach_b_non_hote_ne_peut_pas_enregistrer_la_config_de_a():
    m, pg = monde([{"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []}])
    try:
        enregistrer(m, "Bearer coachB")
        raise AssertionError("coach B ne doit pas écrire la config de A")
    except HTTPException as e:
        assert e.status_code == 403
    assert pg.lignes[0]["live_promo_enabled"] is False


def test_session_inexistante_aucune_ligne_creee():
    m, pg = monde([])
    try:
        enregistrer(m)
        raise AssertionError("404 attendu")
    except HTTPException as e:
        assert e.status_code == 404
    assert pg.lignes == []


def test_est_hote_dit_par_le_serveur_jamais_le_role_global():
    m, pg = monde([{"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []}])
    enregistrer(m)
    assert lancer(m.live_promo_config(SID, authorization="Bearer hote"))["est_hote"] is True          # CAS A
    vu_b = lancer(m.live_promo_config(SID, authorization="Bearer coachB"))                            # CAS C
    assert vu_b["est_hote"] is False and vu_b["enabled"] is True and len(vu_b["offres"]) == 1
    assert lancer(m.live_promo_config(SID, authorization="Bearer inconnu"))["est_hote"] is None      # jeton invalide : lecture publique
    assert lancer(m.live_promo_config(SID, authorization=None))["est_hote"] is None


def _sauver(m, offres, enabled=True, jeton="Bearer hote"):
    return lancer(m.live_promo_save_config(m.LivePromoConfigBody(session_id=SID, enabled=enabled, offres=offres), authorization=jeton))


def test_tarif_creation_relecture_modification_activation_suppression():
    m, pg = monde([{"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []}])
    r = _sauver(m, [{"id": "", "duree_s": 30, "prix": 10, "actif": True}])
    oid = r["offres"][0]["id"]
    assert oid                                                                     # id attribué par le serveur
    relu = lancer(m.live_promo_host_config(SID, authorization="Bearer hote"))       # « reload » : tout état front oublié
    assert relu["enabled"] is True and relu["offres"] == [{"id": oid, "duree_s": 30, "prix": 10.0, "actif": True, "type": "paid"}]
    # modification avec l'id RENVOYÉ par le serveur → même tarif, jamais un second
    _sauver(m, [{"id": oid, "duree_s": 30, "prix": 15, "actif": True}])
    relu = lancer(m.live_promo_host_config(SID, authorization="Bearer hote"))["offres"]
    assert relu == [{"id": oid, "duree_s": 30, "prix": 15.0, "actif": True, "type": "paid"}]
    # désactivation : conservé pour l'hôte, invisible des participants
    _sauver(m, [{"id": oid, "duree_s": 30, "prix": 15, "actif": False}])
    assert lancer(m.live_promo_host_config(SID, authorization="Bearer hote"))["offres"][0]["actif"] is False
    assert lancer(m.live_promo_config(SID))["offres"] == []
    # suppression
    _sauver(m, [])
    assert lancer(m.live_promo_host_config(SID, authorization="Bearer hote"))["offres"] == []


def test_super_admin_hote_enregistre_ses_tarifs():
    m, pg = monde([{"session_id": SID, "host_id": HOTE, "live_promo_enabled": False, "live_promo_offres": []}])

    async def ptype(uid):
        return "subscription"                    # hors commission…

    async def admin(uid):
        return uid == HOTE                       # …mais super-admin → mode super_admin (paiement réel depuis 01/10)
    m.get_coach_payment_type, m._lp_hote_super_admin = ptype, admin
    _sauver(m, [{"id": "", "duree_s": 30, "prix": 10, "actif": True}])
    vu = lancer(m.live_promo_config(SID, authorization="Bearer coachB"))
    assert vu["enabled"] is True and vu["est_hote"] is False
    assert vu["paiement_reel"] is True                    # 01/10 partie B : super-admin hôte = paiement réel
    assert [(o["duree_s"], o["prix"]) for o in vu["offres"]] == [(30, 10.0)]
