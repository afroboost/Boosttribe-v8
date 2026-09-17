"""
Destinations de diffusion sociale (Instagram / Facebook / YouTube / TikTok) — MULTISTREAM, agent 2.

CE QUE FAIT CE MODULE
- Stocke, PAR UTILISATEUR BoostTribe et PAR PLATEFORME, la destination RTMP(S) d'un direct :
  `{platform, mode: 'api'|'manual', rtmp_url, stream_key (CHIFFRÉ), account_label, expires_at, status}`.
- Expose des routes qui ne renvoient JAMAIS un secret (ni clé de flux, ni jeton).
- Fournit au moteur de multistream (agent 1) la fonction `resoudre_destination(user_id, platform)`
  → `{rtmp_url, stream_key}` en clair, UNIQUEMENT côté serveur (jamais via HTTP).

CE QUE DISENT LES PLATEFORMES (docs officielles vérifiées le 17/09/2026, voir docs/multistream_plateformes.md)
- Facebook  : Live Video API → `POST /{page-id}/live_videos?status=LIVE_NOW` → `secure_stream_url` (RTMPS) ;
              fin par `POST /{id}?end_live_video=true`. Page : `pages_manage_posts` + `pages_read_engagement`
              (+ App Review « Live Video API »). Compte ≥ 60 jours, Page ≥ 100 abonnés.        → mode 'api' ou 'manual'.
- YouTube   : Live Streaming API → `liveStreams.insert` (cdn.ingestionInfo.ingestionAddress + streamName,
              `rtmpsIngestionAddress`), `liveBroadcasts.insert` + `bind` + `transition(live|complete)` ;
              scopes `youtube` ou `youtube.force-ssl`. Chaîne vérifiée, 0 restriction 90 j.       → mode 'api' ou 'manual'.
- Instagram : AUCUNE API tierce de création de live (« There are no plans to build one at this time » ;
              `live_media` = lecture seule). Seule voie : Live Producer sur instagram.com → URL + clé,
              clé RENOUVELÉE à chaque live, à coller par l'hôte.                                  → mode 'manual' seulement.
- TikTok    : AUCUNE Live API chez TikTok for Developers. Clé via TikTok LIVE Studio / LIVE Producer
              (livecenter.tiktok.com), accès LIVE requis (≥ 1 000 abonnés ou réseau créateur),
              nouvelle clé à chaque live.                                                          → mode 'manual' seulement.

SÉCURITÉ
- Chiffrement au repos : le Fernet DÉJÀ utilisé pour la clé Stripe (`APP_ENCRYPTION_KEY`), injecté par
  `configurer(...)` — ce module ne lit aucune variable de chiffrement lui-même.
- Garde « compte Afroboost uniquement » : en mode 'api', l'identifiant de Page / de chaîne autorisé est FIGÉ
  côté serveur (`AFROBOOST_FB_PAGE_ID`, `AFROBOOST_YT_CHANNEL_ID`) ; tout autre identifiant → 403.
  Aucune destination ne peut donc viser un compte Spordateur.
- Appels réels aux API sociales derrière `SOCIAL_LIVE_MODE` (`mock` par défaut) : en mock, rien ne sort du serveur.
- Journalisation : jamais de clé (fonction `_masquer` + test qui lit les logs).
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("boosttribe-social")

PLATFORMS = ("instagram", "facebook", "youtube", "tiktok")
MODES_PAR_PLATEFORME: Dict[str, tuple] = {
    "facebook": ("api", "manual"),
    "youtube": ("api", "manual"),
    "instagram": ("manual",),
    "tiktok": ("manual",),
}
LIBELLES = {"instagram": "Instagram", "facebook": "Facebook", "youtube": "YouTube", "tiktok": "TikTok"}

# Variables d'environnement (NOMS seulement — valeurs posées par Bassi dans Coolify)
ENV_MODE = "SOCIAL_LIVE_MODE"            # mock | real (défaut mock)
ENV_FB_PAGE = "AFROBOOST_FB_PAGE_ID"     # identifiant de la Page Facebook Afroboost autorisée
ENV_YT_CHANNEL = "AFROBOOST_YT_CHANNEL_ID"
ENV_FB_TOKEN = "AFROBOOST_FB_PAGE_TOKEN"  # jeton de Page (mode real) — jamais renvoyé
ENV_YT_TOKEN = "AFROBOOST_YT_ACCESS_TOKEN"  # jeton OAuth YouTube (mode real) — jamais renvoyé

_RTMP_RE = re.compile(r"^rtmps?://[^\s/]+/\S*$", re.I)


def _masquer(valeur: Optional[str]) -> str:
    """Forme journalisable d'un secret : longueur + 2 derniers caractères, jamais le contenu."""
    if not valeur:
        return "(vide)"
    return f"…{valeur[-2:]} ({len(valeur)} car.)"


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Dépendances injectées (chiffrement, auth, stockage) — testables sans réseau
# --------------------------------------------------------------------------- #
class _Deps:
    encrypt: Optional[Callable[[str], str]] = None
    decrypt: Optional[Callable[[Optional[str]], Optional[str]]] = None
    get_user: Optional[Callable[[Optional[str]], Awaitable[Dict[str, Any]]]] = None
    store: Optional["Stockage"] = None


