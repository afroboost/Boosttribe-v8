"""
Destinations de diffusion sociale (Instagram / Facebook / YouTube / TikTok) — MULTISTREAM.

CE QUE FAIT CE MODULE
- Stocke, PAR UTILISATEUR et PAR PLATEFORME, la destination d'un direct :
  `{platform, mode: 'oauth'|'manual'|'api', rtmp_url, stream_key_enc, oauth_token_enc, account_id,
    account_label, external_id, expires_at, status}` — les secrets sont CHIFFRÉS au repos.
- Expose des routes qui ne renvoient JAMAIS un secret (ni clé de flux, ni jeton OAuth).
- Expose un ÉTAT PAR PLATEFORME honnête (`GET /social/destinations/status`) : plus jamais un
  « Non connecté » générique derrière un bouton mort.
- Fournit au moteur de multistream `resoudre_destination(user_id, platform)` → `{rtmp_url, stream_key}`
  en clair, UNIQUEMENT côté serveur (jamais via HTTP).

ÉTATS PAR PLATEFORME (ce que voit le navigateur)
- Facebook / YouTube (OAuth réel) : `config_required` (+ NOMS des variables serveur manquantes) →
  `not_connected` (bouton « Connecter » = vrai parcours OAuth vers le compte Afroboost) → `connected`
  ou `reauth` (jeton expiré / révoqué → « Reconnecter »).
- Instagram / TikTok (aucune API de live tierce, docs vérifiées le 17/09/2026) : `config_required`
  (clé de chiffrement absente) → `not_configured` (bouton « Configurer » = URL RTMPS + clé de diffusion
  copiées depuis Live Producer / LIVE Studio) → `configured`.

SÉCURITÉ
- Chiffrement au repos : Fernet dérivé de `SOCIAL_SECRETS_KEY` (dédiée) ; à défaut, le Fernet déjà
  injecté par main.py (`APP_ENCRYPTION_KEY`, celui de Stripe). Aucun des deux → `config_required`,
  JAMAIS de stockage en clair.
- Clé de diffusion : jamais renvoyée (le GET dit au plus « clé enregistrée : oui, 4 derniers caractères »),
  jamais journalisée (seule la longueur l'est), URL `rtmps://` UNIQUEMENT (le `rtmp://` en clair est refusé).
- Liste blanche : seules les identités Afroboost (`SOCIAL_ALLOWED_EMAILS`, défaut = ADMIN_EMAILS injecté)
  peuvent lire ou écrire une destination → toute identité Spordateur reçoit 403, et chaque ligne est de
  toute façon isolée par `user_id`.
- Garde « compte Afroboost uniquement » côté OAuth : la Page / la chaîne obtenue par le parcours OAuth
  DOIT être `AFROBOOST_FB_PAGE_ID` / `AFROBOOST_YT_CHANNEL_ID` (figés côté serveur) ; sinon 403, rien n'est
  stocké — impossible de relier une Page ou une chaîne Spordateur.
- Direct réel : VERROUILLÉ tant que `verrou_direct_reel()` n'est pas levé (SOCIAL_LIVE_MODE=real
  + MULTISTREAM_MODE=egress + SOCIAL_LIVE_GO=GO_BASSI_TEST_LIVE_SOCIAL). En mode mock, rien ne sort du serveur.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger("boosttribe-social")

PLATFORMS = ("instagram", "facebook", "youtube", "tiktok")
PLATEFORMES_OAUTH = ("facebook", "youtube")
PLATEFORMES_MANUELLES = ("instagram", "tiktok")
MODES_PAR_PLATEFORME: Dict[str, tuple] = {
    "facebook": ("oauth", "api", "manual"),
    "youtube": ("oauth", "api", "manual"),
    "instagram": ("manual",),
    "tiktok": ("manual",),
}
LIBELLES = {"instagram": "Instagram", "facebook": "Facebook", "youtube": "YouTube", "tiktok": "TikTok"}

# ─── Variables d'environnement (NOMS seulement — valeurs posées par Bassi dans Coolify) ─────────
ENV_MODE = "SOCIAL_LIVE_MODE"                  # mock | real (défaut mock)
ENV_MULTISTREAM = "MULTISTREAM_MODE"           # mock | egress (défaut mock) — lu aussi par multistream.py
ENV_GO = "SOCIAL_LIVE_GO"                      # doit valoir GO_BASSI_TEST_LIVE_SOCIAL pour un direct réel
VALEUR_GO = "GO_BASSI_TEST_LIVE_SOCIAL"
ENV_SECRETS_KEY = "SOCIAL_SECRETS_KEY"         # clé Fernet dédiée (base64 urlsafe 32 octets)
ENV_ALLOWED = "SOCIAL_ALLOWED_EMAILS"          # liste blanche (défaut : ADMIN_EMAILS injecté par main.py)
ENV_REDIRECT_BASE = "SOCIAL_OAUTH_REDIRECT_BASE"  # URL publique du backend (ex. https://api-live.afroboost.com)
ENV_FB_APP_ID = "FACEBOOK_APP_ID"
ENV_FB_APP_SECRET = "FACEBOOK_APP_SECRET"
ENV_FB_PAGE = "AFROBOOST_FB_PAGE_ID"           # identifiant de la Page Facebook Afroboost autorisée
ENV_FB_TOKEN = "AFROBOOST_FB_PAGE_TOKEN"       # (héritage) jeton de Page posé à la main — jamais renvoyé
ENV_GOOGLE_ID = "GOOGLE_CLIENT_ID"
ENV_GOOGLE_SECRET = "GOOGLE_CLIENT_SECRET"
ENV_YT_CHANNEL = "AFROBOOST_YT_CHANNEL_ID"     # identifiant de la chaîne YouTube Afroboost autorisée
ENV_YT_TOKEN = "AFROBOOST_YT_ACCESS_TOKEN"     # (héritage) jeton OAuth posé à la main — jamais renvoyé

VARIABLES_OAUTH: Dict[str, Tuple[str, ...]] = {
    "facebook": (ENV_FB_APP_ID, ENV_FB_APP_SECRET, ENV_FB_PAGE, ENV_REDIRECT_BASE),
    "youtube": (ENV_GOOGLE_ID, ENV_GOOGLE_SECRET, ENV_YT_CHANNEL, ENV_REDIRECT_BASE),
}

FB_SCOPES = "pages_show_list,pages_manage_posts,pages_read_engagement"
YT_SCOPES = "https://www.googleapis.com/auth/youtube"
FB_GRAPH = "https://graph.facebook.com/v25.0"
DUREE_ETAT_OAUTH_S = 600  # un `state` OAuth vaut 10 minutes

# URL d'ingestion : RTMPS UNIQUEMENT (le RTMP en clair transporte la clé sans chiffrement → refusé).
_RTMPS_RE = re.compile(r"^rtmps://[^\s/:]+(:\d{1,5})?/\S*$", re.I)


def _masquer(valeur: Optional[str]) -> str:
    """Forme journalisable d'un secret : SEULEMENT sa longueur — jamais un caractère du contenu."""
    if not valeur:
        return "(vide)"
    return f"({len(valeur)} car.)"


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _env(nom: str) -> str:
    return (os.environ.get(nom) or "").strip()


