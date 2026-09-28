"""
🚪 Page promo = MÊME lecture que la page session (audit 28/09).

- `access_mode` : plusieurs lignes `playlists` pour une session → la plus RÉCENTE
  (updated_at desc) portant une valeur valide — la règle exacte de SessionPage.
- `mode` (open/paid/private) : la MÊME source que `/session/info` (get_session_row),
  pour qu'une session « Gratuit par lien » (private) soit gratuite sur la page promo
  même si un ancien lien de paiement traîne.

Lancer : python3 -m pytest backend/tests/test_promo_acces.py -q
"""
import asyncio
import importlib.util
import os

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle-test",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256",
                 "LIVEKIT_URL": "wss://sfu.test", "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_promo_acces", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def executer(coro):
    boucle = asyncio.new_event_loop()
    try:
        return boucle.run_until_complete(coro)
    finally:
        boucle.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


# Lignes en base, dans l'ordre d'INSERTION (la plus ancienne d'abord) : PostgREST sans
# `order` peut rendre celle-là en premier.
LIGNES = [
    {"updated_at": "2026-09-01T10:00:00+00:00", "access_mode": "guest", "promo_enabled": False,
     "promo_payment_link": "https://pay.example/ancien"},
    {"updated_at": "2026-09-28T20:00:00+00:00", "access_mode": "account", "promo_enabled": True,
     "promo_payment_link": "https://pay.example/ancien"},
]


class _Rep:
    status_code = 200

    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d


def _faux_client(appels):
    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            appels.append(dict(params or {}))
            rows = list(LIGNES)
            if str((params or {}).get("order", "")).startswith("updated_at.desc"):
                rows.sort(key=lambda r: r["updated_at"], reverse=True)
            lim = (params or {}).get("limit")
            return _Rep(rows[: int(lim)] if lim else rows)
    return Client


def _promo(monkeypatch, mode_session="private"):
    m = charger_main()
    appels = []
    monkeypatch.setattr(m.httpx, "AsyncClient", _faux_client(appels))

    async def fausse_ligne(session_id):
        return {"session_id": session_id, "mode": mode_session}
    monkeypatch.setattr(m, "get_session_row", fausse_ligne)
    return executer(m.get_promo("AAAA1111-BBBB22")), appels


def test_access_mode_la_plus_recente_valide(monkeypatch):
    rep, appels = _promo(monkeypatch)
    assert rep["access_mode"] == "account", rep
    assert any(str(p.get("order", "")).startswith("updated_at.desc") for p in appels), appels


def test_mode_expose_depuis_la_meme_source_que_session_info(monkeypatch):
    rep, _ = _promo(monkeypatch, "private")
    assert rep.get("mode") == "private", rep
    rep2, _ = _promo(monkeypatch, None)
    assert rep2.get("mode") == "open", rep2          # même défaut que /session/info


def test_payment_link_conserve(monkeypatch):
    rep, _ = _promo(monkeypatch)
    assert rep["payment_link"] == "https://pay.example/ancien"  # on ne supprime rien