_deps = _Deps()


class Stockage:
    """Stockage en mémoire (tests) ; le stockage Supabase le remplace en production (même interface)."""

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


class StockageSupabase(Stockage):
    """Table `social_destinations` (REST, service role). Colonnes : user_id, platform, mode, rtmp_url,
    stream_key_enc, account_label, account_id, external_id, expires_at, status, updated_at.
    UNIQUE(user_id, platform). Créée par le SQL fourni dans docs/multistream_plateformes.md."""

    def __init__(self, base_url: str, headers_fn: Callable[[], Dict[str, str]]) -> None:
        super().__init__()
        self._url = base_url.rstrip("/") + "/rest/v1/social_destinations"
        self._headers = headers_fn

    async def lire(self, user_id: str, platform: str) -> Optional[Dict[str, Any]]:
        import httpx  # import local : le module reste importable sans réseau
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(self._url, headers=self._headers(),
                            params={"user_id": f"eq.{user_id}", "platform": f"eq.{platform}", "select": "*"})
        r.raise_for_status()
        rows = r.json() or []
        return rows[0] if rows else None

    async def lire_toutes(self, user_id: str) -> List[Dict[str, Any]]:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(self._url, headers=self._headers(), params={"user_id": f"eq.{user_id}", "select": "*"})
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


def configurer(*, encrypt: Callable[[str], str], decrypt: Callable[[Optional[str]], Optional[str]],
               get_user: Callable[[Optional[str]], Awaitable[Dict[str, Any]]], store: Stockage) -> None:
    """Branchement par main.py : chiffrement Fernet existant, validation du jeton Supabase, stockage."""
    _deps.encrypt, _deps.decrypt, _deps.get_user, _deps.store = encrypt, decrypt, get_user, store


def _store() -> Stockage:
    if _deps.store is None:
        raise HTTPException(status_code=500, detail="Destinations sociales non configurées")
    return _deps.store


def _mode_live() -> str:
    return (os.environ.get(ENV_MODE) or "mock").strip().lower()


def _valider_platform(platform: str) -> str:
    p = (platform or "").strip().lower()
    if p not in PLATFORMS:
        raise HTTPException(status_code=404, detail="Plateforme inconnue")
    return p


# --------------------------------------------------------------------------- #
# Statut (sans secret)
# --------------------------------------------------------------------------- #
def statut_public(row: Optional[Dict[str, Any]], platform: str) -> Dict[str, Any]:
    """Ce que le navigateur a le droit de voir : jamais `stream_key_enc`, jamais de jeton."""
    modes = MODES_PAR_PLATEFORME[platform]
    if row is None:
        return {"platform": platform, "label": LIBELLES[platform], "status": "not_connected",
                "mode": None, "modes": list(modes), "account_label": None, "expires_at": None}
    status = "connected"
    exp = row.get("expires_at")
    if row.get("status") == "unavailable":
        status = "unavailable"
    elif exp:
        try:
            if datetime.fromisoformat(str(exp).replace("Z", "+00:00")) <= _maintenant():
                status = "reauth"
        except ValueError:
            status = "reauth"
    if not row.get("stream_key_enc") or not row.get("rtmp_url"):
        status = "reauth"
    label = row.get("account_label") or ""
    masque = (label[:2] + "…" + label[-1:]) if len(label) > 3 else label
    return {"platform": platform, "label": LIBELLES[platform], "status": status, "mode": row.get("mode"),
            "modes": list(modes), "account_label": masque or None, "expires_at": exp}


