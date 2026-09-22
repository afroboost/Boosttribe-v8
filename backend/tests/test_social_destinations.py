"""
Banc des destinations sociales — HORS LIGNE : aucune API sociale appelée (SOCIAL_LIVE_MODE non posé → mock),
stockage en mémoire, chiffrement Fernet réel avec une clé de banc.

Ce que le banc prouve :
  A. chiffrement aller-retour : la clé stockée n'est pas en clair, `resoudre_destination` la rend intacte ;
  B. aucune clé / aucun jeton dans les réponses JSON ni dans les journaux (même pas les 4 derniers caractères) ;
  C. mode mock pour prepare/finish Facebook et YouTube (aucune requête sortante) ;
  D. refus 403 d'un compte qui n'est pas celui d'Afroboost (garde anti-Spordateur) ;
  E. saisie manuelle Instagram / TikTok : `rtmps://` seul, `rtmp://` refusé, clé vide refusée ;
  F. statuts : not_connected / not_configured / configured / reauth / 501 pour prepare IG-TikTok / 501 OAuth legacy ;
  G. état par plateforme AVEC / SANS variables serveur : `config_required` + NOMS exacts des variables manquantes ;
  H. GET ne fuit jamais la clé : au plus « clé enregistrée : oui, 4 derniers caractères » ;
  I. sans clé de chiffrement : le POST répond « Configuration requise » (409, nom de la variable), RIEN n'est stocké ;
  J. isolation Spordateur : une identité hors liste blanche ne peut ni lire ni écrire (403), et ne voit rien ;
  K. OAuth Facebook / YouTube RÉEL avec échange de code mocké : Page/chaîne Afroboost acceptée, autre → refus ;
  L. verrou du direct réel : mock par défaut ; aucun endpoint ne démarre un direct réel sans le GO.
Lancer : python3 -m pytest backend/tests/test_social_destinations.py -q
"""
import asyncio
import importlib.util
import logging
import os
import sys
from urllib.parse import unquote

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(ICI, "..", "social_destinations.py")

SECRET_TEST = "sk-banc-ULTRA-SECRET-1234567890"
BLOCS_INTERDITS = (SECRET_TEST, "MOCK-FB-", "mock-yt-")
AFRO = {"Authorization": "Bearer jeton-banc"}
SPORDATEUR = {"Authorization": "Bearer jeton-spordateur"}
AUTRE_AFRO = {"Authorization": "Bearer jeton-afroboost-2"}
VARS_FB = {"FACEBOOK_APP_ID": "123456", "FACEBOOK_APP_SECRET": "secret-app-fb", "AFROBOOST_FB_PAGE_ID": "100000000000001",
           "FACEBOOK_LOGIN_CONFIG_ID": "424242424242424", "SOCIAL_OAUTH_REDIRECT_BASE": "https://api-live.afroboost.com"}
VARS_YT = {"GOOGLE_CLIENT_ID": "abc.apps.googleusercontent.com", "GOOGLE_CLIENT_SECRET": "secret-google",
           "AFROBOOST_YT_CHANNEL_ID": "UCafroboost0000000000", "SOCIAL_OAUTH_REDIRECT_BASE": "https://api-live.afroboost.com"}
TOUTES_VARS = ("SOCIAL_LIVE_MODE", "MULTISTREAM_MODE", "SOCIAL_LIVE_GO", "SOCIAL_SECRETS_KEY", "SOCIAL_ALLOWED_EMAILS",
               *VARS_FB, *VARS_YT)


def charger():
    spec = importlib.util.spec_from_file_location("social_destinations_banc", MODULE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["social_destinations_banc"] = mod
    spec.loader.exec_module(mod)
    return mod


async def get_user(authorization):
    if authorization == "Bearer jeton-banc":
        return {"id": "user-afroboost-0001", "email": "coach@afroboost.test"}
    if authorization == "Bearer jeton-afroboost-2":
        return {"id": "user-afroboost-0002", "email": "second@afroboost.test"}
    if authorization == "Bearer jeton-spordateur":
        return {"id": "user-spordateur-0001", "email": "admin@spordateur.test"}
    raise HTTPException(status_code=401, detail="Token manquant")


def _monter(mod, *, encrypt=None, decrypt=None, emails=("coach@afroboost.test", "second@afroboost.test")):
    store = mod.Stockage()
    mod.configurer(encrypt=encrypt, decrypt=decrypt, get_user=get_user, store=store, emails_autorises=emails,
                   origines_retour=("https://afroboost.com", "http://localhost:5183"))
    app = FastAPI()
    app.include_router(mod.router)
    return store, TestClient(app)


@pytest.fixture()
def contexte(monkeypatch):
    """Configuration COMPLÈTE : chiffrement de repli (Fernet injecté) + variables OAuth FB/YT posées."""
    for v in TOUTES_VARS:
        monkeypatch.delenv(v, raising=False)
    for k, v in {**VARS_FB, **VARS_YT}.items():
        monkeypatch.setenv(k, v)
    mod = charger()
    f = Fernet(Fernet.generate_key())
    store, client = _monter(mod, encrypt=lambda s: f.encrypt(s.encode()).decode(),
                            decrypt=lambda t: f.decrypt(t.encode()).decode() if t else None)
    return mod, store, client, AFRO


@pytest.fixture()
def contexte_nu(monkeypatch):
    """AUCUNE variable serveur, AUCUN chiffrement : ce que voit la prod tant que Bassi n'a rien posé dans Coolify."""
    for v in TOUTES_VARS:
        monkeypatch.delenv(v, raising=False)
    mod = charger()
    store, client = _monter(mod)
    return mod, store, client, AFRO


def _etat(client, h, platform):
    r = client.get("/social/destinations/status", headers=h)
    assert r.status_code == 200
    return [d for d in r.json()["destinations"] if d["platform"] == platform][0]


def _state_depuis(client, h, platform, retour="https://afroboost.com/live/s"):
    url = client.get(f"/social/oauth/{platform}/start", params={"return_to": retour}, headers=h).json()["url"]
    return unquote(url.split("state=")[1])


# ─── A. chiffrement ──────────────────────────────────────────────────────────────────────────
def test_a_chiffrement_aller_retour(contexte):
    mod, store, client, h = contexte
    r = client.post("/social/destinations/instagram/manual",
                    json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST, "account_label": "afroboosteur"}, headers=h)
    assert r.status_code == 200, r.text
    row = asyncio.run(store.lire("user-afroboost-0001", "instagram"))
    assert SECRET_TEST not in str(row), "la clé doit être chiffrée au repos"
    res = asyncio.run(mod.resoudre_destination("user-afroboost-0001", "instagram"))
    assert res == {"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}


def test_a2_cle_dediee_social_secrets_key_prioritaire(monkeypatch):
    """SOCIAL_SECRETS_KEY posée → c'est ELLE qui chiffre (le Fernet Stripe injecté n'est plus utilisé)."""
    for v in TOUTES_VARS:
        monkeypatch.delenv(v, raising=False)
    dediee = Fernet.generate_key()
    monkeypatch.setenv("SOCIAL_SECRETS_KEY", dediee.decode())
    mod = charger()
    store, client = _monter(mod, encrypt=lambda s: "FERNET-STRIPE:" + s, decrypt=lambda t: t)
    r = client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmps://push.tiktok.test/live/", "stream_key": SECRET_TEST}, headers=AFRO)
    assert r.status_code == 200, r.text
    row = asyncio.run(store.lire("user-afroboost-0001", "tiktok"))
    assert not row["stream_key_enc"].startswith("FERNET-STRIPE:") and SECRET_TEST not in row["stream_key_enc"]
    assert Fernet(dediee).decrypt(row["stream_key_enc"].encode()).decode() == SECRET_TEST
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "tiktok"))["stream_key"] == SECRET_TEST