# --------------------------------------------------------------------------- #
# Dépendances injectées (chiffrement de repli, auth, stockage, liste blanche)
# --------------------------------------------------------------------------- #
class _Deps:
    encrypt: Optional[Callable[[str], str]] = None
    decrypt: Optional[Callable[[Optional[str]], Optional[str]]] = None
    get_user: Optional[Callable[[Optional[str]], Awaitable[Dict[str, Any]]]] = None
    store: Optional["Stockage"] = None
    emails_autorises: Tuple[str, ...] = ()
    origines_retour: Tuple[str, ...] = ()


_deps = _Deps()


class Stockage:
    """Stockage en mémoire (tests, harnais) ; le stockage Supabase le remplace en production (même interface)."""

    def __init__(self) -> None:
        self._rows: Dict[tuple, Dict[str, Any]] = {}

    async def lire(self, user_id: str, platform: str) -> Optional[Dict[str, Any]]:
        return self._rows.get((user_id, platform))

    async def lire_toutes(self, user_id: str) -> List[Dict[str, Any]]:
        return [r for (u, _p), r in self._rows.items() if u == user_id]

    async def ecrire(self, user_id: str, platform: str, row: Dict[str, Any]) -> None:
        self._rows[(user_id, platform)] = dict(row, user_id=user_id, platform=platform)

    async def supprimer(self, user_id: str, platform: str) -> None:
        self._rows.pop((user_id, platform), None)


# Schéma de `social_destinations` — IDENTIQUE au bloc « Table à créer » de docs/multistream_plateformes.md.
# Idempotent (`if not exists`) : ne touche à aucune autre table, ne détruit aucune donnée. RLS activée sans
# politique = seul le service-role (le backend) lit/écrit ; isolation par `user_id` ; secrets chiffrés
# (`stream_key_enc`, `oauth_token_enc`), jamais en clair.
SQL_SCHEMA = """
create table if not exists public.social_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('instagram','facebook','youtube','tiktok')),
  mode text not null check (mode in ('oauth','api','manual')),
  rtmp_url text,
  stream_key_enc text,
  key_hint text,
  oauth_token_enc text,
  account_label text,
  account_id text,
  external_id text,
  expires_at timestamptz,
  status text not null default 'connected',
  updated_at timestamptz default now(),
  unique (user_id, platform)
);
alter table public.social_destinations enable row level security;
"""
MANQUE_SCHEMA = "TABLE social_destinations (migration Supabase)"


class SchemaAbsent(Exception):
    """PostgREST ne connaît pas `social_destinations` (PGRST205) : la migration n'a pas été appliquée."""


def _schema_absent(r: Any) -> bool:
    if getattr(r, "status_code", None) != 404:
        return False
    try:
        return (r.json() or {}).get("code") == "PGRST205"
    except Exception:
        return False


