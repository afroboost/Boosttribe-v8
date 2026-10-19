"""
🧪 FAUX SUPABASE + FAUX AFROBOOST, en mémoire — pour les bancs S0.

Le code de `main.py` parle à Supabase en HTTP (`httpx.AsyncClient` → PostgREST / GoTrue).
Plutôt que de remplacer ses fonctions une par une (on testerait alors nos doublures), on
remplace le RÉSEAU : chaque `httpx.AsyncClient` créé par `main.py` reçoit un transport qui
répond comme PostgREST / GoTrue / l'endpoint `consume` d'Afroboost. Le VRAI code du backend
(`get_balance`, `is_coach_unlimited`, `/api/embed/verify`, `/livekit/token`…) s'exécute.

Ce que ce faux NE prouve PAS : les règles SQL (RLS, triggers, fonctions). Elles sont
vérifiées à part, dans un vrai Postgres local (`infra/s0/tests_s0.sql`).
"""
import itertools
import json
import types
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlparse

import httpx
from httpx._client import AsyncClient as _ASYNC_CLIENT_ORIGINE   # d'autres bancs écrasent httpx.AsyncClient sans le restaurer

SUPABASE = "http://supabase.test"
AFROBOOST_CONSUME = "https://afroboost.test/api/boosttribe/consume"


def maintenant():
    return datetime.now(timezone.utc)


def _iso_dans_le_futur(v):
    if not v:
        return False
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")) > maintenant()
    except Exception:  # noqa: BLE001
        return False


