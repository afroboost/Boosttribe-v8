"""
🛡️ S0 — L'ACCÈS AU LIVE SE DÉCIDE SUR LE SERVEUR (tests 7 à 15 du lot S0).

  7  spectateur sans billet / crédit / accès → PAS de jeton vidéo
  8  spectateur avec crédit → jeton + UN débit
  9  même entrée rejouée → pas de double débit
  10 hôte sans autorisation → refus (host_id non posé, pas de scène)
  11 hôte avec crédit → UN débit + scène
  12 accès Afroboost → entrer / animer / enregistrer : 0 crédit BoostTribe
  13 accès Afroboost expiré → crédits BoostTribe normaux
  14 plan enterprise + entrée Afroboost → aucune rétrogradation
  15 envoi d'enregistrement sans autorisation préalable → refus
Et ce qui doit rester OUVERT : session gratuite par lien, entrée libre par pseudo, billet,
demande approuvée (anonyme), admin, hôte. Live terminé → plus de jeton.

Faux Supabase en mémoire (aucun réseau). Les règles SQL sont testées dans infra/s0/banc.
Lancer : python3 -m pytest backend/tests/test_s0_acces_serveur.py -q
"""
import io
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_s0_parcours_afroboost import (banc, dans, entrer_par_afroboost,  # noqa: E402,F401
                                        session)


def jeton(client, auth, sid, role="viewer", request_id=None):
    corps = {"session_id": sid, "identity": "u_x", "role": role}
    if request_id is not None:
        corps["request_id"] = request_id
    return client.post("/livekit/token", headers={"Authorization": "Bearer " + auth} if auth else {}, json=corps)


@pytest.fixture()
def monde(banc):
    m, sb, client = banc
    coach = sb.utilisateur("coach@exemple.test", "coach", coach_payment_type="commission")
    riche = sb.utilisateur("riche@exemple.test", "riche")
    sb.crediter(riche, 5)
    pauvre = sb.utilisateur("pauvre@exemple.test", "pauvre")
    session(sb, "SESS-OUVERTE", coach, mode="open", access_mode="account")
    return m, sb, client, {"coach": coach, "riche": riche, "pauvre": pauvre}


# ═══════════════════════ 7. spectateur sans autorisation ═══════════════════════

def test_7_spectateur_sans_rien_pas_de_jeton(monde):
    m, sb, client, u = monde
    assert jeton(client, None, "SESS-OUVERTE").status_code == 401           # anonyme
    r = jeton(client, "pauvre", "SESS-OUVERTE")                                # 0 crédit
    assert r.status_code == 402 and "insuffisant" in r.json()["detail"].lower()
    assert sb.ledger(u["pauvre"]) == []
    session(sb, "SESS-PAYANTE", u["coach"], mode="paid")
    assert jeton(client, "riche", "SESS-PAYANTE").status_code == 403          # crédits ≠ billet
    assert jeton(client, None, "SESS-PAYANTE", request_id=999).status_code == 403   # demande non approuvée
    assert sb.debits(u["riche"]) == []


# ═══════════════════════ 8 + 9. crédit débité une seule fois ═══════════════════════

def test_8_9_spectateur_avec_credit_un_seul_debit(monde):
    m, sb, client, u = monde
    for _ in range(3):
        r = jeton(client, "riche", "SESS-OUVERTE")
        assert r.status_code == 200 and r.json()["role"] == "viewer", r.text
    # Le navigateur appelle AUSSI /credits/spend (même référence) : toujours un seul débit.
    r = client.post("/credits/spend", headers={"Authorization": "Bearer riche"},
                    json={"action": "join", "session_id": "SESS-OUVERTE"})
    assert r.status_code == 200
    assert [(d["reason"], d["delta"]) for d in sb.debits(u["riche"])] == [("spend_join", -1)]
    assert sb.disponibles(u["riche"]) == 4


# ═══════════════════════ 10 + 11. animer ═══════════════════════

def test_10_hote_sans_autorisation_refuse(monde):
    m, sb, client, u = monde
    r = client.post("/session/claim-host", headers={"Authorization": "Bearer pauvre"}, json={"session_id": "SESS-NEUVE"})
    assert r.status_code == 402
    assert not any(p.get("session_id") == "SESS-NEUVE" and p.get("host_id") for p in sb.tables["playlists"])
    assert jeton(client, "pauvre", "SESS-NEUVE", role="stage").status_code == 403
    assert sb.ledger(u["pauvre"]) == []


