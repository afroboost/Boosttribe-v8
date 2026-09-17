"""
Banc des destinations sociales (multistream, agent 2) — HORS LIGNE : aucune API sociale appelée
(SOCIAL_LIVE_MODE non posé → mock), stockage en mémoire, chiffrement Fernet réel avec une clé de banc.

Ce que le banc prouve :
  A. chiffrement aller-retour : la clé stockée n'est pas en clair, `resoudre_destination` la rend intacte ;
  B. aucune clé / aucun jeton dans les réponses JSON ni dans les journaux ;
  C. mode mock pour prepare/finish Facebook et YouTube (aucune requête sortante) ;
  D. refus 403 d'un compte qui n'est pas celui d'Afroboost (garde anti-Spordateur) ;
  E. saisie manuelle Instagram / TikTok (seule voie possible), URL validée ;
  F. statuts : not_connected / connected / reauth (expiration) / 501 pour prepare IG-TikTok / 501 OAuth.
Lancer : python3 -m pytest backend/tests/test_social_destinations.py -q
"""
import asyncio
import importlib.util
import logging
import os
import sys

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(ICI, "..", "social_destinations.py")

SECRET_TEST = "sk-banc-ULTRA-SECRET-1234567890"
BLOCS_INTERDITS = (SECRET_TEST, "MOCK-FB-", "mock-yt-")


def charger():
    spec = importlib.util.spec_from_file_location("social_destinations_banc", MODULE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["social_destinations_banc"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def contexte(monkeypatch):
    monkeypatch.delenv("SOCIAL_LIVE_MODE", raising=False)
    monkeypatch.setenv("AFROBOOST_FB_PAGE_ID", "100000000000001")
    monkeypatch.setenv("AFROBOOST_YT_CHANNEL_ID", "UCafroboost0000000000")
    mod = charger()
    f = Fernet(Fernet.generate_key())

    async def get_user(authorization):
        if authorization != "Bearer jeton-banc":
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Token manquant")
        return {"id": "user-afroboost-0001", "email": "coach@afroboost.test"}

    store = mod.Stockage()
    mod.configurer(encrypt=lambda s: f.encrypt(s.encode()).decode(),
                   decrypt=lambda t: f.decrypt(t.encode()).decode() if t else None,
                   get_user=get_user, store=store)
    app = FastAPI()
    app.include_router(mod.router)
    client = TestClient(app)
    return mod, store, client, {"Authorization": "Bearer jeton-banc"}


def test_a_chiffrement_aller_retour(contexte):
    mod, store, client, h = contexte
    r = client.post("/social/destinations/instagram/manual",
                    json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST, "account_label": "afroboosteur"}, headers=h)
    assert r.status_code == 200
    row = asyncio.run(store.lire("user-afroboost-0001", "instagram"))
    assert SECRET_TEST not in str(row), "la clé doit être chiffrée au repos"
    res = asyncio.run(mod.resoudre_destination("user-afroboost-0001", "instagram"))
    assert res == {"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}


def test_b_aucun_secret_dans_reponses_ni_logs(contexte, caplog):
    mod, store, client, h = contexte
    caplog.set_level(logging.INFO)
    client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmp://push.tiktok.example/live/", "stream_key": SECRET_TEST}, headers=h)
    client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=h)
    liste = client.get("/social/destinations", headers=h)
    assert liste.status_code == 200
    corps = liste.text + client.post("/social/destinations/youtube/prepare", json={"account_id": "UCafroboost0000000000"}, headers=h).text
    for bloc in BLOCS_INTERDITS:
        assert bloc not in corps, f"secret {bloc!r} exposé dans une réponse HTTP"
        assert bloc not in caplog.text, f"secret {bloc!r} exposé dans les journaux"
    assert "stream_key" not in liste.text and "stream_key_enc" not in liste.text and "token" not in liste.text.lower()


def test_c_mode_mock_facebook_youtube(contexte, monkeypatch):
    mod, store, client, h = contexte
    appels = []
    monkeypatch.setattr("httpx.AsyncClient", lambda *a, **k: (_ for _ in ()).throw(AssertionError("appel réseau interdit en mock")))
    fb = client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001", "title": "Live test"}, headers=h)
    assert fb.status_code == 200 and fb.json()["status"] == "connected" and fb.json()["mode"] == "api"
    yt = client.post("/social/destinations/youtube/prepare", json={"account_id": "UCafroboost0000000000"}, headers=h)
    assert yt.status_code == 200 and yt.json()["status"] == "connected"
    res = asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook"))
    assert res["rtmp_url"].startswith("rtmps://") and res["stream_key"].startswith("MOCK-FB-")
    fin = client.post("/social/destinations/facebook/finish", headers=h)
    assert fin.status_code == 200 and fin.json()["status"] == "not_connected"
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook")) is None


def test_d_refus_compte_non_afroboost(contexte):
    mod, store, client, h = contexte
    r = client.post("/social/destinations/facebook/prepare", json={"account_id": "999999999999999"}, headers=h)  # Page Spordateur
    assert r.status_code == 403
    r2 = client.post("/social/destinations/youtube/prepare", json={"account_id": "UCspordateur"}, headers=h)
    assert r2.status_code == 403
    assert asyncio.run(store.lire("user-afroboost-0001", "facebook")) is None


def test_d2_sans_variable_rien_n_est_autorise(contexte, monkeypatch):
    mod, store, client, h = contexte
    monkeypatch.delenv("AFROBOOST_FB_PAGE_ID")
    assert client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=h).status_code == 403


def test_e_saisie_manuelle_et_validation(contexte):
    mod, store, client, h = contexte
    assert client.post("/social/destinations/instagram/prepare", json={"account_id": "x"}, headers=h).status_code == 501
    assert client.post("/social/destinations/tiktok/prepare", json={"account_id": "x"}, headers=h).status_code == 501
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "http://pas-rtmp", "stream_key": "k"}, headers=h).status_code == 400
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://a.b/c/", "stream_key": "   "}, headers=h).status_code == 400
    ok = client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmp://push-rtmp.tiktok.example/live/", "stream_key": SECRET_TEST}, headers=h)
    assert ok.status_code == 200 and ok.json()["mode"] == "manual" and ok.json()["status"] == "connected"


def test_f_statuts_et_expiration(contexte):
    mod, store, client, h = contexte
    liste = client.get("/social/destinations", headers=h).json()
    assert liste["mode_live"] == "mock"
    assert [d["platform"] for d in liste["destinations"]] == ["instagram", "facebook", "youtube", "tiktok"]
    assert all(d["status"] == "not_connected" for d in liste["destinations"])
    client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=h)
    row = asyncio.run(store.lire("user-afroboost-0001", "facebook"))
    row["expires_at"] = "2000-01-01T00:00:00+00:00"
    asyncio.run(store.ecrire("user-afroboost-0001", "facebook", row))
    fb = [d for d in client.get("/social/destinations", headers=h).json()["destinations"] if d["platform"] == "facebook"][0]
    assert fb["status"] == "reauth"
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook")) is None
    assert client.delete("/social/destinations/facebook", headers=h).json()["status"] == "not_connected"
    assert client.get("/social/connect/facebook", headers=h).status_code == 501
    assert client.get("/social/destinations").status_code == 401
    assert client.get("/social/destinations/pinterest/manual").status_code in (404, 405)