class StockageSupabase(Stockage):
    """Table `social_destinations` (REST, service role). Colonnes : user_id, platform, mode, rtmp_url,
    stream_key_enc, key_hint, oauth_token_enc, account_label, account_id, external_id, expires_at, status,
    updated_at. UNIQUE(user_id, platform). SQL dans docs/multistream_plateformes.md (= SQL_SCHEMA).

    Migration : `assurer_schema()` exécute SQL_SCHEMA via pg-meta (`/pg/query`, route Kong réservée au
    service-role) — appelée au démarrage par main.py et, en secours, à la première lecture qui tombe sur
    PGRST205. Aucun accès shell, aucun secret hors du backend."""

    def __init__(self, base_url: str, headers_fn: Callable[..., Dict[str, str]]) -> None:
        super().__init__()
        self._base = base_url.rstrip("/")
        self._url = self._base + "/rest/v1/social_destinations"
        self._headers = headers_fn
        self.schema_ok: Optional[bool] = None

    async def assurer_schema(self) -> bool:
        """Crée la table si elle manque (idempotent). True si pg-meta a accepté, False sinon (loggé, sans secret)."""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(self._base + "/pg/query", headers=self._headers(), json={"query": SQL_SCHEMA})
            self.schema_ok = r.status_code < 300
            if not self.schema_ok:
                logger.warning("[SOCIAL] migration social_destinations refusée par pg-meta : HTTP %s", r.status_code)
            else:
                logger.info("[SOCIAL] schéma social_destinations vérifié (create table if not exists + RLS)")
        except Exception as e:  # réseau, DNS… : on ne fait pas tomber l'application
            self.schema_ok = False
            logger.warning("[SOCIAL] migration social_destinations impossible : %s", type(e).__name__)
        return bool(self.schema_ok)

    async def _reparer_puis(self, r: Any) -> bool:
        """Sur PGRST205 : une tentative de migration ; True si elle a réussi (l'appelant rejoue la requête)."""
        if not _schema_absent(r):
            return False
        if await self.assurer_schema():
            return True
        raise SchemaAbsent()

    async def lire(self, user_id: str, platform: str) -> Optional[Dict[str, Any]]:
        import httpx  # import local : le module reste importable sans réseau
        params = {"user_id": f"eq.{user_id}", "platform": f"eq.{platform}", "select": "*"}
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(self._url, headers=self._headers(), params=params)
            if await self._reparer_puis(r):
                r = await c.get(self._url, headers=self._headers(), params=params)
        r.raise_for_status()
        rows = r.json() or []
        return rows[0] if rows else None

    async def lire_toutes(self, user_id: str) -> List[Dict[str, Any]]:
        import httpx
        params = {"user_id": f"eq.{user_id}", "select": "*"}
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(self._url, headers=self._headers(), params=params)
            if await self._reparer_puis(r):
                r = await c.get(self._url, headers=self._headers(), params=params)
        r.raise_for_status()
        return r.json() or []

    async def ecrire(self, user_id: str, platform: str, row: Dict[str, Any]) -> None:
        import httpx
        body = dict(row, user_id=user_id, platform=platform, updated_at=_maintenant().isoformat())
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(self._url, headers=self._headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                             json=body, params={"on_conflict": "user_id,platform"})
        r.raise_for_status()

    async def supprimer(self, user_id: str, platform: str) -> None:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.delete(self._url, headers=self._headers(),
                               params={"user_id": f"eq.{user_id}", "platform": f"eq.{platform}"})
        r.raise_for_status()


def configurer(*, encrypt: Optional[Callable[[str], str]], decrypt: Optional[Callable[[Optional[str]], Optional[str]]],
               get_user: Callable[[Optional[str]], Awaitable[Dict[str, Any]]], store: Stockage,
               emails_autorises: Iterable[str] = (), origines_retour: Iterable[str] = ()) -> None:
    """Branchement par main.py : chiffrement de repli (Fernet Stripe, None s'il n'est pas configuré),
    validation du jeton Supabase, stockage, liste blanche Afroboost, origines de retour OAuth autorisées."""
    _deps.encrypt, _deps.decrypt, _deps.get_user, _deps.store = encrypt, decrypt, get_user, store
    _deps.emails_autorises = tuple(e.strip().lower() for e in emails_autorises if e and e.strip())
    _deps.origines_retour = tuple(o.strip().rstrip("/").lower() for o in origines_retour if o and o.strip())


def _store() -> Stockage:
    if _deps.store is None:
        raise HTTPException(status_code=500, detail="Destinations sociales non configurées")
    return _deps.store


def _mode_live() -> str:
    return (_env(ENV_MODE) or "mock").lower()


def verrou_direct_reel() -> Dict[str, Any]:
    """Le direct social RÉEL est verrouillé tant que les TROIS conditions ne sont pas réunies.
    Renvoie un diagnostic sans valeur secrète. Importé par multistream.py (repli : toujours verrouillé)."""
    manque: List[str] = []
    if _mode_live() != "real":
        manque.append(f"{ENV_MODE}=real")
    if (_env(ENV_MULTISTREAM) or "mock").lower() != "egress":
        manque.append(f"{ENV_MULTISTREAM}=egress")
    if _env(ENV_GO) != VALEUR_GO:
        manque.append(f"{ENV_GO}={VALEUR_GO}")
    return {"autorise": not manque, "manque": manque, "live_mode": _mode_live(),
            "multistream_mode": (_env(ENV_MULTISTREAM) or "mock").lower()}


def direct_reel_autorise() -> bool:
    return bool(verrou_direct_reel()["autorise"])


def _valider_platform(platform: str) -> str:
    p = (platform or "").strip().lower()
    if p not in PLATFORMS:
        raise HTTPException(status_code=404, detail="Plateforme inconnue")
    return p


# --------------------------------------------------------------------------- #
# Chiffrement : SOCIAL_SECRETS_KEY (dédiée) → sinon Fernet injecté (APP_ENCRYPTION_KEY) → sinon rien
# --------------------------------------------------------------------------- #
_fernet_cache: Dict[str, Any] = {}


def _fernet_dedie():
    cle = _env(ENV_SECRETS_KEY)
    if not cle:
        return None
    if _fernet_cache.get("cle") == cle:
        return _fernet_cache["fernet"]
    try:
        from cryptography.fernet import Fernet
        f = Fernet(cle.encode())
    except Exception:  # clé mal formée → considérée absente (jamais de clair)
        logger.warning("[SOCIAL] %s est posée mais invalide (attendu : clé Fernet base64 urlsafe 32 octets)", ENV_SECRETS_KEY)
        return None
    _fernet_cache.update(cle=cle, fernet=f)
    return f


def _chiffreur() -> Optional[Tuple[Callable[[str], str], Callable[[Optional[str]], Optional[str]]]]:
    f = _fernet_dedie()
    if f is not None:
        def dec(t: Optional[str]) -> Optional[str]:
            if not t:
                return None
            try:
                return f.decrypt(t.encode()).decode()
            except Exception:
                return None
        return (lambda s: f.encrypt(s.encode()).decode(), dec)
    if _deps.encrypt is not None and _deps.decrypt is not None:
        return (_deps.encrypt, _deps.decrypt)
    return None


def chiffrement_manquant() -> List[str]:
    """Noms des variables à poser si AUCUN chiffrement n'est disponible (jamais de stockage en clair)."""
    return [] if _chiffreur() else [ENV_SECRETS_KEY]