def test_10b_hote_deja_pose_sans_paiement_pas_de_scene(monde):
    """Une session revendiquée AVANT S0 sans débit : la scène exige quand même l'autorisation."""
    m, sb, client, u = monde
    session(sb, "SESS-ANCIENNE", u["pauvre"])
    assert jeton(client, "pauvre", "SESS-ANCIENNE", role="stage").status_code == 402


def test_11_hote_avec_credit_un_seul_debit(monde):
    m, sb, client, u = monde
    h = {"Authorization": "Bearer riche"}
    for _ in range(2):
        r = client.post("/session/claim-host", headers=h, json={"session_id": "SESS-HOTE"})
        assert r.status_code == 200 and r.json()["ok"] is True
    r = jeton(client, "riche", "SESS-HOTE", role="stage")
    assert r.status_code == 200 and r.json()["role"] == "stage", r.text
    client.post("/credits/spend", headers=h, json={"action": "host", "session_id": "SESS-HOTE"})
    assert [(d["reason"], d["delta"]) for d in sb.debits(u["riche"])] == [("spend_host", -1)]


def test_11b_cohote_invite_ne_paie_pas(monde):
    m, sb, client, u = monde
    sb.tables["playlists"][0]["cohosts"] = [u["pauvre"]]
    r = jeton(client, "pauvre", "SESS-OUVERTE", role="stage")
    assert r.status_code == 200 and r.json()["role"] == "stage"
    assert sb.ledger(u["pauvre"]) == []


# ═══════════════════════ 12 + 13 + 14. accès Afroboost ═══════════════════════

