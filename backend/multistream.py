"""
📡 MULTISTREAM — 1 programme → N destinations (Instagram / Facebook / YouTube / TikTok).

Architecture retenue : LiveKit **Egress Track Composite** sur les pistes PROGRAMME publiées
dans la room (vidéo composée par le coach + audio programme) → `StreamOutput` RTMP(S)
multi-URLs, ajout/retrait d'URL à chaud (`UpdateStream`), statut PAR destination.
1 seul encodage serveur, N sorties : une panne TikTok n'arrête ni Facebook, ni YouTube,
ni Live Visio.

Deux modes (variable `MULTISTREAM_MODE`) :
  - `mock` (DÉFAUT) : simule, journalise, n'appelle JAMAIS Egress ni une plateforme.
  - `egress` : client LiveKit officiel (`livekit-api`). Exige l'infra Egress déployée
    (infra/livekit/docker-compose.egress.yml) et `LIVEKIT_URL/API_KEY/API_SECRET`.

SECRETS : les URLs/clés RTMP sont résolues côté serveur par `social_destinations.resoudre_destination`
(module de l'agent « connexions sociales » ; absent → stub qui renvoie None) et ne figurent
JAMAIS dans une réponse HTTP, un log, une URL de statut. Les réponses ne contiennent que des
noms de plateformes et des statuts.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger("multistream")

PLATEFORMES = ("instagram", "facebook", "youtube", "tiktok")
LIBELLES = {"instagram": "Instagram", "facebook": "Facebook", "youtube": "YouTube", "tiktok": "TikTok"}
STATUTS_DIFFUSION = ("starting", "live", "error", "off")


def mode_multistream() -> str:
    m = (os.environ.get("MULTISTREAM_MODE") or "mock").strip().lower()
    return m if m in ("mock", "egress") else "mock"


# ─── Résolution des destinations (agent « connexions sociales ») ───────────────────────────
# Contrat : resoudre_destination(user_id, platform) -> {"rtmp_url": str, "stream_key": str} | None
try:  # pragma: no cover - dépend du module de l'autre lot
    from social_destinations import resoudre_destination as _resoudre_destination  # type: ignore
    from social_destinations import statut_compte as _statut_compte  # type: ignore
except Exception:  # noqa: BLE001
    async def _resoudre_destination(user_id: str, platform: str) -> Optional[Dict[str, str]]:  # type: ignore[misc]
        return None

    async def _statut_compte(user_id: str, platform: str) -> str:  # type: ignore[misc]
        # Sans module social : rien n'est connecté. Jamais « connected » par défaut.
        return "not_connected"


def masquer(s: Optional[str]) -> str:
    """Pour les journaux : jamais une clé en clair."""
    if not s:
        return "∅"
    return f"{s[:4]}…({len(s)} car.)"


def url_rtmp_complete(rtmp_url: str, stream_key: str) -> str:
    """rtmps://host/app + clé → URL complète pour l'Egress. Jamais renvoyée au client."""
    base = rtmp_url.rstrip("/")
    return f"{base}/{stream_key}" if stream_key else base


# ─── État par room ─────────────────────────────────────────────────────────────────────────
@dataclass
class Destination:
    platform: str
    status: str = "off"          # starting | live | error | off
    error: Optional[str] = None
    url: Optional[str] = None    # URL RTMP COMPLÈTE — reste en mémoire serveur, jamais sérialisée
    demarre_le: Optional[float] = None


@dataclass
class DiffusionRoom:
    room: str
    user_id: str
    egress_id: Optional[str] = None
    demarre_le: Optional[float] = None
    destinations: Dict[str, Destination] = field(default_factory=dict)
    video_track_sid: Optional[str] = None
    audio_track_sid: Optional[str] = None

    @property
    def live(self) -> bool:
        return any(d.status in ("live", "starting") for d in self.destinations.values())

    def statut(self) -> Dict[str, Any]:
        """Réponse HTTP : statuts seulement — aucune URL, aucune clé."""
        now = time.time()
        return {
            "live": self.live,
            "elapsedSec": int(now - self.demarre_le) if (self.live and self.demarre_le) else 0,
            "mode": mode_multistream(),
            "destinations": [
                {"platform": p, "status": d.status, **({"error": d.error} if d.error else {})}
                for p, d in self.destinations.items()
            ],
        }


_DIFFUSIONS: Dict[str, DiffusionRoom] = {}


def _diffusion(room: str, user_id: str) -> DiffusionRoom:
    d = _DIFFUSIONS.get(room)
    if not d:
        d = DiffusionRoom(room=room, user_id=user_id)
        _DIFFUSIONS[room] = d
    return d