class FauxSupabase:
    def __init__(self):
        self.tables = {"profiles": [], "credit_ledger": [], "playlists": [], "tickets": [],
                       "access_requests": [], "coach_subscriptions": [], "pricing_settings": [
                           {"id": "default", "cost_join": 1, "cost_host": 1, "cost_record_transcribe": 4,
                            "credit_validity_months": 12, "signup_free_credits": 1}],
                       "session_recordings": [], "site_settings": []}
        self.users = {}            # uid -> {id, email, user_metadata, app_metadata}
        self.tokens = {}           # "Bearer x" -> uid
        self.ids = itertools.count(1)
        # Afroboost : comportement de /api/boosttribe/consume
        self.afro_mode = "ok"      # ok | no_credit | refus_401 | erreur_500 | injoignable
        self.afro_debits = {}      # jti -> nombre de débits RÉELS (idempotent comme le vrai)
        self.afro_appels = 0

    # ── fabrique de données ───────────────────────────────────────────────────────────────
    def utilisateur(self, email, jeton=None, **profil):
        uid = str(uuid.uuid4())
        self.users[uid] = {"id": uid, "email": email, "user_metadata": {}, "app_metadata": {}}
        if jeton:
            self.tokens["Bearer " + jeton] = uid
        row = {"id": uid, "email": email, "credits": 0, "comp_access_plan": None,
               "comp_access_until": None, "coach_payment_type": None, "role": "user"}
        row.update(profil)
        self.tables["profiles"].append(row)
        return uid

    def crediter(self, uid, n, reason="purchase", ref=None, expires_at=None):
        self._ledger_inserer(uid, abs(n), reason, ref, None, expires_at)

    def profil(self, uid):
        return next(r for r in self.tables["profiles"] if r["id"] == uid)

    def ledger(self, uid=None):
        return [r for r in self.tables["credit_ledger"] if uid is None or r["user_id"] == uid]

    def debits(self, uid):
        return [r for r in self.ledger(uid) if r["delta"] < 0]

    # ── logique « base » (modèle de la fonction SQL credits_disponibles) ──────────────────
    def disponibles(self, uid):
        """Même règle que la fonction SQL : rejeu chronologique, lots valides à la date de la dépense."""
        def instant(v, defaut):
            return datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else defaut
        infini = datetime.max.replace(tzinfo=timezone.utc)
        lots = []
        for r in self.ledger(uid):
            t = instant(r.get("created_at"), maintenant())
            if r["delta"] > 0:
                lots.append([instant(r.get("expires_at"), infini), r["delta"]])
            elif r["delta"] < 0:
                besoin = -r["delta"]
                for lot in sorted((l for l in lots if l[1] > 0 and l[0] > t), key=lambda l: l[0]):
                    pris = min(lot[1], besoin)
                    lot[1] -= pris
                    besoin -= pris
                    if not besoin:
                        break
        return sum(l[1] for l in lots if l[0] > maintenant())

    def _ledger_inserer(self, uid, delta, reason, ref, note, expires_at=None):
        if ref is not None and any(r["reason"] == reason and r.get("ref") == ref for r in self.tables["credit_ledger"]):
            return False
        self.tables["credit_ledger"].append({"id": next(self.ids), "user_id": uid, "delta": delta, "reason": reason,
                                             "ref": ref, "note": note, "expires_at": expires_at,
                                             "created_at": maintenant().isoformat()})
        for p in self.tables["profiles"]:
            if p["id"] == uid:
                p["credits"] = self.disponibles(uid)
        return True

    # ── PostgREST ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _filtre(row, cle, expr):
        v = row.get(cle)
        op, _, val = expr.partition(".")
        if op == "eq":
            return str(v) == val if v is not None else False
        if op == "neq":
            return str(v) != val
        if op == "is":
            return v is None if val == "null" else str(v).lower() == val
        if op in ("like", "ilike"):
            # Comme Postgres : `*` (PostgREST) = `%` = n'importe quelle suite ; `_` = UN caractère quelconque.
            import re as _re
            motif = "".join(".*" if ch == "*" or ch == "%" else "." if ch == "_" else _re.escape(ch) for ch in val)
            return v is not None and _re.fullmatch(motif, str(v), _re.I if op == "ilike" else 0) is not None
        if op == "in":
            return str(v) in [x.strip('"') for x in val.strip("()").split(",")]
        if op in ("gt", "gte", "lt", "lte"):
            if v is None:
                return False
            a, b = str(v), val
            return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
        return True

    def _selection(self, table, params):
        rows = self.tables.setdefault(table, [])
        speciaux = {"select", "order", "limit", "offset", "on_conflict"}
        out = [r for r in rows if all(self._filtre(r, k, v) for k, v in params if k not in speciaux)]
        ordre = dict(params).get("order")
        if ordre:
            col, _, sens = ordre.partition(".")
            out = sorted(out, key=lambda r: str(r.get(col) or ""), reverse=sens.startswith("desc"))
        lim = dict(params).get("limit")
        return out[: int(lim)] if lim else out

    @staticmethod
    def _projeter(rows, params):
        sel = dict(params).get("select") or "*"
        if sel == "*" or "(" in sel:
            return [dict(r) for r in rows]
        cols = [c.strip() for c in sel.split(",")]
        return [{c: r.get(c) for c in cols} for r in rows]

    def _rest(self, req, table, params):
        m = req.method
        if m == "GET":
            return httpx.Response(200, json=self._projeter(self._selection(table, params), params))
        corps = json.loads(req.content or b"null")
        if m == "PATCH":
            rows = self._selection(table, params)
            for r in rows:
                r.update(corps)
            return httpx.Response(200, json=[dict(r) for r in rows])
        if m == "POST":
            lignes = corps if isinstance(corps, list) else [corps]
            cle = dict(params).get("on_conflict")
            pref = req.headers.get("prefer", "")
            out = []
            for l in lignes:
                ex = None
                if cle and "merge-duplicates" in pref:
                    ex = next((r for r in self.tables.setdefault(table, []) if r.get(cle) == l.get(cle)), None)
                if ex is None and table == "playlists" and any(
                        r.get("session_id") == l.get("session_id") for r in self.tables.setdefault(table, [])):
                    return httpx.Response(409, json={"code": "23505", "message": "duplicate key (session_id)"})
                if ex is not None:
                    ex.update(l)
                    out.append(dict(ex))
                else:
                    neuf = dict(l)
                    neuf.setdefault("id", next(self.ids)) if table != "profiles" else None
                    self.tables.setdefault(table, []).append(neuf)
                    out.append(dict(neuf))
            return httpx.Response(201, json=out)
        if m == "DELETE":
            rows = self._selection(table, params)
            self.tables[table] = [r for r in self.tables[table] if r not in rows]
            return httpx.Response(204)
        return httpx.Response(405)

    def _rpc(self, fn, corps):
        uid = corps.get("p_user")
        if fn == "credits_disponibles":
            return httpx.Response(200, json=self.disponibles(uid))
        if fn == "add_credits":
            self._ledger_inserer(uid, abs(int(corps["p_amount"])), corps["p_reason"], corps.get("p_ref"),
                                 corps.get("p_note"), corps.get("p_expires"))
            return httpx.Response(200, json=self.disponibles(uid))
        if fn == "spend_credits":
            ref, reason, n = corps.get("p_ref"), corps["p_reason"], int(corps["p_amount"])
            if ref is not None and any(r["reason"] == reason and r.get("ref") == ref for r in self.tables["credit_ledger"]):
                return httpx.Response(200, json=self.disponibles(uid))
            if self.disponibles(uid) < n:
                return httpx.Response(400, json={"code": "P0001", "message": "insufficient_credits"})
            self._ledger_inserer(uid, -abs(n), reason, ref, corps.get("p_note"))
            return httpx.Response(200, json=self.disponibles(uid))
        return httpx.Response(404, json={"message": "fonction inconnue"})

    # ── GoTrue ────────────────────────────────────────────────────────────────────────────
    def _auth(self, req, chemin, params):
        if chemin == "/auth/v1/user":
            uid = self.tokens.get(req.headers.get("authorization", ""))
            return httpx.Response(200, json=self.users[uid]) if uid else httpx.Response(401, json={"msg": "invalid"})
        if chemin == "/auth/v1/admin/users" and req.method == "GET":
            return httpx.Response(200, json={"users": list(self.users.values())})
        if chemin == "/auth/v1/admin/users" and req.method == "POST":
            c = json.loads(req.content)
            if any(u["email"] == c["email"] for u in self.users.values()):
                return httpx.Response(422, json={"msg": "exists"})
            uid = str(uuid.uuid4())
            self.users[uid] = {"id": uid, "email": c["email"], "user_metadata": c.get("user_metadata") or {},
                               "app_metadata": {}}
            return httpx.Response(200, json=self.users[uid])
        if chemin.startswith("/auth/v1/admin/users/"):
            uid = chemin.rsplit("/", 1)[-1]
            return httpx.Response(200, json=self.users.get(uid, {}))
        if chemin == "/auth/v1/admin/generate_link":
            return httpx.Response(200, json={"properties": {"hashed_token": "h", "email_otp": "000000",
                                                            "verification_type": "magiclink"}})
        return httpx.Response(404)

    # ── Afroboost /api/boosttribe/consume (idempotent sur jti, comme le vrai) ─────────────
    def _afroboost(self, req):
        self.afro_appels += 1
        if self.afro_mode == "injoignable":
            raise httpx.ConnectError("afroboost injoignable", request=req)
        if self.afro_mode == "erreur_500":
            return httpx.Response(502, text="<html>Bad Gateway</html>")
        if self.afro_mode == "refus_401":
            return httpx.Response(401, json={"detail": "token invalide"})
        if self.afro_mode == "no_credit":
            return httpx.Response(200, json={"ok": False, "reason": "no_credit"})
        import jwt as _j
        jti = _j.decode(json.loads(req.content)["token"], options={"verify_signature": False})["jti"]
        self.afro_debits[jti] = 1                       # un seul débit par jti, quel que soit le nombre d'appels
        return httpx.Response(200, json={"ok": True, "remaining_credits": 3})

    def gerer(self, req: httpx.Request) -> httpx.Response:
        u = urlparse(str(req.url))
        params = parse_qsl(u.query, keep_blank_values=True)
        if str(req.url).startswith(AFROBOOST_CONSUME):
            return self._afroboost(req)
        if u.path.startswith("/rest/v1/rpc/"):
            return self._rpc(u.path.rsplit("/", 1)[-1], json.loads(req.content or b"{}"))
        if u.path.startswith("/rest/v1/"):
            return self._rest(req, u.path[len("/rest/v1/"):], params)
        if u.path.startswith("/auth/v1/"):
            return self._auth(req, u.path, params)
        if u.path.startswith("/storage/v1/object/"):
            return httpx.Response(200, json={"Key": u.path, "signedURL": "/object/sign/x?token=t"})
        if u.path.startswith("/pg/query"):
            return httpx.Response(200, json=[])
        return httpx.Response(404, json={"message": "hors périmètre du faux"})

    def brancher(self, monkeypatch, m):
        """Toute connexion HTTP sortante de `main.py` passe désormais par ce faux."""
        transport = httpx.MockTransport(self.gerer)
        vrai = _ASYNC_CLIENT_ORIGINE

        def client(*a, **kw):
            kw.pop("transport", None)
            return vrai(*a, transport=transport, **kw)
        faux_httpx = types.SimpleNamespace(**{k: getattr(httpx, k) for k in dir(httpx) if not k.startswith("__")})
        faux_httpx.AsyncClient = client
        monkeypatch.setattr(m, "httpx", faux_httpx)