# ─── B. aucun secret dans les réponses ni les journaux ───────────────────────────────────────
def test_b_aucun_secret_dans_reponses_ni_logs(contexte, caplog):
    mod, store, client, h = contexte
    caplog.set_level(logging.INFO)
    client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmps://push.tiktok.example/live/", "stream_key": SECRET_TEST}, headers=h)
    client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=h)
    liste = client.get("/social/destinations", headers=h)
    assert liste.status_code == 200
    corps = liste.text + client.post("/social/destinations/youtube/prepare", json={"account_id": "UCafroboost0000000000"}, headers=h).text
    corps += client.get("/social/destinations/status", headers=h).text
    for bloc in BLOCS_INTERDITS:
        assert bloc not in corps, f"secret {bloc!r} exposé dans une réponse HTTP"
        assert bloc not in caplog.text, f"secret {bloc!r} exposé dans les journaux"
    # même les 4 derniers caractères (indice renvoyé au navigateur) n'apparaissent PAS dans les journaux
    assert SECRET_TEST[-4:] not in caplog.text
    assert "stream_key" not in liste.text and "stream_key_enc" not in liste.text and "oauth_token" not in liste.text
    assert "token" not in liste.text.lower()


# ─── C. mock Facebook / YouTube ──────────────────────────────────────────────────────────────
def test_c_mode_mock_facebook_youtube(contexte, monkeypatch):
    mod, store, client, h = contexte
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


# ─── D. garde compte Afroboost ───────────────────────────────────────────────────────────────
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


# ─── E. saisie manuelle : RTMPS seul ─────────────────────────────────────────────────────────
def test_e_saisie_manuelle_et_validation(contexte):
    mod, store, client, h = contexte
    assert client.post("/social/destinations/instagram/prepare", json={"account_id": "x"}, headers=h).status_code == 501
    assert client.post("/social/destinations/tiktok/prepare", json={"account_id": "x"}, headers=h).status_code == 501
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "http://pas-rtmp", "stream_key": "k"}, headers=h).status_code == 400
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://a.b/c/", "stream_key": "   "}, headers=h).status_code == 400
    # rtmp:// EN CLAIR : refusé explicitement (la clé voyagerait sans chiffrement)
    r = client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmp://push-rtmp.tiktok.example/live/", "stream_key": SECRET_TEST}, headers=h)
    assert r.status_code == 400 and "rtmps://" in r.json()["detail"]
    assert client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "RTMP://push.tiktok.example/live/", "stream_key": SECRET_TEST}, headers=h).status_code == 400
    assert asyncio.run(store.lire("user-afroboost-0001", "tiktok")) is None, "rien n'est stocké après un refus"
    ok = client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmps://push-rtmps.tiktok.example:443/live/", "stream_key": SECRET_TEST}, headers=h)
    assert ok.status_code == 200 and ok.json()["mode"] == "manual" and ok.json()["status"] == "configured"


# ─── F. statuts et expiration ────────────────────────────────────────────────────────────────
def test_f_statuts_et_expiration(contexte):
    mod, store, client, h = contexte
    liste = client.get("/social/destinations", headers=h).json()
    assert liste["mode_live"] == "mock"
    assert [d["platform"] for d in liste["destinations"]] == ["instagram", "facebook", "youtube", "tiktok"]
    par = {d["platform"]: d for d in liste["destinations"]}
    assert par["facebook"]["status"] == "not_connected" and par["youtube"]["status"] == "not_connected"
    assert par["instagram"]["status"] == "not_configured" and par["tiktok"]["status"] == "not_configured"
    assert par["facebook"]["kind"] == "oauth" and par["instagram"]["kind"] == "manual"
    client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=h)
    row = asyncio.run(store.lire("user-afroboost-0001", "facebook"))
    row["expires_at"] = "2000-01-01T00:00:00+00:00"
    asyncio.run(store.ecrire("user-afroboost-0001", "facebook", row))
    assert _etat(client, h, "facebook")["status"] == "reauth"
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook")) is None
    assert client.delete("/social/destinations/facebook", headers=h).json()["status"] == "not_connected"
    assert client.get("/social/connect/facebook", headers=h).status_code == 501
    assert client.get("/social/destinations").status_code == 401
    assert client.get("/social/destinations/status").status_code == 401
    assert client.get("/social/destinations/pinterest/manual").status_code in (404, 405)