def _chiffrer(clair: str) -> str:
    c = _chiffreur()
    if not c:
        raise HTTPException(status_code=409, detail={"code": "config_required", "missing": [ENV_SECRETS_KEY],
                                                     "message": f"Configuration requise : poser {ENV_SECRETS_KEY} côté serveur"})
    return c[0](clair)


def _dechiffrer(token: Optional[str]) -> Optional[str]:
    """None si pas de chiffreur, jeton absent, altéré ou chiffré avec une autre clé — jamais d'exception."""
    c = _chiffreur()
    if not c or not token:
        return None
    try:
        return c[1](token)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# Variables manquantes par plateforme (NOMS seulement)
# --------------------------------------------------------------------------- #
def variables_manquantes(platform: str) -> List[str]:
    manque = list(chiffrement_manquant())
    for nom in VARIABLES_OAUTH.get(platform, ()):
        if not _env(nom):
            manque.append(nom)
    return manque


# --------------------------------------------------------------------------- #
# État public (sans secret) — c'est CE que le tiroir affiche
# --------------------------------------------------------------------------- #
def _expire(row: Dict[str, Any]) -> bool:
    exp = row.get("expires_at")
    if not exp:
        return False
    try:
        return datetime.fromisoformat(str(exp).replace("Z", "+00:00")) <= _maintenant()
    except ValueError:
        return True


def _indice_cle(row: Dict[str, Any]) -> Optional[str]:
    """« clé enregistrée : 4 derniers caractères » — calculé au moment de la saisie, jamais la clé."""
    return row.get("key_hint") or None


def etat_plateforme(row: Optional[Dict[str, Any]], platform: str) -> Dict[str, Any]:
    """Ce que le navigateur a le droit de voir : jamais `stream_key_enc`, jamais `oauth_token_enc`."""
    base: Dict[str, Any] = {
        "platform": platform, "label": LIBELLES[platform],
        "kind": "oauth" if platform in PLATEFORMES_OAUTH else "manual",
        "modes": list(MODES_PAR_PLATEFORME[platform]),
        "mode": row.get("mode") if row else None,
        "account_label": None, "expires_at": row.get("expires_at") if row else None,
        "key_saved": False, "key_hint": None, "missing": [],
    }
    manque_chiffrement = list(chiffrement_manquant())
    manque_oauth = [n for n in VARIABLES_OAUTH.get(platform, ()) if not _env(n)]
    # Deux voies distinctes, dites explicitement au tiroir (jamais un « Configuration requise » muet) :
    #  - `manual_ok` : la saisie RTMPS + clé est possible (il ne faut QUE la clé de chiffrement) ;
    #  - `oauth_ok`  : le parcours OAuth est possible (toutes les variables Meta / Google posées).
    base.update(manual_ok=not manque_chiffrement, oauth_ok=(platform in PLATEFORMES_OAUTH and not manque_chiffrement and not manque_oauth))
    if row:
        label = row.get("account_label") or ""
        base["account_label"] = ((label[:2] + "…" + label[-1:]) if len(label) > 3 else label) or None
    # Facebook : repli RTMPS manuel (Live Producer → « Logiciel de streaming »). Il ne dépend PAS des variables
    # Meta : une App Review en attente ne doit plus bloquer un direct. État « configured » (comme IG / TikTok).
    if platform == "facebook" and not manque_chiffrement and row and row.get("mode") == "manual":
        ok = bool(row.get("stream_key_enc") and row.get("rtmp_url")) and not _expire(row)
        base.update(status="configured" if ok else "reauth", key_saved=bool(row.get("stream_key_enc")), key_hint=_indice_cle(row), missing=manque_oauth)
        return base
    manque = manque_chiffrement + manque_oauth
    if manque:
        base.update(status="config_required", missing=manque, account_label=None)
        return base
    if platform in PLATEFORMES_MANUELLES:
        if row and row.get("stream_key_enc") and row.get("rtmp_url"):
            base.update(status="configured", key_saved=True, key_hint=_indice_cle(row))
        else:
            base.update(status="not_configured")
        return base
    # Facebook / YouTube
    if not row:
        base.update(status="not_connected")
        return base
    if row.get("status") == "unavailable":
        base.update(status="unavailable")
        return base
    if row.get("mode") == "manual":
        ok = bool(row.get("stream_key_enc") and row.get("rtmp_url")) and not _expire(row)
        base.update(status="connected" if ok else "reauth", key_saved=bool(row.get("stream_key_enc")), key_hint=_indice_cle(row))
        return base
    if row.get("mode") == "oauth":
        ok = bool(row.get("oauth_token_enc")) and row.get("status") != "reauth" and not _expire(row)
        base.update(status="connected" if ok else "reauth")
        return base
    # mode 'api' (héritage : ingest déjà préparé par prepare)
    ok = bool(row.get("stream_key_enc") and row.get("rtmp_url")) and not _expire(row)
    base.update(status="connected" if ok else "reauth")
    return base


def statut_public(row: Optional[Dict[str, Any]], platform: str) -> Dict[str, Any]:
    """Nom historique conservé (tests, multistream) : même contenu que `etat_plateforme`."""
    return etat_plateforme(row, platform)


async def statut_compte(user_id: str, platform: str) -> str:
    """Contrat lu par multistream.comptes() : l'état textuel d'une plateforme pour cet utilisateur."""
    p = _valider_platform(platform)
    return etat_plateforme(await _store().lire(user_id, p), p)["status"]


