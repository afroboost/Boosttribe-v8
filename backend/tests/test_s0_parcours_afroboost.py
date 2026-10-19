"""
🛡️ S0 — NON-RÉGRESSION DU PARCOURS AFROBOOST → LIVE (écrit AVANT toute modification S0).

Règle produit absolue : un abonné qui arrive d'afroboost.com
  jeton Afroboost signé → /api/embed/verify → accès « pro » (comp_access) 12 h
  → AUCUN crédit BoostTribe consommé pendant ces 12 h (join, host, enregistrement)
  → la séance est débitée côté Afroboost (/api/boosttribe/consume, idempotent sur jti)
  → après 12 h : retour au fonctionnement BoostTribe normal (crédits).

A-D figent ce qui marche aujourd'hui. E et F décrivent les deux défauts relevés par
l'audit du 19/10 (rétrogradation d'un plan existant, accès sans verdict d'Afroboost).

Aucun réseau : faux Supabase + faux Afroboost (tests/s0_faux_supabase.py).
Lancer : python3 -m pytest backend/tests/test_s0_parcours_afroboost.py -q
"""
import asyncio
import importlib.util
import os
import sys
import time
import types
import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s0_faux_supabase import AFROBOOST_CONSUME, SUPABASE, FauxSupabase  # noqa: E402