# ─── G. état par plateforme AVEC / SANS variables serveur ────────────────────────────────────
def test_g_config_required_sans_variables_noms_exacts(contexte_nu):
    """Prod aujourd'hui : rien n'est posé → les 4 plateformes disent « Configuration requise » avec les NOMS."""
    mod, store, client, h = contexte_nu
    r = client.get("/social/destinations/status", headers=h)
    assert r.status_code == 200
    par = {d["platform"]: d for d in r.json()["destinations"]}
    assert all(par[p]["status"] == "config_required" for p in ("instagram", "facebook", "youtube", "tiktok"))
    assert par["facebook"]["missing"] == ["SOCIAL_SECRETS_KEY", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "AFROBOOST_FB_PAGE_ID", "FACEBOOK_LOGIN_CONFIG_ID", "SOCIAL_OAUTH_REDIRECT_BASE"]
    assert par["youtube"]["missing"] == ["SOCIAL_SECRETS_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AFROBOOST_YT_CHANNEL_ID", "SOCIAL_OAUTH_REDIRECT_BASE"]
    assert par["instagram"]["missing"] == ["SOCIAL_SECRETS_KEY"] and par["tiktok"]["missing"] == ["SOCIAL_SECRETS_KEY"]
    # jamais une VALEUR : les noms seulement
    assert "secret-app-fb" not in r.text and "=" not in "".join(par["facebook"]["missing"])
    # le verrou est fermé et le dit
    assert r.json()["direct_reel_autorise"] is False and r.json()["mode_live"] == "mock"
    # le parcours OAuth refuse proprement avec la même liste (409, pas un bouton mort)
    o = client.get("/social/oauth/facebook/start", headers=h)
    assert o.status_code == 409 and o.json()["detail"]["missing"] == par["facebook"]["missing"]


def test_g2_config_partielle_liste_seulement_ce_qui_manque(monkeypatch):
    for v in TOUTES_VARS:
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("SOCIAL_SECRETS_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("FACEBOOK_APP_ID", "123")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "x")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "y")
    monkeypatch.setenv("AFROBOOST_YT_CHANNEL_ID", "UC1")
    monkeypatch.setenv("SOCIAL_OAUTH_REDIRECT_BASE", "https://api-live.afroboost.com")
    mod = charger()
    store, client = _monter(mod)
    par = {d["platform"]: d for d in client.get("/social/destinations/status", headers=AFRO).json()["destinations"]}
    assert par["facebook"]["status"] == "config_required" and par["facebook"]["missing"] == ["FACEBOOK_APP_SECRET", "AFROBOOST_FB_PAGE_ID", "FACEBOOK_LOGIN_CONFIG_ID"]
    assert par["youtube"]["status"] == "not_connected" and par["youtube"]["missing"] == []
    assert par["instagram"]["status"] == "not_configured" and par["tiktok"]["status"] == "not_configured"
    assert mod.variables_manquantes("youtube") == []


# ─── H. GET ne fuit jamais la clé ────────────────────────────────────────────────────────────
def test_h_get_ne_renvoie_jamais_la_cle(contexte):
    mod, store, client, h = contexte
    r = client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}, headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "configured" and r.json()["key_saved"] is True and r.json()["key_hint"] == SECRET_TEST[-4:]
    assert SECRET_TEST not in r.text
    e = _etat(client, h, "instagram")
    assert e["key_saved"] is True and e["key_hint"] == SECRET_TEST[-4:] and len(e["key_hint"]) == 4
    assert SECRET_TEST not in client.get("/social/destinations/status", headers=h).text
    for cle in ("stream_key", "stream_key_enc", "oauth_token_enc", "rtmp_url"):
        assert cle not in e, f"{cle} ne doit pas être renvoyé"
    # suppression → non configuré, plus d'indice
    d = client.delete("/social/destinations/instagram", headers=h)
    assert d.status_code == 200 and d.json()["status"] == "not_configured" and d.json()["key_hint"] is None
    assert asyncio.run(store.lire("user-afroboost-0001", "instagram")) is None


# ─── I. sans chiffrement : Configuration requise, rien en clair ──────────────────────────────
def test_i_sans_cle_de_chiffrement_rien_n_est_stocke(contexte_nu, caplog):
    mod, store, client, h = contexte_nu
    caplog.set_level(logging.INFO)
    r = client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}, headers=h)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "config_required" and r.json()["detail"]["missing"] == ["SOCIAL_SECRETS_KEY"]
    assert asyncio.run(store.lire("user-afroboost-0001", "instagram")) is None, "JAMAIS de stockage en clair"
    assert SECRET_TEST not in r.text and SECRET_TEST not in caplog.text


# ─── J. isolation Spordateur ─────────────────────────────────────────────────────────────────
def test_j_isolation_spordateur_ni_lecture_ni_ecriture(contexte, caplog):
    """Une identité Spordateur (jeton valide, e-mail hors liste blanche) : 403 partout, aucune trace en base."""
    mod, store, client, h = contexte
    caplog.set_level(logging.INFO)
    # Afroboost configure Instagram
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}, headers=h).status_code == 200
    # Spordateur : lecture refusée
    for chemin in ("/social/destinations", "/social/destinations/status", "/social/oauth/facebook/start", "/social/connect/facebook"):
        r = client.get(chemin, headers=SPORDATEUR)
        assert r.status_code == 403, f"{chemin} → {r.status_code}"
        assert SECRET_TEST not in r.text and "configured" not in r.text
    # Spordateur : écriture refusée (manual, prepare, finish, delete)
    assert client.post("/social/destinations/tiktok/manual", json={"rtmp_url": "rtmps://push.tiktok.test/live/", "stream_key": "cle-spordateur"}, headers=SPORDATEUR).status_code == 403
    assert client.post("/social/destinations/facebook/prepare", json={"account_id": "100000000000001"}, headers=SPORDATEUR).status_code == 403
    assert client.post("/social/destinations/instagram/finish", headers=SPORDATEUR).status_code == 403
    assert client.delete("/social/destinations/instagram", headers=SPORDATEUR).status_code == 403
    # rien n'a été écrit pour Spordateur, et la ligne Afroboost est intacte
    assert asyncio.run(store.lire_toutes("user-spordateur-0001")) == []
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "instagram"))["stream_key"] == SECRET_TEST
    assert asyncio.run(mod.resoudre_destination("user-spordateur-0001", "instagram")) is None
    assert "cle-spordateur" not in caplog.text