# --------------------------------------------------------------------------- #
# Contrat pour le moteur de multistream — JAMAIS exposé par HTTP
# --------------------------------------------------------------------------- #
async def resoudre_destination(user_id: str, platform: str) -> Optional[Dict[str, str]]:
    """`{rtmp_url, stream_key}` en clair pour l'Egress/relais, ou None si rien d'utilisable.
    Mode 'oauth' : l'ingest est créé côté plateforme à cet instant (mock sans SOCIAL_LIVE_MODE=real)."""
    p = _valider_platform(platform)
    row = await _store().lire(user_id, p)
    if not row:
        return None
    etat = etat_plateforme(row, p)["status"]
    if etat not in ("connected", "configured"):
        return None
    if row.get("mode") == "oauth":
        jeton = _dechiffrer(row.get("oauth_token_enc"))
        if not jeton:
            return None
        try:
            info = await (_preparer_facebook if p == "facebook" else _preparer_youtube)(
                row.get("account_id") or "", "Afroboost — Live", jeton)
        except HTTPException:
            return None
        await _store().ecrire(user_id, p, dict(row, external_id=info.get("external_id")))
        logger.info("[SOCIAL] ingest %s créé (mode=%s) key=%s", p, _mode_live(), _masquer(info["stream_key"]))
        return {"rtmp_url": info["rtmp_url"], "stream_key": info["stream_key"]}
    cle = _dechiffrer(row.get("stream_key_enc"))
    if not cle:
        return None
    logger.info("[SOCIAL] destination résolue user=%s platform=%s key=%s", user_id[:8], p, _masquer(cle))
    return {"rtmp_url": row["rtmp_url"], "stream_key": cle}


# --------------------------------------------------------------------------- #
# Garde « compte Afroboost uniquement »
# --------------------------------------------------------------------------- #
def compte_autorise(platform: str, account_id: Optional[str]) -> bool:
    """Seul l'identifiant figé côté serveur est accepté. Sans variable posée → rien n'est autorisé."""
    attendu = _env(ENV_FB_PAGE if platform == "facebook" else ENV_YT_CHANNEL)
    return bool(attendu) and (account_id or "").strip() == attendu


# --------------------------------------------------------------------------- #
# Clients plateformes — mock par défaut, réel derrière SOCIAL_LIVE_MODE=real
# --------------------------------------------------------------------------- #
async def _preparer_facebook(account_id: str, titre: str, jeton: Optional[str] = None) -> Dict[str, Any]:
    """Facebook Live Video API : POST /{page-id}/live_videos?status=LIVE_NOW → secure_stream_url."""
    if _mode_live() != "real":
        return {"external_id": f"fbmock{account_id[-4:]}", "rtmp_url": "rtmps://live-api-s.facebook.com:443/rtmp/",
                "stream_key": f"MOCK-FB-{os.urandom(6).hex()}", "expires_at": (_maintenant() + timedelta(hours=8)).isoformat()}
    import httpx
    token = jeton or _env(ENV_FB_TOKEN)
    if not token:
        raise HTTPException(status_code=503, detail="Jeton de Page Facebook absent — reconnectez Facebook")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{FB_GRAPH}/{account_id}/live_videos",
                         data={"status": "LIVE_NOW", "title": titre[:254], "access_token": token})
    if r.status_code != 200:
        logger.warning("[SOCIAL] facebook live_videos HTTP %s", r.status_code)
        raise HTTPException(status_code=502, detail="Facebook n'a pas pu créer le direct")
    j = r.json()
    url = j.get("secure_stream_url") or j.get("stream_url") or ""
    base, _, key = url.rpartition("/")
    return {"external_id": j.get("id"), "rtmp_url": base + "/", "stream_key": key,
            "expires_at": (_maintenant() + timedelta(hours=8)).isoformat()}


async def _terminer_facebook(external_id: str, jeton: Optional[str] = None) -> None:
    if _mode_live() != "real":
        return
    import httpx
    token = jeton or _env(ENV_FB_TOKEN)
    async with httpx.AsyncClient(timeout=15) as c:
        await c.post(f"{FB_GRAPH}/{external_id}", data={"end_live_video": "true", "access_token": token})