SECRET_AFRO = "secret-partage-afroboost-de-test-sans-rapport-avec-la-prod"
ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def executer(coro):
    boucle = asyncio.new_event_loop()
    try:
        return boucle.run_until_complete(coro)
    finally:
        boucle.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def charger_main():
    for k, v in {"SUPABASE_URL": SUPABASE, "SUPABASE_SERVICE_ROLE_KEY": "service-test", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle-test",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com", "AFRO_BT_SHARED_SECRET": SECRET_AFRO,
                 "AFROBOOST_CONSUME_URL": AFROBOOST_CONSUME}.items():
        os.environ[k] = v
    spec = importlib.util.spec_from_file_location("btmain_s0_afro_%s" % uuid.uuid4().hex[:6], MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def faux_livekit(monkeypatch, m):
    class _Grants(dict):
        def __init__(self, **kw): super().__init__(**kw)

    class _Token:
        def __init__(self, *_a): self.claims = {}
        def with_identity(self, v): self.claims["identity"] = v; return self
        def with_name(self, v): self.claims["name"] = v; return self
        def with_grants(self, g): self.claims["grants"] = dict(g); return self
        def with_ttl(self, v): return self
        def to_jwt(self): return "jeton-factice:" + repr(sorted(self.claims["grants"].items()))

    monkeypatch.setattr(m, "livekit_api", types.SimpleNamespace(VideoGrants=_Grants, AccessToken=_Token))

    async def zero(_sid):
        return 0
    monkeypatch.setattr(m, "_count_livekit_publishers", zero)


@pytest.fixture()
def banc(monkeypatch):
    m = charger_main()
    sb = FauxSupabase()
    sb.brancher(monkeypatch, m)
    faux_livekit(monkeypatch, m)
    ms = sys.modules.get("multistream")
    if ms is not None:
        ms.reinitialiser_pour_tests()
        ms.definir_moteur(None)
    yield m, sb, TestClient(m.app)
    if ms is not None:
        ms.reinitialiser_pour_tests()
        ms.definir_moteur(None)


def jeton_afroboost(email, jti=None, minutes=15):
    jti = jti or uuid.uuid4().hex
    return pyjwt.encode({"iss": "afroboost", "aud": "boosttribe", "sub": email, "email": email, "name": "Membre",
                         "free": True, "jti": jti, "exp": int(time.time()) + minutes * 60},
                        SECRET_AFRO, algorithm="HS256"), jti


def entrer_par_afroboost(sb, client, email="membre@exemple.test", jeton_bt="membre"):
    tok, jti = jeton_afroboost(email)
    r = client.post("/api/embed/verify", json={"token": tok})
    assert r.status_code == 200, r.text
    uid = next(u for u, x in sb.users.items() if x["email"] == email)
    sb.tokens["Bearer " + jeton_bt] = uid       # le magic-link a connecté le membre : il a un JWT Supabase
    return uid, tok, jti


def session(sb, sid, host_id, mode="open", access_mode="account"):
    sb.tables["playlists"].append({"session_id": sid, "host_id": host_id, "cohosts": [], "mode": mode,
                                   "access_mode": access_mode, "price_chf": None, "capacity": None,
                                   "record_enabled": False, "live_ended_at": None})


def dans(heures):
    return (datetime.now(timezone.utc) + timedelta(hours=heures)).isoformat()


# ═══════════════════════ A. accès Afroboost : Live accessible, 0 crédit BT ═══════════════════════

def test_A_membre_afroboost_entre_sans_credit_bt(banc):
    m, sb, client = banc
    coach = sb.utilisateur("coach@exemple.test", "coach", coach_payment_type="commission")
    session(sb, "SESS-AFRO", coach)
    uid, _tok, _jti = entrer_par_afroboost(sb, client)

    p = sb.profil(uid)
    assert p["comp_access_plan"] == "pro"
    fin = datetime.fromisoformat(p["comp_access_until"])
    assert timedelta(hours=11, minutes=59) < fin - datetime.now(timezone.utc) <= timedelta(hours=12)

    r = client.post("/livekit/token", headers={"Authorization": "Bearer membre"},
                    json={"session_id": "SESS-AFRO", "identity": "u_membre", "role": "viewer"})
    assert r.status_code == 200, r.text
    r = client.post("/credits/spend", headers={"Authorization": "Bearer membre"},
                    json={"action": "join", "session_id": "SESS-AFRO"})
    assert r.status_code == 200 and r.json()["spent"] == 0
    assert sb.ledger(uid) == [], "un membre Afroboost ne doit avoir AUCUN mouvement BoostTribe"


# ═══════════════════════ B. même jeton : un seul débit côté Afroboost ═══════════════════════

def test_B_meme_jeton_un_seul_debit_afroboost(banc):
    m, sb, client = banc
    uid, tok, jti = entrer_par_afroboost(sb, client)
    for _ in range(3):
        r = client.post("/api/embed/session-started", json={"token": tok})
        assert r.status_code == 200 and r.json()["ok"] is True, r.text
    assert sb.afro_appels == 3                  # BoostTribe peut rappeler (rechargement)…
    assert sb.afro_debits == {jti: 1}           # …Afroboost ne débite qu'UNE séance pour ce jti
    assert sb.ledger(uid) == []


# ═══════════════════════ C. pendant 12 h : join, host, enregistrement = 0 crédit BT ═══════════════

def test_C_pendant_12h_join_host_enregistrement_sans_credit(banc):
    m, sb, client = banc
    uid, _tok, _jti = entrer_par_afroboost(sb, client)
    # Le membre anime sa propre session ; il est aussi un Espace Coach (sinon l'enregistrement
    # est refusé par la règle Espace Coach, sans rapport avec les crédits).
    sb.profil(uid)["coach_payment_type"] = "commission"
    h = {"Authorization": "Bearer membre"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-HOTE"}).json()["ok"] is True
    r = client.post("/credits/spend", headers=h, json={"action": "host", "session_id": "SESS-HOTE"})
    assert r.status_code == 200 and r.json()["spent"] == 0
    r = client.post("/livekit/token", headers=h, json={"session_id": "SESS-HOTE", "identity": "u_m", "role": "stage"})
    assert r.status_code == 200 and r.json()["role"] == "stage", r.text
    r = client.post("/session/record/start", headers=h, json={"session_id": "SESS-HOTE"})
    assert r.status_code == 200 and r.json()["cost"] == 0, r.text
    assert sb.ledger(uid) == []


# ═══════════════════════ D. après 12 h : crédits BoostTribe normaux ═══════════════════════

def test_D_apres_expiration_retour_aux_credits(banc):
    m, sb, client = banc
    coach = sb.utilisateur("coach@exemple.test", "coach", coach_payment_type="commission")
    session(sb, "SESS-AFRO", coach)
    uid, _tok, _jti = entrer_par_afroboost(sb, client)
    sb.profil(uid)["comp_access_until"] = dans(-1)        # les 12 h sont écoulées
    sb.crediter(uid, 3)
    r = client.post("/credits/spend", headers={"Authorization": "Bearer membre"},
                    json={"action": "join", "session_id": "SESS-AFRO"})
    assert r.status_code == 200 and r.json()["spent"] == 1
    assert [d["delta"] for d in sb.debits(uid)] == [-1]
    # Le portefeuille n'a pas été « arrangé » : seul le débit normal apparaît.
    assert [x["reason"] for x in sb.ledger(uid)] == ["purchase", "spend_join"]


# ═══════════════════════ E. jamais de rétrogradation d'un accès existant ═══════════════════════

def test_E_enterprise_existant_non_retrograde(banc):
    m, sb, client = banc
    uid = sb.utilisateur("coach.pro@exemple.test", None, comp_access_plan="enterprise", comp_access_until=None)
    entrer_par_afroboost(sb, client, email="coach.pro@exemple.test", jeton_bt="cp")
    p = sb.profil(uid)
    assert p["comp_access_plan"] == "enterprise", "un plan enterprise ne doit JAMAIS redevenir « pro »"
    assert p["comp_access_until"] is None, "un accès sans fin ne doit pas être ramené à 12 h"


def test_E_acces_plus_long_conserve(banc):
    m, sb, client = banc
    plus_tard = dans(24 * 30)
    uid = sb.utilisateur("long@exemple.test", None, comp_access_plan="pro", comp_access_until=plus_tard)
    entrer_par_afroboost(sb, client, email="long@exemple.test", jeton_bt="lg")
    assert sb.profil(uid)["comp_access_until"] == plus_tard


# ═══════════════════════ F. Afroboost sans verdict : aucune autorisation fabriquée ═══════════════

def test_F_afroboost_injoignable_pas_de_succes_silencieux(banc):
    m, sb, client = banc
    uid, tok, jti = entrer_par_afroboost(sb, client)
    sb.afro_mode = "injoignable"
    r = client.post("/api/embed/session-started", json={"token": tok})
    d = r.json()
    # Le Live déjà ouvert continue (session validée par un jeton signé)…
    assert r.status_code == 200 and d.get("ok") is True
    # …mais ce n'est PAS présenté comme un débit réussi.
    assert d.get("en_attente") is True and d.get("reason") == "afroboost_injoignable", d


def test_F_sans_verdict_final_l_acces_offert_par_ce_jeton_est_retire(banc):
    m, sb, client = banc
    uid, tok, jti = entrer_par_afroboost(sb, client)
    sb.afro_mode = "erreur_500"
    executer(m._embed_reessayer_consume(tok, jti, delais=(0, 0)))
    p = sb.profil(uid)
    # Aucune preuve de débit → l'accès gratuit créé par CE jeton n'existe plus
    # (retour à l'état d'avant : ici, aucun accès). Une nouvelle entrée repassera par afroboost.com.
    assert not m._comp_access_active(p["comp_access_plan"], p["comp_access_until"])


def test_F_retrait_ne_touche_pas_un_acces_anterieur(banc):
    m, sb, client = banc
    uid = sb.utilisateur("vip@exemple.test", None, comp_access_plan="enterprise", comp_access_until=None)
    _u, tok, jti = entrer_par_afroboost(sb, client, email="vip@exemple.test", jeton_bt="vip")
    sb.afro_mode = "injoignable"
    executer(m._embed_reessayer_consume(tok, jti, delais=(0,)))
    p = sb.profil(uid)
    assert p["comp_access_plan"] == "enterprise" and p["comp_access_until"] is None


def test_F_reseau_revenu_le_debit_aboutit_et_l_acces_reste(banc):
    m, sb, client = banc
    uid, tok, jti = entrer_par_afroboost(sb, client)
    sb.afro_mode = "ok"                                   # Afroboost revient pendant les essais
    executer(m._embed_reessayer_consume(tok, jti, delais=(0,)))
    assert sb.afro_debits == {jti: 1}
    assert m._comp_access_active(sb.profil(uid)["comp_access_plan"], sb.profil(uid)["comp_access_until"])


def test_F_refus_explicite_d_afroboost(banc):
    m, sb, client = banc
    uid, tok, jti = entrer_par_afroboost(sb, client)
    sb.afro_mode = "refus_401"
    d = client.post("/api/embed/session-started", json={"token": tok}).json()
    assert d.get("ok") is False
    p = sb.profil(uid)
    assert not m._comp_access_active(p["comp_access_plan"], p["comp_access_until"])


def test_F_meme_jeton_reverifie_le_retrait_revient_a_l_origine(banc):
    """Rechargement de page : le même jeton passe 2 fois par /verify. Un retrait doit revenir à
    l'état d'ORIGINE (aucun accès), pas à l'accès écrit par le 1er passage."""
    m, sb, client = banc
    tok, jti = jeton_afroboost("recharge@exemple.test")
    for _ in range(2):
        assert client.post("/api/embed/verify", json={"token": tok}).status_code == 200
        time.sleep(0.01)
    uid = next(u for u, x in sb.users.items() if x["email"] == "recharge@exemple.test")
    sb.afro_mode = "refus_401"
    executer(m._embed_reessayer_consume(tok, jti, delais=(0,)))
    p = sb.profil(uid)
    assert p["comp_access_plan"] is None and p["comp_access_until"] is None