def reinitialiser_pour_tests() -> None:
    _DIFFUSIONS.clear()


# ─── Moteur Egress (injectable pour les tests) ─────────────────────────────────────────────
class MoteurEgress:
    """Client Egress LiveKit minimal : start (track composite ou room composite), update_stream, stop."""

    async def demarrer(self, room: str, urls: List[str], video_sid: Optional[str], audio_sid: Optional[str]) -> str:
        from livekit import api as lk  # import tardif : le mode mock n'en a pas besoin

        lkapi = lk.LiveKitAPI(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        try:
            out = lk.StreamOutput(protocol=lk.StreamProtocol.RTMP, urls=urls)
            if video_sid or audio_sid:
                req = lk.TrackCompositeEgressRequest(room_name=room, video_track_id=video_sid or "", audio_track_id=audio_sid or "", stream_outputs=[out])
                info = await lkapi.egress.start_track_composite_egress(req)
            else:
                req = lk.RoomCompositeEgressRequest(room_name=room, layout="speaker", stream_outputs=[out])
                info = await lkapi.egress.start_room_composite_egress(req)
            return info.egress_id
        finally:
            await lkapi.aclose()

    async def mettre_a_jour(self, egress_id: str, ajouter: List[str], retirer: List[str]) -> None:
        from livekit import api as lk

        lkapi = lk.LiveKitAPI(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        try:
            await lkapi.egress.update_stream(lk.UpdateStreamRequest(egress_id=egress_id, add_output_urls=ajouter, remove_output_urls=retirer))
        finally:
            await lkapi.aclose()

    async def arreter(self, egress_id: str) -> None:
        from livekit import api as lk

        lkapi = lk.LiveKitAPI(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        try:
            await lkapi.egress.stop_egress(lk.StopEgressRequest(egress_id=egress_id))
        finally:
            await lkapi.aclose()

    async def statut(self, egress_id: str) -> Dict[str, str]:
        """URL complète → 'live' | 'error' | 'off' (d'après StreamInfo.status)."""
        from livekit import api as lk

        lkapi = lk.LiveKitAPI(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        try:
            res = await lkapi.egress.list_egress(lk.ListEgressRequest(egress_id=egress_id))
            out: Dict[str, str] = {}
            for item in getattr(res, "items", []):
                # StreamInfo.status : 0 ACTIVE(starting) / 1 FINISHED / 2 FAILED selon le proto Egress ;
                # on lit le nom symbolique quand il existe pour ne pas dépendre du numéro.
                for info in getattr(item, "stream_results", None) or []:
                    nom = str(getattr(info, "status", "")).upper()
                    if "FAIL" in nom or nom == "2":
                        out[info.url] = "error"
                    elif "FINISH" in nom or nom == "1":
                        out[info.url] = "off"
                    else:
                        out[info.url] = "live"
            return out
        finally:
            await lkapi.aclose()


class MoteurMock(MoteurEgress):
    """Simulation : tout démarre, sauf les URLs contenant `echec` (pour prouver l'isolation d'une panne)."""

    def __init__(self) -> None:
        self.appels: List[Dict[str, Any]] = []
        self._urls: Dict[str, List[str]] = {}

    async def demarrer(self, room, urls, video_sid, audio_sid):  # type: ignore[override]
        eid = f"mock-{room}-{int(time.time() * 1000)}"
        self.appels.append({"op": "start", "room": room, "n": len(urls), "video": bool(video_sid), "audio": bool(audio_sid)})
        self._urls[eid] = list(urls)
        return eid

    async def mettre_a_jour(self, egress_id, ajouter, retirer):  # type: ignore[override]
        self.appels.append({"op": "update", "add": len(ajouter), "remove": len(retirer)})
        cur = self._urls.setdefault(egress_id, [])
        for u in retirer:
            if u in cur:
                cur.remove(u)
        cur.extend(u for u in ajouter if u not in cur)

    async def arreter(self, egress_id):  # type: ignore[override]
        self.appels.append({"op": "stop"})
        self._urls.pop(egress_id, None)

    async def statut(self, egress_id):  # type: ignore[override]
        return {u: ("error" if "echec" in u else "live") for u in self._urls.get(egress_id, [])}


_MOTEUR: Optional[MoteurEgress] = None


def moteur() -> MoteurEgress:
    global _MOTEUR
    if _MOTEUR is None:
        _MOTEUR = MoteurMock() if mode_multistream() == "mock" else MoteurEgress()
    return _MOTEUR


def definir_moteur(m: Optional[MoteurEgress]) -> None:
    global _MOTEUR
    _MOTEUR = m


# ─── Opérations ────────────────────────────────────────────────────────────────────────────
async def comptes(user_id: str) -> Dict[str, str]:
    """Statut de compte par plateforme (connected / not_connected / reauth / unavailable). Aucun secret."""
    out: Dict[str, str] = {}
    for p in PLATEFORMES:
        try:
            st = await _statut_compte(user_id, p)
        except Exception:  # noqa: BLE001
            st = "unavailable"
        out[p] = st if st in ("connected", "not_connected", "reauth", "unavailable") else "unavailable"
    return out


async def demarrer(room: str, user_id: str, plateformes: List[str], video_sid: Optional[str] = None, audio_sid: Optional[str] = None) -> Dict[str, Any]:
    d = _diffusion(room, user_id)
    if video_sid:
        d.video_track_sid = video_sid
    if audio_sid:
        d.audio_track_sid = audio_sid
    urls_ajout: List[str] = []
    for p in plateformes:
        if p not in PLATEFORMES:
            continue
        dest = d.destinations.get(p) or Destination(platform=p)
        d.destinations[p] = dest
        if dest.status in ("live", "starting"):
            continue
        try:
            resolu = await _resoudre_destination(user_id, p)
        except Exception as e:  # noqa: BLE001
            resolu = None
            logger.warning("[MULTISTREAM] résolution %s impossible : %s", p, type(e).__name__)
        if not resolu or not resolu.get("rtmp_url"):
            dest.status, dest.error = "error", "Compte non connecté ou destination indisponible"
            continue
        dest.url = url_rtmp_complete(resolu["rtmp_url"], resolu.get("stream_key", ""))
        dest.status, dest.error, dest.demarre_le = "starting", None, time.time()
        urls_ajout.append(dest.url)
        logger.info("[MULTISTREAM] %s → %s démarre (url %s)", room, p, masquer(dest.url))
    if urls_ajout:
        try:
            if not d.egress_id:
                d.egress_id = await moteur().demarrer(room, urls_ajout, d.video_track_sid, d.audio_track_sid)
                d.demarre_le = time.time()
            else:
                await moteur().mettre_a_jour(d.egress_id, urls_ajout, [])
        except Exception as e:  # noqa: BLE001
            logger.warning("[MULTISTREAM] egress échec : %s", type(e).__name__)
            for dest in d.destinations.values():
                if dest.url in urls_ajout:
                    dest.status, dest.error = "error", "Le serveur de diffusion n'a pas pu démarrer"
    return await statut(room, user_id)


async def statut(room: str, user_id: str) -> Dict[str, Any]:
    d = _diffusion(room, user_id)
    if d.egress_id:
        try:
            par_url = await moteur().statut(d.egress_id)
            for dest in d.destinations.values():
                if dest.url and dest.url in par_url and dest.status in ("starting", "live", "error"):
                    st = par_url[dest.url]
                    if st == "live":
                        dest.status, dest.error = "live", None
                    elif st == "error":
                        dest.status, dest.error = "error", f"{LIBELLES.get(dest.platform, dest.platform)} n'a pas pu démarrer"
        except Exception as e:  # noqa: BLE001
            logger.warning("[MULTISTREAM] statut egress indisponible : %s", type(e).__name__)
    return d.statut()


async def arreter(room: str, user_id: str, plateforme: Optional[str] = None) -> Dict[str, Any]:
    d = _diffusion(room, user_id)
    if plateforme:
        dest = d.destinations.get(plateforme)
        if dest and dest.url and d.egress_id:
            try:
                await moteur().mettre_a_jour(d.egress_id, [], [dest.url])
            except Exception as e:  # noqa: BLE001
                logger.warning("[MULTISTREAM] retrait %s impossible : %s", plateforme, type(e).__name__)
        if dest:
            dest.status, dest.error, dest.url = "off", None, None
        if not d.live and d.egress_id:
            try:
                await moteur().arreter(d.egress_id)
            except Exception:  # noqa: BLE001
                pass
            d.egress_id, d.demarre_le = None, None
        return d.statut()
    # tout arrêter
    if d.egress_id:
        try:
            await moteur().arreter(d.egress_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("[MULTISTREAM] arrêt egress : %s", type(e).__name__)
    for dest in d.destinations.values():
        dest.status, dest.error, dest.url = "off", None, None
    d.egress_id, d.demarre_le = None, None
    return d.statut()


def reponse_sans_secret(payload: Dict[str, Any]) -> bool:
    """Garde-fou testable : aucune valeur ne ressemble à une URL RTMP ni à une clé."""
    txt = str(payload).lower()
    return "rtmp" not in txt and "stream_key" not in txt and "token" not in txt
