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


def jeton(client, auth, sid, role="viewer", request_id=None, request_token=None):
    corps = {"session_id": sid, "identity": "u_x", "role": role}
    if request_id is not None:
        corps["request_id"] = request_id
    if request_token is not None:
        corps["request_token"] = request_token
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
    """Le co-hôte invité ne paie rien — une fois que l'hôte de référence a réglé l'animation."""
    m, sb, client, u = monde
    sb.tables["playlists"][0]["cohosts"] = [u["pauvre"]]
    sb.crediter(u["coach"], 1)
    assert client.post("/session/claim-host", headers={"Authorization": "Bearer coach"},
                       json={"session_id": "SESS-OUVERTE"}).json()["ok"] is True
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
    assert all(x["delta"] == 0 for x in sb.ledger(uid)), "0 crédit consommé (seule une trace d'autorisation à 0)"


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
    preuve = m._s0_preuve_demande("SESS-BILLET", 77)                         # remise au demandeur à la création
    assert jeton(client, None, "SESS-BILLET", request_id=77, request_token=preuve).status_code == 200   # anonyme approuvé
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


def test_session_non_revendiquee_un_tiers_ne_devient_pas_hote(monde):
    """La ligne de RÉFÉRENCE est la plus ancienne. Si elle n'a pas encore d'hôte, une ligne plus
    récente portant host_id = tiers ne fait pas de lui l'hôte (ni pour la scène, ni pour l'accès)."""
    m, sb, client, u = monde
    sb.tables["playlists"].append({"session_id": "SESS-VIDE", "host_id": None, "mode": "paid",
                                   "created_at": dans(-2), "updated_at": dans(-2)})
    sb.tables["playlists"].append({"session_id": "SESS-VIDE", "host_id": u["riche"], "mode": "private",
                                   "access_mode": "guest", "created_at": dans(-1), "updated_at": dans(-1)})
    assert jeton(client, "riche", "SESS-VIDE", role="stage").status_code == 403
    assert jeton(client, None, "SESS-VIDE").status_code == 401           # aucune ligne fiable : règle stricte
    assert sb.ledger(u["riche"])[1:] == []



# ═══════════════════════ revue finale (43afe98) ═══════════════════════

def test_numero_de_demande_devine_ne_suffit_pas(monde):
    """Le numéro d'une demande approuvée est séquentiel et son statut public : seul le navigateur
    qui l'a CRÉÉE détient la preuve qui ouvre la vidéo."""
    m, sb, client, u = monde
    session(sb, "SESS-BILLET", u["coach"], mode="paid")
    r = client.post("/session/access-request", json={"session_id": "SESS-BILLET", "requester_name": "Anonyme"})
    assert r.status_code == 200 and r.json()["preuve"]
    rid, preuve = r.json()["id"], r.json()["preuve"]
    next(x for x in sb.tables["access_requests"] if x["id"] == rid)["status"] = "approved"   # l'hôte approuve
    assert jeton(client, None, "SESS-BILLET", request_id=rid).status_code == 403                         # numéro seul
    assert jeton(client, None, "SESS-BILLET", request_id=rid, request_token="0" * 40).status_code == 403  # preuve inventée
    assert jeton(client, None, "SESS-BILLET", request_id=rid,
                 request_token=m._s0_preuve_demande("AUTRE-SESS", rid)).status_code == 403              # preuve d'une autre session
    assert jeton(client, None, "SESS-BILLET", request_id=rid, request_token=preuve).status_code == 200