def test_j2_isolation_entre_deux_comptes_autorises(contexte):
    """Même dans la liste blanche, chaque compte ne voit que SES destinations (clé = user_id)."""
    mod, store, client, h = contexte
    assert client.post("/social/destinations/instagram/manual", json={"rtmp_url": "rtmps://live-upload.instagram.com:443/rtmp/", "stream_key": SECRET_TEST}, headers=h).status_code == 200
    assert _etat(client, AUTRE_AFRO, "instagram")["status"] == "not_configured"
    assert client.delete("/social/destinations/instagram", headers=AUTRE_AFRO).status_code == 200
    assert _etat(client, h, "instagram")["status"] == "configured", "la suppression de l'autre compte ne touche pas la mienne"


def test_j3_liste_blanche_par_variable_env(contexte, monkeypatch):
    mod, store, client, h = contexte
    monkeypatch.setenv("SOCIAL_ALLOWED_EMAILS", "second@afroboost.test")
    assert client.get("/social/destinations/status", headers=h).status_code == 403
    assert client.get("/social/destinations/status", headers=AUTRE_AFRO).status_code == 200


# ─── K. OAuth réel (échange de code mocké) ───────────────────────────────────────────────────
class _Reponse:
    def __init__(self, status_code, data):
        self.status_code, self._data = status_code, data

    def json(self):
        return self._data


class _FauxHttpx:
    """Simule graph.facebook.com / googleapis : jamais de réseau, journal des appels."""
    appels = []
    pages = []
    chaines = []
    accounts_reponse = None  # forcer une réponse Graph (erreur) pour /me/accounts
    page_directe = None      # réponse de GET /{page-id} (consultation directe) — None = 400 Graph

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        _FauxHttpx.appels.append(("GET", url))
        if "oauth/access_token" in url:
            assert params["client_secret"] == "secret-app-fb" and params["code"] == "CODE-FB"
            return _Reponse(200, {"access_token": "USER-TOKEN-FB"})
        if "/me/accounts" in url:
            if _FauxHttpx.accounts_reponse is not None:
                return _FauxHttpx.accounts_reponse
            return _Reponse(200, {"data": _FauxHttpx.pages})
        if "/me/permissions" in url:
            return _Reponse(200, {"data": [{"permission": "pages_show_list", "status": "granted"}, {"permission": "publish_video", "status": "declined"}]})
        if url.endswith("/100000000000001"):  # consultation DIRECTE de la Page attendue (assets Business)
            if _FauxHttpx.page_directe is not None:
                return _FauxHttpx.page_directe
            return _Reponse(400, {"error": {"message": "Unsupported get request", "type": "GraphMethodException", "code": 100, "error_subcode": 33}})
        if "youtube/v3/channels" in url:
            return _Reponse(200, {"items": _FauxHttpx.chaines})
        return _Reponse(404, {})

    async def post(self, url, data=None, params=None, headers=None, json=None):
        _FauxHttpx.appels.append(("POST", url))
        if "oauth2.googleapis.com/token" in url:
            assert data["client_secret"] == "secret-google" and data["code"] == "CODE-YT"
            return _Reponse(200, {"access_token": "ACCESS-YT", "refresh_token": "REFRESH-YT-SECRET"})
        return _Reponse(404, {})


@pytest.fixture()
def oauth(contexte, monkeypatch):
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _FauxHttpx)
    _FauxHttpx.appels, _FauxHttpx.pages, _FauxHttpx.chaines, _FauxHttpx.accounts_reponse, _FauxHttpx.page_directe = [], [], [], None, None
    return contexte


def test_k_oauth_start_url_reelle_et_state_signe(oauth):
    mod, store, client, h = oauth
    r = client.get("/social/oauth/facebook/start", params={"return_to": "https://afroboost.com/live/session/abc"}, headers=h)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("https://www.facebook.com/v25.0/dialog/oauth?") and "client_id=123456" in url
    assert "redirect_uri=https%3A%2F%2Fapi-live.afroboost.com%2Fsocial%2Foauth%2Ffacebook%2Fcallback" in url
    assert "config_id=424242424242424" in url and "secret-app-fb" not in url, "le secret d'app ne sort jamais"
    y = client.get("/social/oauth/youtube/start", headers=h).json()["url"]
    assert y.startswith("https://accounts.google.com/o/oauth2/v2/auth?") and "access_type=offline" in y and "secret-google" not in y
    # state altéré / plateforme croisée
    state = unquote(url.split("state=")[1])
    assert client.get("/social/oauth/facebook/callback", params={"code": "x", "state": state + "zz"}).status_code == 400
    assert client.get("/social/oauth/youtube/callback", params={"code": "x", "state": state}).status_code == 400
    assert client.get("/social/oauth/facebook/callback", params={"code": "x", "state": ""}).status_code == 400
    # un retour vers une origine étrangère (Spordateur) n'est PAS conservé : la réponse finale sera du JSON, pas une redirection
    assert mod._retour_autorise("https://spordateur.example/hop") is None
    assert mod._retour_autorise("https://afroboost.com/live/session/abc") == "https://afroboost.com/live/session/abc"
    assert mod._retour_autorise("http://localhost:5183/harness") == "http://localhost:5183/harness"
    assert client.get("/social/oauth/instagram/start", headers=h).status_code == 501, "Instagram : jamais un faux OAuth"
    assert client.get("/social/oauth/tiktok/start", headers=h).status_code == 501