async def _jeton_acces_youtube(jeton_stocke: str) -> str:
    """Le jeton stocké est le REFRESH token Google : on en tire un access token court (jamais stocké)."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post("https://oauth2.googleapis.com/token", data={
            "client_id": _env(ENV_GOOGLE_ID), "client_secret": _env(ENV_GOOGLE_SECRET),
            "refresh_token": jeton_stocke, "grant_type": "refresh_token"})
    if r.status_code != 200:
        logger.warning("[SOCIAL] youtube refresh HTTP %s", r.status_code)
        raise HTTPException(status_code=503, detail="YouTube : reconnexion nécessaire")
    return r.json().get("access_token") or ""


async def _preparer_youtube(account_id: str, titre: str, jeton: Optional[str] = None) -> Dict[str, Any]:
    """YouTube Live Streaming API : liveStreams.insert (ingestion) + liveBroadcasts.insert + bind."""
    if _mode_live() != "real":
        return {"external_id": f"ytmock{account_id[-4:]}", "rtmp_url": "rtmps://a.rtmps.youtube.com:443/live2/",
                "stream_key": f"mock-yt-{os.urandom(6).hex()}", "expires_at": None}
    import httpx
    token = (await _jeton_acces_youtube(jeton)) if jeton else _env(ENV_YT_TOKEN)
    if not token:
        raise HTTPException(status_code=503, detail="Jeton YouTube absent — reconnectez YouTube")
    h = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15) as c:
        s = await c.post("https://www.googleapis.com/youtube/v3/liveStreams", headers=h, params={"part": "snippet,cdn,contentDetails"},
                         json={"snippet": {"title": titre[:128]}, "cdn": {"frameRate": "30fps", "ingestionType": "rtmp", "resolution": "720p"},
                               "contentDetails": {"isReusable": False}})
        if s.status_code != 200:
            logger.warning("[SOCIAL] youtube liveStreams HTTP %s", s.status_code)
            raise HTTPException(status_code=502, detail="YouTube n'a pas pu créer le flux")
        sj = s.json()
        b = await c.post("https://www.googleapis.com/youtube/v3/liveBroadcasts", headers=h, params={"part": "snippet,status,contentDetails"},
                         json={"snippet": {"title": titre[:100], "scheduledStartTime": _maintenant().isoformat()},
                               "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
                               "contentDetails": {"enableAutoStart": True, "enableAutoStop": True}})
        if b.status_code != 200:
            raise HTTPException(status_code=502, detail="YouTube n'a pas pu créer la diffusion")
        bj = b.json()
        await c.post("https://www.googleapis.com/youtube/v3/liveBroadcasts/bind", headers=h,
                     params={"id": bj["id"], "part": "id,contentDetails", "streamId": sj["id"]})
    info = sj["cdn"]["ingestionInfo"]
    return {"external_id": bj["id"], "rtmp_url": (info.get("rtmpsIngestionAddress") or info["ingestionAddress"]).rstrip("/") + "/",
            "stream_key": info["streamName"], "expires_at": None}


async def _terminer_youtube(external_id: str, jeton: Optional[str] = None) -> None:
    if _mode_live() != "real":
        return
    import httpx
    token = (await _jeton_acces_youtube(jeton)) if jeton else _env(ENV_YT_TOKEN)
    async with httpx.AsyncClient(timeout=15) as c:
        await c.post("https://www.googleapis.com/youtube/v3/liveBroadcasts/transition", headers={"Authorization": f"Bearer {token}"},
                     params={"id": external_id, "broadcastStatus": "complete", "part": "status"})


# --------------------------------------------------------------------------- #
# OAuth réel (Facebook / YouTube) — le `state` est un jeton Fernet (intégrité + horodatage)
# --------------------------------------------------------------------------- #
def _url_callback(platform: str) -> str:
    return _env(ENV_REDIRECT_BASE).rstrip("/") + f"/social/oauth/{platform}/callback"


def _retour_autorise(return_to: Optional[str]) -> Optional[str]:
    """L'URL de retour doit être HTTPS (ou localhost) ET appartenir à une origine autorisée (CORS de main.py)."""
    if not return_to:
        return None
    try:
        u = urlsplit(return_to)
    except ValueError:
        return None
    if u.scheme not in ("https", "http") or not u.netloc:
        return None
    if u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1"):
        return None
    origine = f"{u.scheme}://{u.netloc}".lower()
    if _deps.origines_retour and origine not in _deps.origines_retour:
        return None
    return return_to


def _signer_etat(user_id: str, platform: str, return_to: Optional[str]) -> str:
    charge = json.dumps({"u": user_id, "p": platform, "r": return_to, "t": int(time.time()), "n": secrets.token_hex(8)},
                        separators=(",", ":"))
    return _chiffrer(charge)


def _lire_etat(state: str, platform: str) -> Optional[Dict[str, Any]]:
    clair = _dechiffrer(state)
    if not clair:
        return None
    try:
        d = json.loads(clair)
    except ValueError:
        return None
    if not isinstance(d, dict) or d.get("p") != platform or not d.get("u"):
        return None
    if int(time.time()) - int(d.get("t") or 0) > DUREE_ETAT_OAUTH_S:
        return None
    return d


def url_autorisation(platform: str, state: str) -> str:
    if platform == "facebook":
        return "https://www.facebook.com/v25.0/dialog/oauth?" + urlencode({
            "client_id": _env(ENV_FB_APP_ID), "redirect_uri": _url_callback("facebook"),
            "scope": FB_SCOPES, "response_type": "code", "state": state})
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": _env(ENV_GOOGLE_ID), "redirect_uri": _url_callback("youtube"),
        "scope": YT_SCOPES, "response_type": "code", "access_type": "offline", "prompt": "consent",
        "include_granted_scopes": "true", "state": state})


async def _echanger_code_facebook(code: str) -> Dict[str, Any]:
    """code → jeton utilisateur → Pages gérées ; renvoie la Page AFROBOOST (ou 403) avec son jeton de Page."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as c:
        t = await c.get(f"{FB_GRAPH}/oauth/access_token", params={
            "client_id": _env(ENV_FB_APP_ID), "client_secret": _env(ENV_FB_APP_SECRET),
            "redirect_uri": _url_callback("facebook"), "code": code})
        if t.status_code != 200:
            logger.warning("[SOCIAL] facebook oauth/access_token HTTP %s", t.status_code)
            raise HTTPException(status_code=502, detail="Facebook a refusé l'échange du code")
        jeton_user = t.json().get("access_token") or ""
        pages = await c.get(f"{FB_GRAPH}/me/accounts", params={"access_token": jeton_user, "fields": "id,name,access_token"})
    if pages.status_code != 200:
        raise HTTPException(status_code=502, detail="Facebook n'a pas renvoyé les Pages du compte")
    attendu = _env(ENV_FB_PAGE)
    for page in pages.json().get("data") or []:
        if str(page.get("id")) == attendu and page.get("access_token"):
            return {"account_id": attendu, "account_label": page.get("name") or "Facebook Afroboost",
                    "jeton": page["access_token"], "expires_at": None}
    logger.warning("[SOCIAL] facebook : la Page Afroboost n'est pas parmi les Pages du compte connecté → refus")
    raise HTTPException(status_code=403, detail="Ce compte Facebook ne gère pas la Page Afroboost — connexion refusée")


async def _echanger_code_youtube(code: str) -> Dict[str, Any]:
    """code → refresh token → chaîne « mine » ; renvoie la chaîne AFROBOOST (ou 403) avec le refresh token."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as c:
        t = await c.post("https://oauth2.googleapis.com/token", data={
            "client_id": _env(ENV_GOOGLE_ID), "client_secret": _env(ENV_GOOGLE_SECRET),
            "redirect_uri": _url_callback("youtube"), "code": code, "grant_type": "authorization_code"})
        if t.status_code != 200:
            logger.warning("[SOCIAL] google token HTTP %s", t.status_code)
            raise HTTPException(status_code=502, detail="Google a refusé l'échange du code")
        tj = t.json()
        acces, refresh = tj.get("access_token") or "", tj.get("refresh_token") or ""
        ch = await c.get("https://www.googleapis.com/youtube/v3/channels", headers={"Authorization": f"Bearer {acces}"},
                         params={"part": "id,snippet", "mine": "true"})
    if ch.status_code != 200:
        raise HTTPException(status_code=502, detail="YouTube n'a pas renvoyé la chaîne du compte")
    attendu = _env(ENV_YT_CHANNEL)
    for item in ch.json().get("items") or []:
        if str(item.get("id")) == attendu:
            if not refresh:
                raise HTTPException(status_code=502, detail="Google n'a pas fourni de jeton de rafraîchissement — réessayez")
            return {"account_id": attendu, "account_label": (item.get("snippet") or {}).get("title") or "YouTube Afroboost",
                    "jeton": refresh, "expires_at": None}
    logger.warning("[SOCIAL] youtube : la chaîne connectée n'est pas la chaîne Afroboost → refus")
    raise HTTPException(status_code=403, detail="Ce compte Google n'est pas la chaîne Afroboost — connexion refusée")


