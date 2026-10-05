"""
👤 Invité Live — relais BoostTribe → Contacts Afroboost (Phase 1, 05/10/2026).

Le navigateur n'a JAMAIS le secret : il appelle `/live/invite-contact` ; le serveur
vérifie la session, limite le débit, ne relaie que pour l'origine Afroboost, et signe un
jeton RÉSERVÉ à cet usage (iss=boosttribe, aud=afroboost-contacts, jti, 5 min).
Photo d'un invité anonyme : `/live/invite-photo` (bucket public existant), jamais en base64.
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
                    p = base.profiles.get(filtre(params, "id"))
                    return Rep(200, [dict(p)] if p else [])
                return Rep(404, {})

            async def patch(self, url, headers=None, params=None, json=None):
                if "/playlists" in url:
                    sid = filtre(params, "session_id")
                    lignes = [r for r in base.playlists if r["session_id"] == sid]
                    for r in lignes:
                        r.update(json or {})
                    return Rep(200, [dict(r) for r in lignes])
                if "/profiles" in url:
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
    spec = importlib.util.spec_from_file_location("btmain_invite", MAIN)
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





import jwt as _jwt


class Corps:
    def __init__(self, **k): self.__dict__.update(k)


class Req:
    def __init__(self, origine="https://afroboost.com", ip="1.2.3.4"):
        self.headers = {"origin": origine} if origine else {}
        self.client = type("C", (), {"host": ip})()


def _contact(m, **k):
    d = dict(session_id="LIVE1-AAAA", pseudo="Léa", email="lea@exemple.ch", whatsapp="079 123 45 67", photo_url=None)
    d.update(k)
    return m.InviteContactBody(**d)


@pytest.fixture()
def relais(m, monkeypatch):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE})
    envoyes = []

    async def poster(url, jeton):
        envoyes.append((url, jeton))
        return 200
    monkeypatch.setattr(m, "_invite_poster", poster)
    monkeypatch.setattr(m, "AFRO_BT_SHARED_SECRET", "secret-partage-de-test-assez-long-pour-hs256")
    m._invite_debit.clear()
    return envoyes


def test_relais_signe_un_jeton_reserve_a_cet_usage(m, relais):
    r = lancer(m.live_invite_contact(_contact(m), Req()))
    assert r["ok"] is True and len(relais) == 1
    url, jeton = relais[0]
    assert url.endswith("/api/boosttribe/live-guest")
    p = _jwt.decode(jeton, "secret-partage-de-test-assez-long-pour-hs256", algorithms=["HS256"],
                    audience="afroboost-contacts", issuer="boosttribe")
    assert p["session_code"] == "LIVE1-AAAA" and p["email"] == "lea@exemple.ch" and p["jti"]
    assert p["exp"] - p["iat"] <= 300
    with pytest.raises(_jwt.InvalidAudienceError):          # inutilisable comme jeton d'accès BoostTribe
        _jwt.decode(jeton, "secret-partage-de-test-assez-long-pour-hs256", algorithms=["HS256"], audience="boosttribe")


def test_session_inconnue_refusee(m, relais):
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m, session_id="INCONNU-ZZZZ"), Req()))
    assert e.value.status_code == 404 and relais == []


def test_origine_non_afroboost_jamais_relayee(m, relais):
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m), Req(origine="https://boosttribe.pro")))
    assert e.value.status_code == 403 and relais == []


def test_au_moins_un_moyen_de_contact(m, relais):
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m, email="", whatsapp=""), Req()))
    assert e.value.status_code == 400


def test_debit_limite_par_ip(m, relais):
    for _ in range(m.INVITE_DEBIT_MAX):
        lancer(m.live_invite_contact(_contact(m), Req(ip="9.9.9.9")))
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m), Req(ip="9.9.9.9")))
    assert e.value.status_code == 429


def test_photo_etrangere_jamais_relayee(m, relais):
    lancer(m.live_invite_contact(_contact(m, photo_url="https://evil.example/x.jpg"), Req()))
    p = _jwt.decode(relais[0][1], options={"verify_signature": False})
    assert not p.get("photo_url")


def test_secret_absent_aucun_relais(m, relais, monkeypatch):
    monkeypatch.setattr(m, "AFRO_BT_SHARED_SECRET", "")
    r = lancer(m.live_invite_contact(_contact(m), Req()))
    assert r["ok"] is False and relais == []


# ═══ Revue de sécurité du 05/10 (commit 1c7a203, avant déploiement) ═══

class ReqXff(Req):
    def __init__(self, xff, pair="10.0.0.7"):
        super().__init__()
        self.headers["x-forwarded-for"] = xff
        self.client = type("C", (), {"host": pair})()


def test_securite_xff_falsifie_ne_contourne_pas_la_limite(m, relais):
    """La 1re valeur de X-Forwarded-For est écrite par le CLIENT : la changer ne doit rien changer."""
    for i in range(m.INVITE_DEBIT_MAX):
        lancer(m.live_invite_contact(_contact(m), ReqXff(f"6.6.6.{i}, 203.0.113.9")))
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m), ReqXff("7.7.7.7, 203.0.113.9")))
    assert e.value.status_code == 429


def test_securite_plafond_par_session_quelle_que_soit_l_ip(m, relais, monkeypatch):
    monkeypatch.setattr(m, "INVITE_SESSION_MAX", 3)
    for i in range(3):
        lancer(m.live_invite_contact(_contact(m), Req(ip=f"8.8.8.{i}")))
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_contact(_contact(m), Req(ip="8.8.8.99")))
    assert e.value.status_code == 429


class Fichier:
    def __init__(self, ct, data):
        self.content_type, self._d = ct, data

    async def read(self):
        return self._d


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture()
def depot(m, monkeypatch):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE})
    deposes = []

    async def deposer(chemin, ct, data):
        deposes.append((chemin, ct, len(data)))
        return 200
    monkeypatch.setattr(m, "_invite_deposer", deposer)
    m._invite_debit.clear()
    return deposes


@pytest.mark.parametrize("ct, data, ext", [("image/jpeg", JPEG, "jpg"), ("image/png", PNG, "png"), ("image/webp", WEBP, "webp")])
def test_securite_photo_vraie_image_acceptee(m, depot, ct, data, ext):
    r = lancer(m.live_invite_photo(Req(), "LIVE1-AAAA", Fichier(ct, data)))
    assert r["url"].endswith("." + ext) and depot[0][1] == ct


@pytest.mark.parametrize("data", [b"<html><script>alert(1)</script></html>", b"%PDF-1.7", b"GIF89a....", b""])
def test_securite_photo_contenu_non_image_refuse_meme_si_le_type_ment(m, depot, data):
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_photo(Req(), "LIVE1-AAAA", Fichier("image/jpeg", data)))
    assert e.value.status_code == 400 and depot == []


def test_securite_type_deduit_du_contenu_pas_de_l_en_tete(m, depot):
    lancer(m.live_invite_photo(Req(), "LIVE1-AAAA", Fichier("image/jpeg", PNG)))
    assert depot[0][1] == "image/png" and depot[0][0].endswith(".png")


def test_securite_plafond_photos_par_session(m, depot, monkeypatch):
    monkeypatch.setattr(m, "INVITE_SESSION_MAX", 2)
    for i in range(2):
        lancer(m.live_invite_photo(Req(ip=f"5.5.5.{i}"), "LIVE1-AAAA", Fichier("image/jpeg", JPEG)))
    with pytest.raises(HTTPException) as e:
        lancer(m.live_invite_photo(Req(ip="5.5.5.9"), "LIVE1-AAAA", Fichier("image/jpeg", JPEG)))
    assert e.value.status_code == 429