def test_k2_oauth_facebook_page_afroboost_acceptee_jeton_chiffre(oauth, caplog):
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    _FauxHttpx.pages = [{"id": "999999999999999", "name": "Spordateur", "access_token": "PAGE-TOKEN-SPORDATEUR"},
                        {"id": "100000000000001", "name": "Afroboost", "access_token": "PAGE-TOKEN-AFROBOOST-SECRET"}]
    state = _state_depuis(client, h, "facebook", "https://afroboost.com/live/session/abc")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "https://afroboost.com/live/session/abc#social=facebook:connected"
    row = asyncio.run(store.lire("user-afroboost-0001", "facebook"))
    assert row["mode"] == "oauth" and row["account_id"] == "100000000000001"
    assert "PAGE-TOKEN-AFROBOOST-SECRET" not in str(row) and "PAGE-TOKEN-SPORDATEUR" not in str(row)
    assert "PAGE-TOKEN" not in caplog.text
    e = _etat(client, h, "facebook")
    assert e["status"] == "connected" and e["mode"] == "oauth" and "PAGE-TOKEN" not in str(e)
    # en mock, résoudre crée un ingest factice SANS réseau
    _FauxHttpx.appels.clear()
    res = asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook"))
    assert res["stream_key"].startswith("MOCK-FB-") and _FauxHttpx.appels == []
    # fin du direct : le lien OAuth reste, l'ingest à usage unique est oublié
    assert client.post("/social/destinations/facebook/finish", headers=h).json()["status"] == "connected"


def test_k3_oauth_facebook_compte_spordateur_refuse(oauth):
    mod, store, client, h = oauth
    _FauxHttpx.pages = [{"id": "999999999999999", "name": "Spordateur", "access_token": "PAGE-TOKEN-SPORDATEUR"}]
    state = _state_depuis(client, h, "facebook")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("#social=facebook:refused")
    assert asyncio.run(store.lire("user-afroboost-0001", "facebook")) is None, "rien n'est stocké pour un compte non Afroboost"
    assert _etat(client, h, "facebook")["status"] == "not_connected"
    # annulation côté Facebook
    state2 = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"error": "access_denied", "state": state2}, follow_redirects=False).headers["location"].endswith(":cancelled")


def test_k4_oauth_youtube_chaine_afroboost_puis_reconnexion(oauth):
    mod, store, client, h = oauth
    _FauxHttpx.chaines = [{"id": "UCspordateur", "snippet": {"title": "Spordateur"}}]
    state = _state_depuis(client, h, "youtube")
    assert client.get("/social/oauth/youtube/callback", params={"code": "CODE-YT", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    _FauxHttpx.chaines = [{"id": "UCafroboost0000000000", "snippet": {"title": "Afroboost"}}]
    state = _state_depuis(client, h, "youtube")
    r = client.get("/social/oauth/youtube/callback", params={"code": "CODE-YT", "state": state}, follow_redirects=False)
    assert r.headers["location"].endswith("#social=youtube:connected")
    row = asyncio.run(store.lire("user-afroboost-0001", "youtube"))
    assert "REFRESH-YT-SECRET" not in str(row) and row["mode"] == "oauth"
    assert _etat(client, h, "youtube")["status"] == "connected"
    # jeton révoqué → « Reconnexion nécessaire », plus rien n'est résolu
    asyncio.run(store.ecrire("user-afroboost-0001", "youtube", dict(row, status="reauth")))
    assert _etat(client, h, "youtube")["status"] == "reauth"
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "youtube")) is None


# ─── L. verrou du direct réel ────────────────────────────────────────────────────────────────
def test_l_verrou_direct_reel_ferme_par_defaut(contexte, monkeypatch):
    mod, store, client, h = contexte
    v = mod.verrou_direct_reel()
    assert v["autorise"] is False and v["live_mode"] == "mock" and v["multistream_mode"] == "mock"
    assert v["manque"] == ["SOCIAL_LIVE_MODE=real", "MULTISTREAM_MODE=egress", "SOCIAL_LIVE_GO=GO_BASSI_TEST_LIVE_SOCIAL"]
    monkeypatch.setenv("SOCIAL_LIVE_MODE", "real")
    monkeypatch.setenv("MULTISTREAM_MODE", "egress")
    assert mod.direct_reel_autorise() is False, "deux conditions sur trois : toujours verrouillé"
    monkeypatch.setenv("SOCIAL_LIVE_GO", "GO_BASSI_TEST_LIVE_SOCIAL")
    assert mod.direct_reel_autorise() is True
    assert client.get("/social/destinations/status", headers=h).json()["direct_reel_autorise"] is True


# ── MIGRATION AUTOMATIQUE (21/09) : la table est créée par le backend (pg-meta), et son absence n'est jamais un 500 ──
def test_m1_sql_schema_identique_a_la_doc_et_minimal(contexte_nu):
    mod, _store, _client, _afro = contexte_nu
    sql = mod.SQL_SCHEMA
    assert "create table if not exists public.social_destinations" in sql, "idempotent, une seule table"
    for col in ("user_id uuid not null references auth.users(id) on delete cascade", "platform text not null",
                "mode text not null", "rtmp_url text", "stream_key_enc text", "key_hint text", "oauth_token_enc text",
                "account_label text", "account_id text", "external_id text", "expires_at timestamptz",
                "status text not null default 'connected'", "updated_at timestamptz default now()",
                "unique (user_id, platform)"):
        assert col in sql, col
    assert "enable row level security" in sql, "RLS : service-role seul (aucune politique)"
    assert sql.count("create table") == 1 and "drop " not in sql.lower() and "alter table" in sql.lower(), "rien de destructif"
    # La doc et le code disent la même chose (colonnes du bloc « Table à créer »).
    doc = open(os.path.join(ICI, "..", "..", "docs", "multistream_plateformes.md"), encoding="utf-8").read()
    for col in ("stream_key_enc text", "oauth_token_enc text", "key_hint text", "unique (user_id, platform)"):
        assert col in doc, col


def test_m2_pgrst205_detecte_uniquement_sur_404_code_precis(contexte_nu):
    mod, _s, _c, _a = contexte_nu

    class R:
        def __init__(self, code, body): self.status_code, self._b = code, body
        def json(self): return self._b
    assert mod._schema_absent(R(404, {"code": "PGRST205", "message": "…"})) is True
    assert mod._schema_absent(R(404, {"code": "PGRST116"})) is False
    assert mod._schema_absent(R(200, [])) is False
    assert mod._schema_absent(R(500, {"code": "PGRST205"})) is False