# --------------------------------------------------------------------------- #
# Routes HTTP — aucune ne renvoie un secret
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/social", tags=["social"])


class ManuelIn(BaseModel):
    rtmp_url: str
    stream_key: str
    account_label: Optional[str] = None


class PrepareIn(BaseModel):
    account_id: str
    title: Optional[str] = "Afroboost — Live"


def _emails_autorises() -> Tuple[str, ...]:
    env = tuple(e.strip().lower() for e in _env(ENV_ALLOWED).split(",") if e.strip())
    return env or _deps.emails_autorises


async def _utilisateur(authorization: Optional[str]) -> Dict[str, Any]:
    """Identité serveur (jeton Supabase) PUIS liste blanche Afroboost : une identité Spordateur ne passe pas."""
    if _deps.get_user is None:
        raise HTTPException(status_code=500, detail="Authentification non configurée")
    user = await _deps.get_user(authorization)
    email = (user.get("email") or "").strip().lower()
    autorises = _emails_autorises()
    if not autorises or email not in autorises:
        logger.warning("[SOCIAL] accès refusé : identité hors liste blanche Afroboost (@%s)", email.split("@")[-1] or "?")
        raise HTTPException(status_code=403, detail="Diffusion sociale réservée au compte Afroboost")
    return user


async def _etats(user_id: str) -> Dict[str, Any]:
    verrou = verrou_direct_reel()
    base = {"mode_live": _mode_live(), "multistream_mode": verrou["multistream_mode"],
            "direct_reel_autorise": verrou["autorise"], "verrou": verrou["manque"]}
    try:
        rows = {r["platform"]: r for r in await _store().lire_toutes(user_id)}
    except SchemaAbsent:
        # Table absente et migration automatique impossible : on le DIT (config_required + nom exact),
        # jamais un 500 (qui sort sans en-têtes CORS et se lit « Indisponible » dans le navigateur).
        dests = []
        for p in PLATFORMS:
            e = etat_plateforme(None, p)
            e.update(status="config_required", missing=[MANQUE_SCHEMA] + list(e.get("missing") or []))
            dests.append(e)
        return dict(base, destinations=dests, schema="absent")
    return dict(base, destinations=[etat_plateforme(rows.get(p), p) for p in PLATFORMS])