def test_12_afroboost_entrer_animer_enregistrer_zero_credit(monde):
    m, sb, client, u = monde
    uid, _t, _j = entrer_par_afroboost(sb, client)
    sb.profil(uid)["coach_payment_type"] = "commission"     # Espace Coach (règle d'enregistrement)
    assert jeton(client, "membre", "SESS-OUVERTE").status_code == 200
    h = {"Authorization": "Bearer membre"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-M"}).status_code == 200
    assert jeton(client, "membre", "SESS-M", role="stage").status_code == 200
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-M"}).json()["cost"] == 0
    r = client.post("/session/record/upload", headers=h, data={"session_id": "SESS-M"},
                    files={"file": ("a.webm", io.BytesIO(b"audio"), "audio/webm")})
    assert r.status_code == 200, r.text
    assert sb.ledger(uid) == []


def test_13_afroboost_expire_credits_normaux(monde):
    m, sb, client, u = monde
    uid, _t, _j = entrer_par_afroboost(sb, client)
    sb.profil(uid)["comp_access_until"] = dans(-1)
    assert jeton(client, "membre", "SESS-OUVERTE").status_code == 402       # plus d'accès, 0 crédit
    sb.crediter(uid, 2)
    assert jeton(client, "membre", "SESS-OUVERTE").status_code == 200
    assert [d["delta"] for d in sb.debits(uid)] == [-1]


def test_14_enterprise_non_retrograde(monde):
    m, sb, client, u = monde
    uid = sb.utilisateur("ent@exemple.test", None, comp_access_plan="enterprise", comp_access_until=None)
    entrer_par_afroboost(sb, client, email="ent@exemple.test", jeton_bt="ent")
    assert sb.profil(uid)["comp_access_plan"] == "enterprise" and sb.profil(uid)["comp_access_until"] is None


# ═══════════════════════ 15. enregistrement ═══════════════════════

def test_15_upload_sans_autorisation_prealable_refuse(monde):
    m, sb, client, u = monde
    sb.profil(u["riche"])["coach_payment_type"] = "commission"
    h = {"Authorization": "Bearer riche"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-REC"}).status_code == 200
    envoi = lambda: client.post("/session/record/upload", headers=h, data={"session_id": "SESS-REC"},  # noqa: E731
                                files={"file": ("a.webm", io.BytesIO(b"audio"), "audio/webm")})
    r = envoi()
    assert r.status_code == 403 and r.json()["detail"] == "enregistrement_non_autorise"
    assert sb.tables["session_recordings"] == []
    # Après l'autorisation (débit de l'option), l'envoi passe.
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-REC"}).json()["cost"] == 4
    assert envoi().status_code == 200
    assert [(d["reason"], d["delta"]) for d in sb.debits(u["riche"])] == [("spend_host", -1), ("spend_record", -4)]


# ═══════════════════════ ce qui doit rester ouvert ═══════════════════════

def test_ouvert_gratuit_par_lien_entree_libre_billet_demande_admin(monde):
    m, sb, client, u = monde
    session(sb, "SESS-LIEN", u["coach"], mode="private", access_mode="account")
    assert jeton(client, None, "SESS-LIEN").status_code == 200               # « Gratuit par lien / QR »
    session(sb, "SESS-LIBRE", u["coach"], mode="open", access_mode="guest")
    assert jeton(client, None, "SESS-LIBRE").status_code == 200              # entrée libre par pseudo
    session(sb, "SESS-BILLET", u["coach"], mode="paid")
    sb.tables["tickets"].append({"session_id": "SESS-BILLET", "buyer_user_id": u["pauvre"], "status": "paid"})
    assert jeton(client, "pauvre", "SESS-BILLET").status_code == 200         # billet payé
    sb.tables["access_requests"].append({"id": 77, "session_id": "SESS-BILLET", "status": "approved",
                                         "requester_user_id": None})
    assert jeton(client, None, "SESS-BILLET", request_id=77).status_code == 200   # anonyme approuvé
    admin = sb.utilisateur("contact.artboost@gmail.com", "admin")
    assert jeton(client, "admin", "SESS-OUVERTE").status_code == 200
    assert jeton(client, "coach", "SESS-OUVERTE").status_code == 200        # l'hôte
    assert sb.ledger(admin) == [] and sb.ledger(u["coach"]) == [] and sb.ledger(u["pauvre"]) == []


def test_live_termine_plus_de_jeton(monde):
    m, sb, client, u = monde
    sb.tables["playlists"][0]["live_ended_at"] = dans(-1)
    assert jeton(client, "riche", "SESS-OUVERTE").status_code == 410
    assert sb.debits(u["riche"]) == []
    assert jeton(client, "coach", "SESS-OUVERTE").status_code == 200        # l'hôte garde l'accès


def test_le_navigateur_ne_peut_rien_imposer(monde):
    """Champs inventés dans la requête (crédits, droits) : ignorés, la décision reste serveur."""
    m, sb, client, u = monde
    r = client.post("/livekit/token", headers={"Authorization": "Bearer pauvre"},
                    json={"session_id": "SESS-OUVERTE", "identity": "u_x", "role": "viewer",
                          "credits": 999999, "recording_allowed": True, "unlimited": True})
    assert r.status_code == 402
    r = client.post("/livekit/token", headers={"Authorization": "Bearer pauvre"},
                    json={"session_id": "SESS-OUVERTE", "identity": "u_x", "role": "stage"})
    assert r.status_code == 403


# ═══════════════════════ revue de sécurité du commit S0 ═══════════════════════

def test_ligne_playlists_ajoutee_par_un_tiers_n_ouvre_rien(monde):
    """La RLS laisse tout compte insérer une ligne `playlists` pour n'importe quelle session
    (host_id NULL ou lui-même). Une telle ligne « private » / « guest » ne doit RIEN ouvrir,
    ni faire de son auteur l'hôte."""
    m, sb, client, u = monde
    for host in (u["pauvre"], None):
        sb.tables["playlists"].append({"session_id": "SESS-OUVERTE", "host_id": host, "mode": "private",
                                       "access_mode": "guest", "live_ended_at": None,
                                       "created_at": dans(0), "updated_at": dans(1)})
    assert jeton(client, None, "SESS-OUVERTE").status_code == 401
    assert jeton(client, "pauvre", "SESS-OUVERTE").status_code == 402
    assert jeton(client, "pauvre", "SESS-OUVERTE", role="stage").status_code == 403
    assert sb.ledger(u["pauvre"]) == []
    # …et un « live terminé » posé par un tiers ne coupe pas les autres.
    sb.tables["playlists"].append({"session_id": "SESS-OUVERTE", "host_id": None, "live_ended_at": dans(-1),
                                   "created_at": dans(0), "updated_at": dans(2)})
    assert jeton(client, "riche", "SESS-OUVERTE").status_code == 200


def test_preuve_enregistrement_exacte_pas_de_joker(monde):
    """`_` est un joker dans un filtre `like` : le paiement de « RECXA » ne vaut pas pour « REC_A »."""
    m, sb, client, u = monde
    sb.profil(u["riche"])["coach_payment_type"] = "commission"
    sb.crediter(u["riche"], 10)
    h = {"Authorization": "Bearer riche"}
    for sid in ("RECXA", "REC_A"):
        assert client.post("/session/claim-host", headers=h, json={"session_id": sid}).status_code == 200
    assert client.post("/session/record/start", headers=h, json={"session_id": "RECXA"}).json()["cost"] == 4
    r = client.post("/session/record/upload", headers=h, data={"session_id": "REC_A"},
                    files={"file": ("a.webm", io.BytesIO(b"audio"), "audio/webm")})
    assert r.status_code == 403 and r.json()["detail"] == "enregistrement_non_autorise"