def test_m3_table_absente_sans_migration_possible_dit_config_required_jamais_500(contexte_nu):
    mod, _store, client, afro = contexte_nu

    class StoreSansTable(mod.Stockage):
        async def lire_toutes(self, user_id):
            raise mod.SchemaAbsent()
    mod._deps.store = StoreSansTable()
    r = client.get("/social/destinations/status", headers=afro)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["schema"] == "absent"
    for d in j["destinations"]:
        assert d["status"] == "config_required"
        assert d["missing"][0] == mod.MANQUE_SCHEMA and "social_destinations" in d["missing"][0]
        assert "stream_key_enc" not in d and "oauth_token_enc" not in d
    assert j["direct_reel_autorise"] is False and j["multistream_mode"] == "mock"


def test_m4_assurer_schema_appelle_pg_query_avec_les_en_tetes_service_role(contexte_nu, monkeypatch):
    mod, _s, _c, _a = contexte_nu
    appels = []

    class FauxClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            appels.append((url, headers, json))
            class R: status_code = 201
            return R()
    import types, sys as _sys
    faux_httpx = types.SimpleNamespace(AsyncClient=FauxClient)
    monkeypatch.setitem(_sys.modules, "httpx", faux_httpx)
    st = mod.StockageSupabase("https://kong.test", lambda extra=None: {"apikey": "service-role-banc", **(extra or {})})
    import asyncio
    ok = asyncio.run(st.assurer_schema())
    assert ok is True and st.schema_ok is True
    url, headers, body = appels[0]
    assert url == "https://kong.test/pg/query" and headers["apikey"] == "service-role-banc"
    assert body["query"] == mod.SQL_SCHEMA


# ─── N. Facebook : repli RTMPS manuel (Live Producer) — jamais bloqué par Meta App Review ────
def _contexte_chiffre_sans_meta(monkeypatch):
    """Prod du 21/09 : clé de chiffrement posée, AUCUNE variable Meta (FACEBOOK_*, AFROBOOST_FB_PAGE_ID)."""
    for v in TOUTES_VARS:
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("SOCIAL_SECRETS_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SOCIAL_OAUTH_REDIRECT_BASE", "https://api-live.afroboost.com")
    mod = charger()
    store, client = _monter(mod)
    return mod, store, client


def test_n1_facebook_manuel_sans_variables_meta(monkeypatch, caplog):
    mod, store, client = _contexte_chiffre_sans_meta(monkeypatch)
    fb = _etat(client, AFRO, "facebook")
    # Sans Meta : « Configuration Meta requise » (noms exacts) MAIS le repli manuel est possible et le dit
    assert fb["status"] == "config_required"
    assert fb["missing"] == ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "AFROBOOST_FB_PAGE_ID", "FACEBOOK_LOGIN_CONFIG_ID"]
    assert fb["manual_ok"] is True and fb["oauth_ok"] is False
    # OAuth reste refusé proprement (409), le manuel passe
    assert client.get("/social/oauth/facebook/start", headers=AFRO).status_code == 409
    with caplog.at_level(logging.INFO):
        r = client.post("/social/destinations/facebook/manual",
                        json={"rtmp_url": "rtmps://live-api-s.facebook.com:443/rtmp/", "stream_key": SECRET_TEST, "account_label": "Page Afroboost"}, headers=AFRO)
    assert r.status_code == 200 and r.json()["status"] == "configured" and r.json()["mode"] == "manual"
    fb = _etat(client, AFRO, "facebook")
    assert fb["status"] == "configured" and fb["key_saved"] is True and fb["key_hint"] == SECRET_TEST[-4:]
    assert fb["kind"] == "oauth" and fb["manual_ok"] is True, "la plateforme reste OAuth-capable, le repli est un MODE"
    # jamais la clé : ni dans l'état, ni dans les journaux
    texte = client.get("/social/destinations/status", headers=AFRO).text + caplog.text
    assert SECRET_TEST not in texte
    # le moteur multistream la résout intacte, et l'état textuel est « configured » (cochable)
    assert asyncio.run(mod.resoudre_destination("user-afroboost-0001", "facebook")) == {"rtmp_url": "rtmps://live-api-s.facebook.com:443/rtmp/", "stream_key": SECRET_TEST}
    assert asyncio.run(mod.statut_compte("user-afroboost-0001", "facebook")) == "configured"
    # Supprimer → retour à l'état « Configuration Meta requise » (repli toujours possible)
    assert client.delete("/social/destinations/facebook", headers=AFRO).json()["status"] == "config_required"
    assert asyncio.run(store.lire("user-afroboost-0001", "facebook")) is None


def test_n2_facebook_avec_meta_deux_voies_oauth_intact(contexte):
    mod, store, client, h = contexte
    fb = _etat(client, h, "facebook")
    assert fb["status"] == "not_connected" and fb["manual_ok"] is True and fb["oauth_ok"] is True
    ok = client.post("/social/destinations/facebook/manual", json={"rtmp_url": "rtmps://live-api-s.facebook.com:443/rtmp/", "stream_key": SECRET_TEST}, headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "configured"
    assert _etat(client, h, "facebook")["status"] == "configured"
    # le parcours OAuth n'est pas cassé par le repli : l'URL est toujours fournie
    assert client.get("/social/oauth/facebook/start", params={"return_to": "https://afroboost.com/live/s"}, headers=h).status_code == 200


def test_n3_sans_chiffrement_pas_de_repli_et_youtube_inchange(contexte_nu, monkeypatch):
    mod, store, client, h = contexte_nu
    fb = _etat(client, h, "facebook")
    assert fb["status"] == "config_required" and fb["manual_ok"] is False and fb["missing"][0] == "SOCIAL_SECRETS_KEY"
    # YouTube : AUCUN changement de comportement (mission : ne pas toucher YouTube)
    mod2, store2, client2 = _contexte_chiffre_sans_meta(monkeypatch)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "x"); monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "y"); monkeypatch.setenv("AFROBOOST_YT_CHANNEL_ID", "UC1")
    yt = _etat(client2, AFRO, "youtube")
    assert yt["status"] == "not_connected" and yt["missing"] == []