# --------------------------------------------------------------------------- #
# Contrat pour le moteur de multistream (agent 1) — JAMAIS exposé par HTTP
# --------------------------------------------------------------------------- #
async def resoudre_destination(user_id: str, platform: str) -> Optional[Dict[str, str]]:
    """`{rtmp_url, stream_key}` en clair pour l'Egress/relais, ou None si rien d'utilisable."""
    p = _valider_platform(platform)
    row = await _store().lire(user_id, p)
    if not row or statut_public(row, p)["status"] != "connected":
        return None
    cle = _deps.decrypt(row.get("stream_key_enc")) if _deps.decrypt else None
    if not cle:
        return None
    logger.info("[SOCIAL] destination résolue user=%s platform=%s key=%s", user_id[:8], p, _masquer(cle))
    return {"rtmp_url": row["rtmp_url"], "stream_key": cle}


# --------------------------------------------------------------------------- #
# Garde « compte Afroboost uniquement »
# --------------------------------------------------------------------------- #
def compte_autorise(platform: str, account_id: Optional[str]) -> bool:
    """En mode 'api', seul l'identifiant figé côté serveur est accepté. Sans variable posée → rien n'est autorisé."""
    attendu = os.environ.get(ENV_FB_PAGE if platform == "facebook" else ENV_YT_CHANNEL, "").strip()
    return bool(attendu) and (account_id or "").strip() == attendu


# --------------------------------------------------------------------------- #
# Clients plateformes (mode 'api') — mock par défaut, réel derrière SOCIAL_LIVE_MODE=real
# --------------------------------------------------------------------------- #
async def _preparer_facebook(account_id: str, titre: str) -> Dict[str, Any]:
    """Facebook Live Video API : POST /{page-id}/live_videos?status=LIVE_NOW → secure_stream_url."""
    if _mode_live() != "real":
        return {"external_id": f"fbmock{account_id[-4:]}", "rtmp_url": "rtmps://live-api-s.facebook.com:443/rtmp/",
                "stream_key": f"MOCK-FB-{os.urandom(6).hex()}", "expires_at": (_maintenant() + timedelta(hours=8)).isoformat()}
    import httpx
    token = os.environ.get(ENV_FB_TOKEN, "")
    if not token:
        raise HTTPException(status_code=503, detail="Jeton de Page Facebook non configuré côté serveur")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"https://graph.facebook.com/v25.0/{account_id}/live_videos",
                         data={"status": "LIVE_NOW", "title": titre[:254], "access_token": token})
    if r.status_code != 200:
        logger.warning("[SOCIAL] facebook live_videos HTTP %s", r.status_code)
        raise HTTPException(status_code=502, detail="Facebook n'a pas pu créer le direct")
    j = r.json()
    url = j.get("secure_stream_url") or j.get("stream_url") or ""
    base, _, key = url.rpartition("/")
    return {"external_id": j.get("id"), "rtmp_url": base + "/", "stream_key": key,
            "expires_at": (_maintenant() + timedelta(hours=8)).isoformat()}


async def _terminer_facebook(external_id: str) -> None:
    if _mode_live() != "real":
        return
    import httpx
    token = os.environ.get(ENV_FB_TOKEN, "")
    async with httpx.AsyncClient(timeout=15) as c:
        await c.post(f"https://graph.facebook.com/v25.0/{external_id}", data={"end_live_video": "true", "access_token": token})


async def _preparer_youtube(account_id: str, titre: str) -> Dict[str, Any]:
    """YouTube Live Streaming API : liveStreams.insert (ingestion) + liveBroadcasts.insert + bind."""
    if _mode_live() != "real":
        return {"external_id": f"ytmock{account_id[-4:]}", "rtmp_url": "rtmps://a.rtmps.youtube.com:443/live2/",
                "stream_key": f"mock-yt-{os.urandom(6).hex()}", "expires_at": None}
    import httpx
    token = os.environ.get(ENV_YT_TOKEN, "")
    if not token:
        raise HTTPException(status_code=503, detail="Jeton YouTube non configuré côté serveur")
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


async def _terminer_youtube(external_id: str) -> None:
    if _mode_live() != "real":
        return
    import httpx
    token = os.environ.get(ENV_YT_TOKEN, "")
    async with httpx.AsyncClient(timeout=15) as c:
        await c.post("https://www.googleapis.com/youtube/v3/liveBroadcasts/transition", headers={"Authorization": f"Bearer {token}"},
                     params={"id": external_id, "broadcastStatus": "complete", "part": "status"})


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


async def _utilisateur(authorization: Optional[str]) -> Dict[str, Any]:
    if _deps.get_user is None:
        raise HTTPException(status_code=500, detail="Authentification non configurée")
    return await _deps.get_user(authorization)


