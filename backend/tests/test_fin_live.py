"""
🔴 V571 — « Terminer le Live » rend l'ancien lien d'invitation définitivement mort.

Avant : aucune trace de fin côté BoostTribe — un participant qui ouvrait l'ancien lien après la
fin tombait dans une salle vide (« En attente de l'hôte »). Désormais : `playlists.live_ended_at`
(colonne ajoutée par migration idempotente au démarrage), posée par l'hôte SEUL, lue en public
par `/session/{id}/etat-live`. Fermer la fenêtre / recharger ne pose JAMAIS cette marque.
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
    spec = importlib.util.spec_from_file_location("btmain_fin_live", MAIN)
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




def test_terminer_marque_la_session_et_l_etat_le_dit(m):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE})
    assert lancer(m.session_etat_live("LIVE1-AAAA"))["termine"] is False
    r = lancer(m.session_terminer_live("LIVE1-AAAA", authorization="Bearer hote"))
    assert r["ok"] is True and m._base.playlists[0].get("live_ended_at")
    assert lancer(m.session_etat_live("LIVE1-AAAA"))["termine"] is True


def test_seul_l_hote_peut_terminer(m):
    m._base.playlists.append({"session_id": "LIVE1-AAAA", "host_id": HOTE})
    with pytest.raises(HTTPException) as e:
        lancer(m.session_terminer_live("LIVE1-AAAA", authorization="Bearer autre"))
    assert e.value.status_code == 403
    assert not m._base.playlists[0].get("live_ended_at")


def test_code_invalide_refuse(m):
    with pytest.raises(HTTPException) as e:
        lancer(m.session_etat_live("../x"))
    assert e.value.status_code == 400


def test_colonne_absente_ou_base_muette_jamais_un_faux_termine(m):
    class Muet:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return type("R", (), {"status_code": 400, "json": lambda s: {"code": "42703"}})()
    m.httpx.AsyncClient = Muet
    assert lancer(m.session_etat_live("LIVE1-AAAA"))["termine"] is False


def test_migration_additive_et_idempotente(m):
    sql = m.SQL_FIN_LIVE.lower()
    assert "add column if not exists live_ended_at" in sql
    assert "drop" not in sql and "delete" not in sql
