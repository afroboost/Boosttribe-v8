"""
🎥💳 ACCÈS VIDÉO ET VENTE D'UN LIVE — ce que le SERVEUR autorise vraiment.

Écrit après l'audit du 22/09/2026, qui a montré deux choses contre-intuitives :

1. Le serveur vidéo n'a JAMAIS bloqué les participants. `/livekit/token` en rôle `viewer`
   accepte une jonction anonyme et accorde `can_subscribe`. Le participant qui ne voyait
   pas la caméra était arrêté côté NAVIGATEUR, pas ici. Ce banc fige cette frontière : si
   un jour quelqu'un « corrige » le bug en ouvrant le rôle `stage`, il le saura tout de suite.

2. Vendre un Live EXISTE déjà (prix, capacité, billet, commission, portefeuille, virement),
   mais c'est réservé aux coachs en mode `commission`. En mode `subscription` — le défaut —
   le serveur REFUSE une session payante. Ce banc mesure la règle telle qu'elle est ; il ne
   la change pas, et il ne touche NI Stripe NI aucun compte réel (doubles partout).

Lancer : python3 -m pytest backend/tests/test_live_acces_et_vente.py -q
"""
import asyncio
import importlib.util
import os
import sys
import types

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

def executer(coro):
    """Exécute une coroutine SANS casser la boucle des bancs voisins.

    `asyncio.run` ferme la boucle ET laisse la politique sans boucle courante : sur
    Python 3.9, les bancs suivants tombaient alors sur « There is no current event loop ».
    On en ouvre une, on la referme, et on en repose une neuve derrière soi.
    """
    boucle = asyncio.new_event_loop()
    try:
        return boucle.run_until_complete(coro)
    finally:
        boucle.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle-test",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256",
                 "LIVEKIT_URL": "wss://sfu.test", "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_acces_vente", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def appli(monkeypatch):
    m = charger_main()

    # ── Doubles : aucune base, aucun réseau, aucun Stripe ──────────────────────
    etat = {
        "sessions": {},                       # session_id -> ligne `playlists`
        "payment_type": {"uid-coach": "subscription", "uid-commission": "commission"},
        "illimite": set(),
        "billets": set(),                     # (session_id, uid)
        "publishers": 0,
    }

    async def faux_user(authorization):
        if authorization == "Bearer coach":
            return {"id": "uid-coach", "email": "coach@example.com", "user_metadata": {"full_name": "Coach Bassi"}}
        if authorization == "Bearer commission":
            return {"id": "uid-commission", "email": "vendeur@example.com", "user_metadata": {}}
        if authorization == "Bearer autre":
            return {"id": "uid-autre", "email": "autre@example.com", "user_metadata": {}}
        raise HTTPException(status_code=401, detail="Token manquant")

    async def faux_optional(authorization):
        try:
            return await faux_user(authorization)
        except HTTPException:
            return None

    async def faux_row(session_id):
        return etat["sessions"].get(session_id)

    async def faux_authz(session_id):
        return etat["sessions"].get(session_id)

    async def faux_upsert(session_id, patch):
        etat["sessions"].setdefault(session_id, {"session_id": session_id}).update(patch)
        return True

    async def faux_payment_type(uid):
        return etat["payment_type"].get(uid, "subscription")

    async def faux_settings():
        return {"currency": "CHF", "price_min_chf": 5, "price_max_chf": 500,
                "commission_percent": 15, "coach_sub_price_chf": 99.99, "fees_included": True}

    async def faux_illimite(uid):
        return uid in etat["illimite"]

    async def faux_wallet(uid):
        return {"user_id": uid, "balance_chf": 0, "total_earned_chf": 0}

    async def faux_count_tickets(session_id):
        return len([1 for (s, _u) in etat["billets"] if s == session_id])

    async def faux_has_ticket(session_id, uid):
        return (session_id, uid) in etat["billets"]

    async def faux_publishers(session_id):
        return etat["publishers"]

    # Le SDK serveur LiveKit n'est pas installé sur un poste de dev (et ce banc ne le
    # teste pas) : on le remplace par un double qui rend les GRANTS lisibles. C'est
    # justement ce qu'on veut vérifier — `can_publish` / `can_subscribe`.
    class _Grants(dict):
        def __init__(self, **kw): super().__init__(**kw)

    class _Token:
        def __init__(self, *_a): self.claims = {}
        def with_identity(self, v): self.claims["identity"] = v; return self
        def with_name(self, v): self.claims["name"] = v; return self
        def with_grants(self, g): self.claims["grants"] = dict(g); return self
        def with_ttl(self, v): self.claims["ttl"] = str(v); return self
        def to_jwt(self): return "jeton-factice:" + repr(sorted(self.claims["grants"].items()))

    faux_sdk = types.SimpleNamespace(VideoGrants=_Grants, AccessToken=_Token)
    monkeypatch.setattr(m, "livekit_api", faux_sdk)

    async def faux_demande_approuvee(session_id, uid):
        return False

    async def faux_demande_par_id(session_id, request_id):
        return False

    monkeypatch.setattr(m, "_has_approved_access_request", faux_demande_approuvee)
    monkeypatch.setattr(m, "_access_request_approved_by_id", faux_demande_par_id)
    monkeypatch.setattr(m, "get_user_from_token", faux_user)
    monkeypatch.setattr(m, "_optional_user", faux_optional)
    monkeypatch.setattr(m, "get_session_row", faux_row)
    monkeypatch.setattr(m, "get_session_authz", faux_authz)
    monkeypatch.setattr(m, "upsert_playlist_fields", faux_upsert)
    monkeypatch.setattr(m, "get_coach_payment_type", faux_payment_type)
    monkeypatch.setattr(m, "get_commission_settings", faux_settings)
    monkeypatch.setattr(m, "is_coach_unlimited", faux_illimite)
    monkeypatch.setattr(m, "get_coach_wallet", faux_wallet)
    monkeypatch.setattr(m, "count_paid_tickets", faux_count_tickets)
    monkeypatch.setattr(m, "has_valid_ticket", faux_has_ticket)
    monkeypatch.setattr(m, "_count_livekit_publishers", faux_publishers)
    # `main.py` partage le module `multistream` avec les autres bancs : le recharger ici
    # écrase son état global. On le remet à neuf, exactement comme le fait
    # `test_broadcast_routes_verrou` — sinon ce banc ferait rougir le voisin.
    ms = sys.modules.get("multistream") or getattr(m, "_ms", None)
    if ms is not None:
        ms.reinitialiser_pour_tests()
        ms.definir_moteur(None)
    yield m, etat, TestClient(m.app)
    if ms is not None:
        ms.reinitialiser_pour_tests()
        ms.definir_moteur(None)


