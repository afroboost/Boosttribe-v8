"""
🎓 01/10 — Prompteur, Enregistrement pendant le Live, gestion des Promotions : outils d'un Live
hébergé par un ESPACE COACH. Décision SERVEUR (hôte de la session), appel direct compris.
Le rôle global de l'appelant n'ouvre rien : seul compte « est-il l'hôte de CETTE session ».
"""
import importlib.util
import os
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")
sys.path.insert(0, os.path.join(ICI, ".."))

COACH_A, COACH_B, MEMBRE, ADMIN = "aaaa", "bbbb", "mmmm", "ssss"
USERS = {"Bearer a": {"id": COACH_A, "email": "a@x.ch"}, "Bearer b": {"id": COACH_B, "email": "b@x.ch"},
         "Bearer m": {"id": MEMBRE, "email": "m@x.ch"}, "Bearer s": {"id": ADMIN, "email": "contact.artboost@gmail.com"}}


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x",
                 "SUPABASE_ANON_KEY": "x", "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "k",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_outils_coach", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def appli(monkeypatch):
    m = charger_main()
    sessions = {"LIVEA-0001": COACH_A, "LIVEM-0001": MEMBRE}
    coachs = {COACH_A, COACH_B}

    async def user(auth):
        if auth not in USERS:
            raise HTTPException(status_code=401, detail="Token manquant")
        return USERS[auth]

    async def authz(sid):
        return {"host_id": sessions.get(sid), "cohosts": []} if sid in sessions else None

    async def coach(uid):
        return uid in coachs

    monkeypatch.setattr(m, "get_user_from_token", user)
    monkeypatch.setattr(m, "get_session_authz", authz)
    monkeypatch.setattr(m, "_est_espace_coach", coach)
    return m, TestClient(m.app), coachs


def test_outils_coach_hote_coach_oui_participants_non(appli):
    m, c, _ = appli
    g = lambda s, t: c.get(f"/live/outils-coach/{s}", headers={"Authorization": t}).json()
    assert g("LIVEA-0001", "Bearer a") == {"est_hote": True, "outils_coach": True}        # Coach A, son Live
    assert g("LIVEA-0001", "Bearer b") == {"est_hote": False, "outils_coach": False}      # Coach B participant
    assert g("LIVEA-0001", "Bearer m") == {"est_hote": False, "outils_coach": False}      # membre participant
    assert g("LIVEA-0001", "Bearer s") == {"est_hote": False, "outils_coach": False}      # super-admin non-hôte
    assert g("LIVEM-0001", "Bearer m") == {"est_hote": True, "outils_coach": False}       # membre hôte : pas d'outils Coach
    assert c.get("/live/outils-coach/LIVEA-0001").status_code == 401


def test_enregistrement_refuse_si_l_hote_n_est_pas_un_espace_coach(appli):
    m, c, coachs = appli
    r = c.post("/session/record/start", json={"session_id": "LIVEM-0001"}, headers={"Authorization": "Bearer m"})
    assert r.status_code == 403 and "Espace Coach" in r.json()["detail"]                 # appel direct refusé
    r = c.post("/session/record/upload", data={"session_id": "LIVEM-0001"},
               files={"file": ("a.webm", b"x", "audio/webm")}, headers={"Authorization": "Bearer m"})
    assert r.status_code == 403


def test_coach_dont_le_droit_expire_perd_les_outils(appli):
    m, c, coachs = appli
    coachs.discard(COACH_A)
    assert c.get("/live/outils-coach/LIVEA-0001", headers={"Authorization": "Bearer a"}).json()["outils_coach"] is False
    r = c.post("/session/record/start", json={"session_id": "LIVEA-0001"}, headers={"Authorization": "Bearer a"})
    assert r.status_code == 403