def test_n4_facebook_login_for_business_config_id_obligatoire(contexte, monkeypatch):
    """L'app Afroboost EN LIGNE (1656270458951182) utilise « Facebook Login for Business » : le dialogue exige
    `config_id` (les permissions vivent dans la configuration). Sans FACEBOOK_LOGIN_CONFIG_ID → config_required
    propre (nom exact), jamais une URL `scope=` vouée à l'échec."""
    mod, store, client, h = contexte
    monkeypatch.delenv("FACEBOOK_LOGIN_CONFIG_ID")
    fb = _etat(client, h, "facebook")
    assert fb["status"] == "config_required" and fb["missing"] == ["FACEBOOK_LOGIN_CONFIG_ID"]
    assert fb["manual_ok"] is True and fb["oauth_ok"] is False, "le repli RTMPS manuel reste possible"
    o = client.get("/social/oauth/facebook/start", params={"return_to": "https://afroboost.com/live/s"}, headers=h)
    assert o.status_code == 409 and o.json()["detail"]["missing"] == ["FACEBOOK_LOGIN_CONFIG_ID"]
    # YouTube : rien ne change
    assert _etat(client, h, "youtube")["status"] == "not_connected"


def test_n5_facebook_url_flb_complete_et_config_studiio_jamais_utilisee(contexte):
    mod, store, client, h = contexte
    url = client.get("/social/oauth/facebook/start", params={"return_to": "https://afroboost.com/live/s"}, headers=h).json()["url"]
    q = unquote(url)
    assert url.startswith("https://www.facebook.com/v25.0/dialog/oauth?")
    assert "client_id=123456" in q and "config_id=424242424242424" in q
    assert "redirect_uri=https://api-live.afroboost.com/social/oauth/facebook/callback" in q
    assert "response_type=code" in q and "override_default_response_type=true" in q and "state=" in q
    assert "scope=" not in q, "FLB : les permissions vivent dans la configuration, pas dans scope"
    # la valeur vient de l'ENVIRONNEMENT : aucun identifiant de configuration (Afroboost Live OU Studiio) codé en dur
    src = open(MODULE, encoding="utf-8").read()
    assert "1342881384674039" not in src and "2979197062472428" not in src and "424242424242424" not in src
    assert "1342881384674039" not in url, "la configuration Studiio n'est jamais utilisée"
    assert "secret-app-fb" not in url


def test_n6_callback_flb_page_afroboost_seule_acceptee_jamais_la_premiere(oauth, caplog):
    """/me/accounts renvoie la Page Studiio EN PREMIER puis Afroboost : seule 100000000000001 est retenue ;
    sans elle → refus propre, rien de stocké ; le jeton de Page n'apparaît ni en clair ni dans les journaux."""
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    _FauxHttpx.pages = [{"id": "555555555555555", "name": "Studiio", "access_token": "PAGE-TOKEN-STUDIIO"},
                        {"id": "100000000000001", "name": "Afroboost", "access_token": "PAGE-TOKEN-AFROBOOST-SECRET"}]
    state = _state_depuis(client, h, "facebook", "https://afroboost.com/live/session/abc")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "https://afroboost.com/live/session/abc#social=facebook:connected"
    row = asyncio.run(store.lire("user-afroboost-0001", "facebook"))
    assert row["account_id"] == "100000000000001" and row["mode"] == "oauth"
    assert row["oauth_token_enc"] and "PAGE-TOKEN" not in str(row), "jeton de Page stocké CHIFFRÉ"
    assert mod._dechiffrer(row["oauth_token_enc"]) == "PAGE-TOKEN-AFROBOOST-SECRET", "et déchiffrable côté serveur seulement"
    assert "PAGE-TOKEN" not in caplog.text and "PAGE-TOKEN" not in client.get("/social/destinations/status", headers=h).text
    # sans la Page Afroboost (même si d'autres Pages existent) → refus, aucune écriture
    asyncio.run(store.supprimer("user-afroboost-0001", "facebook"))
    _FauxHttpx.pages = [{"id": "555555555555555", "name": "Studiio", "access_token": "PAGE-TOKEN-STUDIIO"}]
    state = _state_depuis(client, h, "facebook")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.headers["location"].endswith("#social=facebook:refused")
    assert asyncio.run(store.lire("user-afroboost-0001", "facebook")) is None


# ─── O. Sécurité des journaux + diagnostic /me/accounts SANS secret ───────────────────────────
def test_o1_httpx_httpcore_ne_journalisent_jamais_une_url_avec_jeton(contexte, caplog):
    """httpx journalise en INFO « HTTP Request: GET <url> » — avec `?access_token=…` dans l'URL de /me/accounts.
    Charger le module doit ramener httpx/httpcore à WARNING : un jeton fictif ne doit JAMAIS atteindre les logs."""
    mod, store, client, h = contexte
    assert logging.getLogger("httpx").level >= logging.WARNING and logging.getLogger("httpcore").level >= logging.WARNING
    with caplog.at_level(logging.DEBUG):
        logging.getLogger("httpx").info("HTTP Request: GET https://graph.facebook.com/v25.0/me/accounts?access_token=SECRET_TEST_123 \"HTTP/1.1 200 OK\"")
        logging.getLogger("httpcore.http11").debug("send_request_headers.started access_token=SECRET_TEST_123")
    assert "SECRET_TEST_123" not in caplog.text


def test_o2_diagnostic_me_accounts_sans_secret_page_trouvee(oauth, caplog):
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    _FauxHttpx.pages = [{"id": "555555555555555", "name": "Studiio", "access_token": "PAGE-TOKEN-STUDIIO", "tasks": ["ANALYZE"]},
                        {"id": "100000000000001", "name": "Afroboost", "access_token": "PAGE-TOKEN-AFROBOOST-SECRET", "tasks": ["MODERATE", "CREATE_CONTENT", "MANAGE"]}]
    state = _state_depuis(client, h, "facebook", "https://afroboost.com/live/session/abc")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.headers["location"].endswith("#social=facebook:connected")
    t = caplog.text
    assert "EXPECTED_PAGE_ID=100000000000001" in t and "ACCOUNTS_COUNT=2" in t
    assert "PAGE_ID=555555555555555 PAGE_NAME=Studiio HAS_ACCESS_TOKEN=true TASKS=ANALYZE" in t
    assert "PAGE_ID=100000000000001 PAGE_NAME=Afroboost HAS_ACCESS_TOKEN=true TASKS=MODERATE,CREATE_CONTENT,MANAGE" in t
    assert "MATCH_FOUND=true MATCH_HAS_ACCESS_TOKEN=true" in t
    for interdit in ("PAGE-TOKEN", "USER-TOKEN-FB", "CODE-FB", "secret-app-fb", state):
        assert interdit not in t, f"jamais « {interdit} » dans les journaux"
    # l'appel demande explicitement les champs utiles, jamais par en-tête Authorization en clair dans un log
    assert ("GET", "https://graph.facebook.com/v25.0/me/accounts") in _FauxHttpx.appels