# ══════════════ 1. LA VIDÉO : où le serveur dit oui, où il dit non ══════════════

def test_viewer_anonyme_autorise_a_sabonner(appli):
    """Le blocage du participant n'a jamais été ici : un anonyme peut s'abonner."""
    m, _etat, client = appli
    r = client.post("/livekit/token", json={"session_id": "SESS-TEST", "identity": "user_1", "role": "viewer"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "viewer" and d["url"] == "wss://sfu.test" and d["identity"] == "user_1"
    # LA preuve : le spectateur anonyme PEUT s'abonner, il ne peut simplement pas publier.
    assert "('can_subscribe', True)" in d["token"] and "('can_publish', False)" in d["token"]
    assert "('room', 'SESS-TEST')" in d["token"] and "('room_join', True)" in d["token"]


def test_stage_exige_une_identite_puis_l_autorite(appli):
    """Publier = être l'hôte/co-hôte enregistré. Sans jeton : 401. Sans autorité : 403."""
    m, etat, client = appli
    sans = client.post("/livekit/token", json={"session_id": "SESS-TEST", "identity": "user_1", "role": "stage"})
    assert sans.status_code == 401

    # Authentifié mais la session appartient à quelqu'un d'autre → refus explicite.
    etat["sessions"]["SESS-TEST"] = {"session_id": "SESS-TEST", "host_id": "uid-autre", "cohosts": []}
    r = client.post("/livekit/token", headers={"Authorization": "Bearer coach"},
                    json={"session_id": "SESS-TEST", "identity": "user_1", "role": "stage"})
    assert r.status_code == 403 and r.json()["detail"] == "stage_reserved_to_host"

    # C'est bien ce 403 que le navigateur transformait en spectateur silencieux.
    etat["sessions"]["SESS-TEST"]["host_id"] = "uid-coach"
    ok = client.post("/livekit/token", headers={"Authorization": "Bearer coach"},
                     json={"session_id": "SESS-TEST", "identity": "user_1", "role": "stage"})
    assert ok.status_code == 200 and ok.json()["role"] == "stage"
    assert "('can_publish', True)" in ok.json()["token"]


def test_scene_pleine_est_un_409_annonce(appli):
    """Dégradation LÉGITIME (l'écran la nomme) — à ne pas confondre avec un refus muet."""
    m, etat, client = appli
    etat["sessions"]["SESS-TEST"] = {"session_id": "SESS-TEST", "host_id": "uid-coach", "cohosts": []}
    etat["publishers"] = m.MAX_LIVEKIT_STAGE
    r = client.post("/livekit/token", headers={"Authorization": "Bearer coach"},
                    json={"session_id": "SESS-TEST", "identity": "user_1", "role": "stage"})
    assert r.status_code == 409 and r.json()["detail"] == "stage_full"


def test_le_nom_affiche_vient_du_profil_afroboost(appli):
    """`user_metadata.full_name` — celui que le pont d'intégration écrit — fait foi."""
    m, etat, client = appli
    etat["sessions"]["SESS-TEST"] = {"session_id": "SESS-TEST", "host_id": "uid-coach", "cohosts": []}
    r = client.post("/livekit/token", headers={"Authorization": "Bearer coach"},
                    json={"session_id": "SESS-TEST", "identity": "user_1", "name": "ignoré", "role": "stage"})
    assert r.status_code == 200
    assert m._clean_name({"full_name": "Coach Bassi"}.get("full_name"), "user_1") == "Coach Bassi"


# ══════════════ 2. LES MODES D'ACCÈS, TELS QU'ILS SONT ══════════════

def test_session_inconnue_est_ouverte_donc_payante_en_credits(appli):
    """Le DÉFAUT est `open` : tout lien partagé tombe sur le paywall crédits."""
    _m, _etat, client = appli
    d = client.get("/session/info/SESS-INCONNUE").json()
    assert d["mode"] == "open" and d["price_chf"] is None and d["sold_out"] is False


def test_private_est_gratuit_et_paid_expose_prix_capacite_et_complet(appli):
    _m, etat, client = appli
    etat["sessions"]["SESS-PRIV"] = {"session_id": "SESS-PRIV", "mode": "private"}
    d = client.get("/session/info/SESS-PRIV").json()
    assert d["mode"] == "private" and d["price_chf"] is None and d["sold"] == 0

    etat["sessions"]["SESS-PAID"] = {"session_id": "SESS-PAID", "mode": "paid", "price_chf": 25.0, "capacity": 2}
    d = client.get("/session/info/SESS-PAID").json()
    assert d["mode"] == "paid" and d["price_chf"] == 25.0 and d["capacity"] == 2 and d["sold_out"] is False
    etat["billets"].update({("SESS-PAID", "a"), ("SESS-PAID", "b")})
    assert client.get("/session/info/SESS-PAID").json()["sold_out"] is True


# ══════════════ 3. VENDRE UN LIVE : la règle existante, mesurée ══════════════

def test_mode_payant_refuse_en_abonnement_accepte_en_commission(appli):
    """C'est CE 403 qui masque l'option « Payante (billet CHF) » dans l'écran du coach."""
    _m, etat, client = appli
    etat["sessions"]["SESS-V"] = {"session_id": "SESS-V", "host_id": "uid-coach", "cohosts": []}
    r = client.post("/session/configure", headers={"Authorization": "Bearer coach"},
                    json={"session_id": "SESS-V", "mode": "paid", "price_chf": 25})
    assert r.status_code == 403 and "commission" in r.json()["detail"]

    etat["sessions"]["SESS-C"] = {"session_id": "SESS-C", "host_id": "uid-commission", "cohosts": []}
    ok = client.post("/session/configure", headers={"Authorization": "Bearer commission"},
                     json={"session_id": "SESS-C", "mode": "paid", "price_chf": 25, "capacity": 30})
    assert ok.status_code == 200 and ok.json() == {"ok": True, "mode": "paid", "price_chf": 25.0, "capacity": 30}


def test_le_prix_reste_dans_les_bornes_et_seul_l_hote_configure(appli):
    _m, etat, client = appli
    etat["sessions"]["SESS-C"] = {"session_id": "SESS-C", "host_id": "uid-commission", "cohosts": []}
    h = {"Authorization": "Bearer commission"}
    assert client.post("/session/configure", headers=h,
                       json={"session_id": "SESS-C", "mode": "paid", "price_chf": 4}).status_code == 400
    assert client.post("/session/configure", headers=h,
                       json={"session_id": "SESS-C", "mode": "paid", "price_chf": 501}).status_code == 400
    assert client.post("/session/configure", headers=h,
                       json={"session_id": "SESS-C", "mode": "paid"}).status_code == 400   # prix requis
    # Un autre compte ne reconfigure pas la session de quelqu'un.
    assert client.post("/session/configure", headers={"Authorization": "Bearer autre"},
                       json={"session_id": "SESS-C", "mode": "private"}).status_code == 403
    # Repasser en gratuit efface prix et capacité.
    assert client.post("/session/configure", headers=h,
                       json={"session_id": "SESS-C", "mode": "private"}).json()["price_chf"] is None


def test_commission_quinze_pourcent_et_zero_pour_un_illimite(appli):
    m, etat, _client = appli
    c = executer(m.compute_commission(100.0, "uid-commission"))
    assert c == {"percent": 15.0, "commission_chf": 15.0, "net_chf": 85.0, "fees_included": True}
    etat["illimite"].add("uid-commission")
    c0 = executer(m.compute_commission(100.0, "uid-commission"))
    assert c0["percent"] == 0.0 and c0["net_chf"] == 100.0


def test_reglages_publics_de_la_billetterie(appli):
    _m, _etat, client = appli
    d = client.get("/billetterie/config").json()
    assert d == {"currency": "CHF", "price_min_chf": 5, "price_max_chf": 500,
                 "commission_percent": 15, "coach_sub_price_chf": 99.99}


def test_un_billet_valide_ouvre_l_acces_sans_aucun_stripe(appli):
    """Accès APRÈS billet, vérifié par la route existante — aucun paiement déclenché."""
    _m, etat, client = appli
    etat["sessions"]["SESS-C"] = {"session_id": "SESS-C", "mode": "paid", "price_chf": 25.0,
                                  "host_id": "uid-commission", "cohosts": []}
    avant = client.get("/tickets/check/SESS-C", headers={"Authorization": "Bearer autre"}).json()
    assert avant == {"has_ticket": False}
    etat["billets"].add(("SESS-C", "uid-autre"))
    apres = client.get("/tickets/check/SESS-C", headers={"Authorization": "Bearer autre"}).json()
    assert apres == {"has_ticket": True}


def test_portefeuille_et_virement_existent_bien(appli):
    """Le coach a un solde et un chemin de virement : ce lot ne les crée pas, il les constate."""
    m, _etat, _client = appli
    chemins = {r.path for r in m.app.routes}
    for attendu in ("/coach/wallet", "/coach/payout-request", "/admin/payouts", "/tickets/buy"):
        assert attendu in chemins, attendu