@router.get("/destinations")
async def lister_destinations(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    user = await _utilisateur(authorization)
    rows = {r["platform"]: r for r in await _store().lire_toutes(user["id"])}
    return {"mode_live": _mode_live(), "destinations": [statut_public(rows.get(p), p) for p in PLATFORMS]}


@router.post("/destinations/{platform}/manual")
async def saisir_manuel(platform: str, body: ManuelIn, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Saisie par l'hôte de l'URL + clé fournies par la plateforme (Live Producer IG, LIVE Studio TikTok, ou FB/YT).
    La clé est chiffrée immédiatement et n'est plus jamais renvoyée."""
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    url = body.rtmp_url.strip()
    if not _RTMP_RE.match(url):
        raise HTTPException(status_code=400, detail="URL RTMP/RTMPS invalide")
    if not body.stream_key.strip() or len(body.stream_key) > 512:
        raise HTTPException(status_code=400, detail="Clé de flux invalide")
    if _deps.encrypt is None:
        raise HTTPException(status_code=500, detail="Chiffrement non configuré")
    await _store().ecrire(user["id"], p, {
        "mode": "manual", "rtmp_url": url, "stream_key_enc": _deps.encrypt(body.stream_key.strip()),
        "account_label": (body.account_label or "").strip()[:80] or None, "account_id": None, "external_id": None,
        "expires_at": None, "status": "connected",
    })
    logger.info("[SOCIAL] destination manuelle enregistrée user=%s platform=%s key=%s", user["id"][:8], p, _masquer(body.stream_key))
    return statut_public(await _store().lire(user["id"], p), p)


@router.delete("/destinations/{platform}")
async def oublier(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    await _store().supprimer(user["id"], p)
    return statut_public(None, p)


@router.post("/destinations/{platform}/prepare")
async def preparer(platform: str, body: PrepareIn, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Mode 'api' (Facebook / YouTube) : crée le direct côté plateforme et stocke l'ingest chiffré.
    Refus 403 si l'identifiant n'est pas celui du compte Afroboost figé côté serveur."""
    p = _valider_platform(platform)
    if "api" not in MODES_PAR_PLATEFORME[p]:
        raise HTTPException(status_code=501, detail=f"{LIBELLES[p]} : pas d'API de direct — saisie manuelle de la clé")
    user = await _utilisateur(authorization)
    if not compte_autorise(p, body.account_id):
        logger.warning("[SOCIAL] compte refusé platform=%s account=%s (seul le compte Afroboost est autorisé)", p, (body.account_id or "")[-4:])
        raise HTTPException(status_code=403, detail="Seul le compte Afroboost est autorisé pour la diffusion")
    if _deps.encrypt is None:
        raise HTTPException(status_code=500, detail="Chiffrement non configuré")
    info = await (_preparer_facebook if p == "facebook" else _preparer_youtube)(body.account_id, body.title or "Afroboost — Live")
    await _store().ecrire(user["id"], p, {
        "mode": "api", "rtmp_url": info["rtmp_url"], "stream_key_enc": _deps.encrypt(info["stream_key"]),
        "account_label": LIBELLES[p] + " Afroboost", "account_id": body.account_id, "external_id": info.get("external_id"),
        "expires_at": info.get("expires_at"), "status": "connected",
    })
    logger.info("[SOCIAL] direct préparé platform=%s mode=%s external=%s key=%s", p, _mode_live(), info.get("external_id"), _masquer(info["stream_key"]))
    return statut_public(await _store().lire(user["id"], p), p)


@router.post("/destinations/{platform}/finish")
async def terminer(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Fin du direct côté plateforme (mode 'api') ; la destination repasse à « non connectée » (clé à usage unique)."""
    p = _valider_platform(platform)
    user = await _utilisateur(authorization)
    row = await _store().lire(user["id"], p)
    if row and row.get("mode") == "api" and row.get("external_id"):
        await (_terminer_facebook if p == "facebook" else _terminer_youtube)(row["external_id"])
    if row:
        await _store().supprimer(user["id"], p)
    return statut_public(None, p)


@router.get("/connect/{platform}")
async def url_connexion(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Point d'entrée OAuth (option B). Non ouvert dans ce lot : 501 explicite, jamais un faux bouton.
    Le OAuth complet (app Meta avec revue « Live Video API », client Google avec scope `youtube`) est une action Bassi."""
    p = _valider_platform(platform)
    await _utilisateur(authorization)
    raise HTTPException(status_code=501, detail=f"Connexion OAuth {LIBELLES[p]} non encore ouverte — utilisez la saisie manuelle de la clé")