@router.get("/destinations")
async def lister_destinations(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    user = await _utilisateur(authorization)
    return await _etats(user["id"])


@router.get("/destinations/status")
async def statut_destinations(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """État par plateforme + diagnostic exact (NOMS des variables serveur manquantes). Jamais une valeur."""
    user = await _utilisateur(authorization)
    return await _etats(user["id"])


@router.post("/destinations/{platform}/manual")
async def saisir_manuel(platform: str, body: ManuelIn, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Saisie par l'hôte de l'URL RTMPS + clé fournies par la plateforme (Live Producer IG, LIVE Studio TikTok ;
    repli possible FB/YT). La clé est chiffrée immédiatement et n'est plus jamais renvoyée."""
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    url = body.rtmp_url.strip()
    if url.lower().startswith("rtmp://"):
        raise HTTPException(status_code=400, detail="URL en clair refusée : l'adresse doit commencer par rtmps://")
    if not _RTMPS_RE.match(url):
        raise HTTPException(status_code=400, detail="URL RTMPS invalide (attendu : rtmps://serveur/application/)")
    cle = body.stream_key.strip()
    if not cle or len(cle) > 512:
        raise HTTPException(status_code=400, detail="Clé de diffusion vide ou trop longue")
    manque = chiffrement_manquant()
    if manque:
        raise HTTPException(status_code=409, detail={"code": "config_required", "missing": manque,
                                                     "message": f"Configuration requise : poser {', '.join(manque)} côté serveur"})
    await _store().ecrire(user["id"], p, {
        "mode": "manual", "rtmp_url": url, "stream_key_enc": _chiffrer(cle), "key_hint": cle[-4:],
        "oauth_token_enc": None, "account_label": (body.account_label or "").strip()[:80] or None,
        "account_id": None, "external_id": None, "expires_at": None, "status": "connected",
    })
    logger.info("[SOCIAL] configuration manuelle enregistrée user=%s platform=%s key=%s", user["id"][:8], p, _masquer(cle))
    return etat_plateforme(await _store().lire(user["id"], p), p)


@router.delete("/destinations/{platform}")
async def oublier(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    await _store().supprimer(user["id"], p)
    return etat_plateforme(None, p)


@router.get("/oauth/{platform}/start")
async def oauth_debut(platform: str, return_to: Optional[str] = None, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Renvoie l'URL du VRAI parcours OAuth (Facebook / Google) — ou 409 avec les NOMS des variables manquantes."""
    p = _valider_platform(platform)
    if p not in PLATEFORMES_OAUTH:
        raise HTTPException(status_code=501, detail=f"{LIBELLES[p]} : aucun OAuth de direct — configurez l'URL RTMPS et la clé")
    user = await _utilisateur(authorization)
    manque = variables_manquantes(p)
    if manque:
        raise HTTPException(status_code=409, detail={"code": "config_required", "missing": manque,
                                                     "message": f"Configuration requise : {', '.join(manque)}"})
    retour = _retour_autorise(return_to)
    state = _signer_etat(user["id"], p, retour)
    return {"platform": p, "url": url_autorisation(p, state)}


@router.get("/oauth/{platform}/callback")
async def oauth_retour(platform: str, code: Optional[str] = None, state: Optional[str] = None,
                       error: Optional[str] = None):
    """Retour de Facebook / Google : vérifie le `state`, échange le code CÔTÉ SERVEUR, exige la Page / la chaîne
    Afroboost, stocke le jeton chiffré, puis renvoie l'hôte vers la page d'où il vient (#social=<p>:<résultat>)."""
    p = _valider_platform(platform)
    if p not in PLATEFORMES_OAUTH:
        raise HTTPException(status_code=501, detail="Plateforme sans OAuth")
    etat = _lire_etat(state or "", p)
    if not etat:
        raise HTTPException(status_code=400, detail="Parcours OAuth expiré ou altéré — recommencez depuis le tiroir")
    retour = etat.get("r")

    def _fin(resultat: str):
        if retour:
            return RedirectResponse(url=f"{retour.split('#')[0]}#social={p}:{resultat}", status_code=302)
        return {"platform": p, "result": resultat}

    if error or not code:
        return _fin("cancelled")
    if variables_manquantes(p):
        return _fin("config_required")
    try:
        info = await (_echanger_code_facebook if p == "facebook" else _echanger_code_youtube)(code)
    except HTTPException as e:
        return _fin("refused" if e.status_code == 403 else "error")
    if not compte_autorise(p, info["account_id"]):
        return _fin("refused")
    await _store().ecrire(etat["u"], p, {
        "mode": "oauth", "rtmp_url": None, "stream_key_enc": None, "key_hint": None,
        "oauth_token_enc": _chiffrer(info["jeton"]), "account_label": info["account_label"],
        "account_id": info["account_id"], "external_id": None, "expires_at": info.get("expires_at"), "status": "connected",
    })
    logger.info("[SOCIAL] OAuth %s relié pour user=%s (jeton %s)", p, str(etat["u"])[:8], _masquer(info["jeton"]))
    return _fin("connected")


@router.post("/destinations/{platform}/prepare")
async def preparer(platform: str, body: PrepareIn, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Mode 'api' (héritage, jeton posé à la main) : crée le direct côté plateforme et stocke l'ingest chiffré.
    Refus 403 si l'identifiant n'est pas celui du compte Afroboost figé côté serveur."""
    p = _valider_platform(platform)
    if p not in PLATEFORMES_OAUTH:
        raise HTTPException(status_code=501, detail=f"{LIBELLES[p]} : pas d'API de direct — saisie manuelle de la clé")
    user = await _utilisateur(authorization)
    if not compte_autorise(p, body.account_id):
        logger.warning("[SOCIAL] compte refusé platform=%s (seul le compte Afroboost est autorisé)", p)
        raise HTTPException(status_code=403, detail="Seul le compte Afroboost est autorisé pour la diffusion")
    if chiffrement_manquant():
        raise HTTPException(status_code=409, detail={"code": "config_required", "missing": chiffrement_manquant()})
    row = await _store().lire(user["id"], p)
    jeton = _dechiffrer(row.get("oauth_token_enc")) if row and row.get("mode") == "oauth" else None
    info = await (_preparer_facebook if p == "facebook" else _preparer_youtube)(body.account_id, body.title or "Afroboost — Live", jeton)
    await _store().ecrire(user["id"], p, {
        "mode": "api", "rtmp_url": info["rtmp_url"], "stream_key_enc": _chiffrer(info["stream_key"]), "key_hint": None,
        "oauth_token_enc": (row or {}).get("oauth_token_enc"),
        "account_label": LIBELLES[p] + " Afroboost", "account_id": body.account_id, "external_id": info.get("external_id"),
        "expires_at": info.get("expires_at"), "status": "connected",
    })
    logger.info("[SOCIAL] direct préparé platform=%s mode=%s external=%s key=%s", p, _mode_live(), info.get("external_id"), _masquer(info["stream_key"]))
    return etat_plateforme(await _store().lire(user["id"], p), p)


@router.post("/destinations/{platform}/finish")
async def terminer(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Fin du direct côté plateforme ; l'ingest à usage unique est oublié (le lien OAuth, lui, reste)."""
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    row = await _store().lire(user["id"], p)
    if row and row.get("mode") in ("api", "oauth") and row.get("external_id"):
        jeton = _dechiffrer(row.get("oauth_token_enc"))
        await (_terminer_facebook if p == "facebook" else _terminer_youtube)(row["external_id"], jeton)
    if row and row.get("mode") == "oauth":
        await _store().ecrire(user["id"], p, dict(row, external_id=None))
    elif row:
        await _store().supprimer(user["id"], p)
    return etat_plateforme(await _store().lire(user["id"], p), p)


@router.get("/connect/{platform}")
async def url_connexion(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Ancienne entrée (lien sans jeton, donc inutilisable) : conservée en 501 explicite.
    Le vrai parcours est `GET /social/oauth/{platform}/start` (authentifié) → URL → callback."""
    p = _valider_platform(platform)
    await _utilisateur(authorization)
    raise HTTPException(status_code=501, detail=f"Utilisez /social/oauth/{p}/start (parcours OAuth authentifié)")