def test_o3_diagnostic_me_accounts_page_absente_et_sans_jeton(oauth, caplog):
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    # C : la Page attendue n'est pas dans la liste
    _FauxHttpx.pages = [{"id": "555555555555555", "name": "Studiio", "access_token": "PAGE-TOKEN-STUDIIO"}]
    state = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    assert "ACCOUNTS_COUNT=1" in caplog.text and "MATCH_FOUND=false MATCH_HAS_ACCESS_TOKEN=false" in caplog.text
    # B : présente mais SANS access_token → refus, et le diagnostic le dit
    caplog.clear()
    _FauxHttpx.pages = [{"id": "100000000000001", "name": "Afroboost", "tasks": ["ANALYZE"]}]
    state = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    assert "PAGE_ID=100000000000001 PAGE_NAME=Afroboost HAS_ACCESS_TOKEN=false TASKS=ANALYZE" in caplog.text
    assert "MATCH_FOUND=true MATCH_HAS_ACCESS_TOKEN=false" in caplog.text
    # A : data vide
    caplog.clear(); _FauxHttpx.pages = []
    state = _state_depuis(client, h, "facebook")
    client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert "ACCOUNTS_COUNT=0" in caplog.text
    assert "PAGE-TOKEN" not in caplog.text


def test_o4_diagnostic_me_accounts_erreur_graph_structuree(oauth, caplog):
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    _FauxHttpx.accounts_reponse = _Reponse(400, {"error": {"message": "(#200) Requires pages_show_list", "type": "OAuthException", "code": 200, "error_subcode": 1349125, "fbtrace_id": "AbC"}})
    state = _state_depuis(client, h, "facebook")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.headers["location"].endswith("#social=facebook:error")
    t = caplog.text
    assert "GRAPH_ERROR HTTP=400 type=OAuthException code=200 subcode=1349125 message=(#200) Requires pages_show_list" in t
    assert "USER-TOKEN-FB" not in t and "CODE-FB" not in t


def test_o5_me_accounts_vide_mais_page_accordee_via_business_consultation_directe(oauth, caplog):
    """Prod 22/09 : la Page est ACCORDÉE à l'app (intégrations professionnelles) mais /me/accounts renvoie data=[]
    (Page d'un portefeuille Business). Repli : GET /{PAGE_ID}?fields=id,name,access_token,tasks — accepté SEULEMENT
    si l'id renvoyé est AFROBOOST_FB_PAGE_ID et qu'un jeton de Page est présent. Diagnostic sans secret."""
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    _FauxHttpx.pages = []
    _FauxHttpx.page_directe = _Reponse(200, {"id": "100000000000001", "name": "Afroboost", "access_token": "PAGE-TOKEN-AFROBOOST-SECRET", "tasks": ["MANAGE", "CREATE_CONTENT"]})
    state = _state_depuis(client, h, "facebook", "https://afroboost.com/live/session/abc")
    r = client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("#social=facebook:connected")
    t = caplog.text
    assert "ACCOUNTS_COUNT=0" in t and "MATCH_FOUND=false" in t
    assert "PERMISSIONS granted=pages_show_list declined=publish_video" in t
    assert "DIRECT_PAGE HTTP=200 PAGE_ID=100000000000001 PAGE_NAME=Afroboost HAS_ACCESS_TOKEN=true TASKS=MANAGE,CREATE_CONTENT" in t
    assert "PAGE-TOKEN" not in t and "USER-TOKEN-FB" not in t and "CODE-FB" not in t
    row = asyncio.run(store.lire("user-afroboost-0001", "facebook"))
    assert row["account_id"] == "100000000000001" and row["mode"] == "oauth" and "PAGE-TOKEN" not in str(row)
    assert mod._dechiffrer(row["oauth_token_enc"]) == "PAGE-TOKEN-AFROBOOST-SECRET"
    assert _etat(client, h, "facebook")["status"] == "connected"
    # la consultation directe ne porte que sur l'ID ATTENDU (jamais une autre Page), avec les champs utiles
    assert ("GET", "https://graph.facebook.com/v25.0/100000000000001") in _FauxHttpx.appels


def test_o6_consultation_directe_refuse_autre_id_ou_sans_jeton_ou_erreur(oauth, caplog):
    mod, store, client, h = oauth
    caplog.set_level(logging.INFO)
    # Graph renvoie un AUTRE id sous cette URL → refus (garde stricte)
    _FauxHttpx.pages = []
    _FauxHttpx.page_directe = _Reponse(200, {"id": "999999999999999", "name": "Spordateur", "access_token": "PAGE-TOKEN-SPORDATEUR"})
    state = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    assert asyncio.run(store.lire("user-afroboost-0001", "facebook")) is None
    # présente mais sans jeton → refus
    _FauxHttpx.page_directe = _Reponse(200, {"id": "100000000000001", "name": "Afroboost"})
    state = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    assert "DIRECT_PAGE HTTP=200 PAGE_ID=100000000000001 PAGE_NAME=Afroboost HAS_ACCESS_TOKEN=false" in caplog.text
    # erreur Graph structurée → refus, journal sans secret
    caplog.clear(); _FauxHttpx.page_directe = None
    state = _state_depuis(client, h, "facebook")
    assert client.get("/social/oauth/facebook/callback", params={"code": "CODE-FB", "state": state}, follow_redirects=False).headers["location"].endswith(":refused")
    assert "DIRECT_PAGE GRAPH_ERROR HTTP=400 type=GraphMethodException code=100 subcode=33 message=Unsupported get request" in caplog.text
    assert "PAGE-TOKEN" not in caplog.text and "USER-TOKEN-FB" not in caplog.text
