"""
🔒 Routes /live/broadcast/* de main.py — preuve que l'UI ne peut déclencher AUCUN direct social réel.

- mode par défaut (rien dans l'environnement) : `MULTISTREAM_MODE=mock` → le moteur est MoteurMock, aucun
  import livekit, aucune plateforme, la réponse porte `direct_reel_autorise: false` ;
- `MULTISTREAM_MODE=egress` SANS le GO complet → `/live/broadcast/start` répond **423 Locked**, le moteur Egress
  n'est jamais instancié, aucune destination n'est résolue ;
- le module social est branché par main.py avec la liste blanche ADMIN_EMAILS : une identité Spordateur
  (jeton valide) reçoit 403 sur /social/destinations/status même à travers l'application complète.
Auth Supabase et « hôte de la room » sont remplacés par des doubles : rien ne sort du poste.
Lancer : python3 -m pytest backend/tests/test_broadcast_routes_verrou.py -q
"""
import importlib.util
import os
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")
ENV_VERROU = ("MULTISTREAM_MODE", "SOCIAL_LIVE_MODE", "SOCIAL_LIVE_GO")


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x",
                 "SUPABASE_ANON_KEY": "x", "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "x",
                 "LIVEKIT_API_SECRET": "x", "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_verrou", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def appli(monkeypatch):
    for v in ENV_VERROU:
        monkeypatch.delenv(v, raising=False)
    m = charger_main()
    ms = sys.modules.get("multistream") or m._ms

    async def faux_user(authorization):
        if authorization == "Bearer afroboost":
            return {"id": "uid-afroboost", "email": "contact.artboost@gmail.com"}
        if authorization == "Bearer spordateur":
            return {"id": "uid-spordateur", "email": "admin@spordateur.example"}
        raise HTTPException(status_code=401, detail="Token manquant")

    async def faux_hote(session_id, user_id):
        return True

    monkeypatch.setattr(m, "get_user_from_token", faux_user)
    monkeypatch.setattr(m, "_is_host_or_cohost", faux_hote)
    # le module social branché par main.py doit lui aussi voir le faux auth
    social = sys.modules.get("social_destinations")
    if social is not None:
        social._deps.get_user = faux_user
        social._deps.store = social.Stockage()
    ms.reinitialiser_pour_tests()
    ms.definir_moteur(None)
    return m, ms, TestClient(m.app)


def test_mode_mock_par_defaut_depuis_les_routes(appli, monkeypatch):
    m, ms, client = appli
    import builtins
    vrai = builtins.__import__

    def sans_livekit(name, *a, **k):
        if name.startswith("livekit"):
            raise AssertionError("livekit importé alors que le mode est mock")
        return vrai(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", sans_livekit)
    h = {"Authorization": "Bearer afroboost"}
    acc = client.get("/live/broadcast/accounts", params={"room": "room-mock-1"}, headers=h)
    assert acc.status_code == 200 and acc.json()["mode"] == "mock"
    assert set(acc.json()["accounts"]) == {"instagram", "facebook", "youtube", "tiktok"}
    r = client.post("/live/broadcast/start", json={"room": "room-mock-1", "destinations": [{"platform": "facebook"}]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "mock" and r.json()["direct_reel_autorise"] is False
    assert isinstance(ms.moteur(), ms.MoteurMock)
    assert ms.reponse_sans_secret(r.json())
    st = client.get("/live/broadcast/status", params={"room": "room-mock-1"}, headers=h).json()
    assert st["mode"] == "mock" and st["direct_reel_autorise"] is False
    assert client.post("/live/broadcast/stop", json={"room": "room-mock-1"}, headers=h).status_code == 200


def test_egress_sans_go_423_et_moteur_jamais_instancie(appli, monkeypatch):
    m, ms, client = appli
    monkeypatch.setenv("MULTISTREAM_MODE", "egress")
    ms.definir_moteur(None)

    class MoteurInterdit(ms.MoteurEgress):
        def __init__(self):
            raise AssertionError("MoteurEgress instancié sans GO")

    monkeypatch.setattr(ms, "MoteurEgress", MoteurInterdit)
    h = {"Authorization": "Bearer afroboost"}
    r = client.post("/live/broadcast/start", json={"room": "room-egress-1", "destinations": [{"platform": "facebook"}, {"platform": "youtube"}]}, headers=h)
    assert r.status_code == 423, r.text
    assert "verrouill" in r.json()["detail"].lower()
    # deux conditions sur trois : toujours 423
    monkeypatch.setenv("SOCIAL_LIVE_MODE", "real")
    assert client.post("/live/broadcast/start", json={"room": "room-egress-1", "destinations": [{"platform": "facebook"}]}, headers=h).status_code == 423
    # le statut de la room ne montre aucune destination démarrée
    st = client.get("/live/broadcast/status", params={"room": "room-egress-1"}, headers=h).json()
    assert st["live"] is False and st["direct_reel_autorise"] is False


def test_spordateur_403_a_travers_l_application(appli):
    m, ms, client = appli
    assert client.get("/social/destinations/status", headers={"Authorization": "Bearer afroboost"}).status_code == 200
    r = client.get("/social/destinations/status", headers={"Authorization": "Bearer spordateur"})
    assert r.status_code == 403 and "Afroboost" in r.json()["detail"]
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://a.b/c/", "stream_key": "k"},
                       headers={"Authorization": "Bearer spordateur"}).status_code == 403
    assert client.get("/social/destinations/status").status_code == 401