def test_cohote_n_emprunte_pas_la_preuve_d_enregistrement_de_l_hote(monde):
    m, sb, client, u = monde
    sb.profil(u["riche"])["coach_payment_type"] = "commission"
    sb.crediter(u["riche"], 10)
    h = {"Authorization": "Bearer riche"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-CO"}).status_code == 200
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-CO"}).json()["cost"] == 4
    next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-CO")["cohosts"] = [u["pauvre"]]
    r = client.post("/session/record/upload", headers={"Authorization": "Bearer pauvre"}, data={"session_id": "SESS-CO"},
                    files={"file": ("a.webm", io.BytesIO(b"audio"), "audio/webm")})
    assert r.status_code == 403 and r.json()["detail"] == "enregistrement_non_autorise"
    assert sb.ledger(u["pauvre"]) == []


def test_email_de_profil_falsifie_ne_detourne_pas_l_acces_afroboost(monde):
    """Avant S0, un compte pouvait écrire l'e-mail d'un membre Afroboost dans SON profil :
    /api/embed/verify lui aurait accordé l'accès 12 h du membre. GoTrue fait foi."""
    m, sb, client, u = monde
    victime = sb.utilisateur("membre@exemple.test", None)
    sb.tables["profiles"] = [p for p in sb.tables["profiles"] if p["id"] != victime]   # pas encore de profil
    sb.profil(u["pauvre"])["email"] = "membre@exemple.test"                           # e-mail falsifié (avant S0)
    entrer_par_afroboost(sb, client, email="membre@exemple.test", jeton_bt="membre")
    assert sb.profil(u["pauvre"])["comp_access_plan"] is None
    assert sb.profil(victime)["comp_access_plan"] == "pro"



# ═══════════════════════ revue sur 7746d01 ═══════════════════════

def test_tickets_check_numero_seul_ne_suffit_pas(monde):
    m, sb, client, u = monde
    session(sb, "SESS-BILLET", u["coach"], mode="paid")
    r = client.post("/session/access-request", json={"session_id": "SESS-BILLET", "requester_name": "Anonyme"})
    rid, preuve = r.json()["id"], r.json()["preuve"]
    next(x for x in sb.tables["access_requests"] if x["id"] == rid)["status"] = "approved"
    assert client.get(f"/tickets/check/SESS-BILLET?request_id={rid}").json()["has_ticket"] is False
    assert client.get(f"/tickets/check/SESS-BILLET?request_id={rid}",
                      headers={"X-Access-Proof": preuve}).json()["has_ticket"] is True
    # preuve non ASCII : refus propre, jamais une 500
    assert jeton(client, None, "SESS-BILLET", request_id=rid, request_token="é" * 40).status_code == 403


def test_claim_host_simultane_le_perdant_n_est_jamais_debite(monde, monkeypatch):
    """Deux revendications en même temps : la place d'hôte se prend par écriture CONDITIONNELLE
    AVANT tout débit. Le perdant n'est pas hôte, ne reçoit pas ok, et n'a rien payé (aucun remboursement)."""
    m, sb, client, u = monde
    session(sb, "SESS-COURSE", u["coach"])               # l'autre compte a écrit host_id…
    vraie = m.get_session_authz
    appels = {"n": 0}

    async def lecture_perimee(sid):                       # …juste après notre lecture
        appels["n"] += 1
        return None if appels["n"] == 1 else await vraie(sid)
    monkeypatch.setattr(m, "get_session_authz", lecture_perimee)
    r = client.post("/session/claim-host", headers={"Authorization": "Bearer riche"}, json={"session_id": "SESS-COURSE"})
    assert r.status_code == 200 and r.json() == {"ok": False, "host_id": u["coach"]}
    assert [x["reason"] for x in sb.ledger(u["riche"])] == ["purchase"]          # ni débit, ni remboursement


def test_claim_host_sans_credit_rend_la_place(monde):
    m, sb, client, u = monde
    r = client.post("/session/claim-host", headers={"Authorization": "Bearer pauvre"}, json={"session_id": "SESS-P"})
    assert r.status_code == 402
    assert not any(p.get("session_id") == "SESS-P" and p.get("host_id") for p in sb.tables["playlists"])


def test_cohote_sans_animation_reglee_pas_de_scene(monde):
    """host_id posé GRATUITEMENT (/session/configure, ou INSERT direct) + co-hôte : la scène reste fermée
    tant que l'hôte de référence n'a pas réglé l'animation (ou n'est pas illimité / admin)."""
    m, sb, client, u = monde
    h = {"Authorization": "Bearer pauvre"}
    assert client.post("/session/configure", headers=h, json={"session_id": "SESS-CONF", "mode": "private"}).status_code == 200
    assert next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-CONF")["host_id"] == u["pauvre"]
    next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-CONF")["cohosts"] = [u["riche"]]
    assert jeton(client, "riche", "SESS-CONF", role="stage").status_code == 402      # co-hôte : scène fermée
    assert jeton(client, "pauvre", "SESS-CONF", role="stage").status_code == 402     # hôte sans crédit
    sb.crediter(u["pauvre"], 1)
    assert jeton(client, "pauvre", "SESS-CONF", role="stage").status_code == 200     # l'hôte règle (1 débit)
    assert jeton(client, "riche", "SESS-CONF", role="stage").status_code == 200      # le co-hôte suit, gratuit
    assert [d["delta"] for d in sb.debits(u["pauvre"])] == [-1] and sb.debits(u["riche"]) == []


def test_demande_anterieure_au_deploiement_toleree_jusqu_au_seuil(monde, monkeypatch):
    m, sb, client, u = monde
    session(sb, "SESS-BILLET", u["coach"], mode="paid")
    sb.tables["access_requests"].append({"id": 40, "session_id": "SESS-BILLET", "status": "approved", "requester_user_id": None})
    sb.tables["access_requests"].append({"id": 41, "session_id": "SESS-BILLET", "status": "approved", "requester_user_id": None})
    sb.tables["access_requests"].append({"id": 39, "session_id": "SESS-BILLET", "status": "approved",
                                         "requester_user_id": u["riche"]})
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_MAX_ID", 40)
    assert jeton(client, None, "SESS-BILLET", request_id=40).status_code == 403   # sans date de fin : rien
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_JUSQUA", dans(24))
    assert jeton(client, None, "SESS-BILLET", request_id=40).status_code == 200   # antérieure anonyme : tolérée
    assert jeton(client, None, "SESS-BILLET", request_id=41).status_code == 403   # postérieure : preuve exigée
    assert jeton(client, None, "SESS-BILLET", request_id=39).status_code == 403   # demande d'un COMPTE : jamais par numéro
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_JUSQUA", dans(-1))
    assert jeton(client, None, "SESS-BILLET", request_id=40).status_code == 403   # transition terminée


def test_enregistrement_garde_son_autorisation_si_l_illimite_expire(monde):
    m, sb, client, u = monde
    uid, _t, _j = entrer_par_afroboost(sb, client)
    sb.profil(uid)["coach_payment_type"] = "commission"
    h = {"Authorization": "Bearer membre"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-EXP"}).status_code == 200
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-EXP"}).json()["cost"] == 0
    sb.profil(uid)["comp_access_until"] = dans(-1)                    # les 12 h s'achèvent pendant le Live
    r = client.post("/session/record/upload", headers=h, data={"session_id": "SESS-EXP"},
                    files={"file": ("a.webm", io.BytesIO(b"audio"), "audio/webm")})
    assert r.status_code == 200, r.text
    assert all(x["delta"] == 0 for x in sb.ledger(uid))



# ═══════════════════════ revue sur 09f1588 ═══════════════════════

def test_cohote_avec_animation_gratuite(monde, monkeypatch):
    """L'admin peut régler l'animation à 0 crédit : l'hôte ordinaire l'obtient sans débit, et ses
    co-hôtes gardent la scène (trace d'autorisation à 0 crédit)."""
    m, sb, client, u = monde
    sb.tables["pricing_settings"][0]["cost_host"] = 0
    assert client.post("/session/claim-host", headers={"Authorization": "Bearer pauvre"},
                       json={"session_id": "SESS-GRATUITE"}).json()["ok"] is True
    next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-GRATUITE")["cohosts"] = [u["riche"]]
    assert jeton(client, "riche", "SESS-GRATUITE", role="stage").status_code == 200
    assert sb.debits(u["pauvre"]) == [] and sb.debits(u["riche"]) == []


def test_cohote_garde_la_scene_si_l_illimite_de_l_hote_expire(monde):
    m, sb, client, u = monde
    uid, _t, _j = entrer_par_afroboost(sb, client)                     # hôte illimité (Afroboost 12 h)
    assert client.post("/session/claim-host", headers={"Authorization": "Bearer membre"},
                       json={"session_id": "SESS-AF"}).json()["ok"] is True
    sb.profil(uid)["comp_access_until"] = dans(-1)                     # l'accès expire pendant le Live
    next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-AF")["cohosts"] = [u["riche"]]
    assert jeton(client, "riche", "SESS-AF", role="stage").status_code == 200
    assert all(x["delta"] == 0 for x in sb.ledger(uid))


def test_prise_d_hote_course_ligne_sans_hote_creee_entre_temps(monde):
    """Une ligne SANS hôte apparaît entre la vérification et la création : la prise est retentée,
    l'hôte l'obtient (au lieu d'un faux échec qui le laissait payer sans être hôte)."""
    m, sb, client, u = monde
    vrai_rest = sb._rest

    def rest(req, table, params):
        rep = vrai_rest(req, table, params)
        if (req.method == "GET" and table == "playlists" and dict(params).get("select") == "session_id"
                and dict(params).get("session_id") == "eq.SESS-COURSE2"):
            sb.tables["playlists"].append({"session_id": "SESS-COURSE2", "host_id": None, "description": "x"})
        return rep
    sb._rest = rest
    r = client.post("/session/claim-host", headers={"Authorization": "Bearer riche"}, json={"session_id": "SESS-COURSE2"})
    assert r.json() == {"ok": True, "host_id": u["riche"]}
    assert next(p for p in sb.tables["playlists"] if p["session_id"] == "SESS-COURSE2")["host_id"] == u["riche"]


# ═══════════════════════ revue sur 6fb515d ═══════════════════════

def test_transition_date_sans_fuseau_pas_de_500(monde, monkeypatch):
    m, sb, client, u = monde
    session(sb, "SESS-BILLET", u["coach"], mode="paid")
    sb.tables["access_requests"].append({"id": 40, "session_id": "SESS-BILLET", "status": "approved", "requester_user_id": None})
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_MAX_ID", 40)
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_JUSQUA", "2099-01-01")          # telle qu'un opérateur l'écrit
    assert jeton(client, None, "SESS-BILLET", request_id=40).status_code == 200
    assert client.get("/tickets/check/SESS-BILLET?request_id=40").json()["has_ticket"] is True
    monkeypatch.setattr(m, "S0_AR_SANS_PREUVE_JUSQUA", "2000-01-01")
    assert jeton(client, None, "SESS-BILLET", request_id=40).status_code == 403


def test_trace_gratuite_ne_vaut_pas_paiement_quand_le_tarif_revient(monde):
    """Animation à 0 crédit : trace d'autorisation. Tarif rétabli ensuite : le MÊME identifiant de
    session se paie normalement (la trace ne bloque pas le vrai débit)."""
    m, sb, client, u = monde
    h = {"Authorization": "Bearer riche"}
    sb.tables["pricing_settings"][0]["cost_host"] = 0
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-AVANCE"}).json()["ok"] is True
    sb.tables["pricing_settings"][0]["cost_host"] = 1
    assert jeton(client, "riche", "SESS-AVANCE", role="stage").status_code == 200
    assert [d["delta"] for d in sb.debits(u["riche"])] == [-1]


def test_trace_gratuite_d_enregistrement_ne_vaut_pas_paiement(monde):
    m, sb, client, u = monde
    sb.profil(u["riche"])["coach_payment_type"] = "commission"
    sb.crediter(u["riche"], 10)
    h = {"Authorization": "Bearer riche"}
    assert client.post("/session/claim-host", headers=h, json={"session_id": "SESS-REC0"}).status_code == 200
    sb.tables["pricing_settings"][0]["cost_record_transcribe"] = 0
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-REC0"}).json()["cost"] == 0
    sb.tables["pricing_settings"][0]["cost_record_transcribe"] = 4
    assert client.post("/session/record/start", headers=h, json={"session_id": "SESS-REC0"}).json()["cost"] == 4
    assert [d["reason"] for d in sb.debits(u["riche"])] == ["spend_host", "spend_record"]
