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
import re
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
try:  # pragma: no cover - dépend du module « connexions sociales »
    from social_destinations import resoudre_destination as _resoudre_destination  # type: ignore
    from social_destinations import statut_compte as _statut_compte  # type: ignore
    from social_destinations import verrou_direct_reel as _verrou_direct_reel  # type: ignore
except Exception:  # noqa: BLE001
    async def _resoudre_destination(user_id: str, platform: str) -> Optional[Dict[str, str]]:  # type: ignore[misc]
        return None

    async def _statut_compte(user_id: str, platform: str) -> str:  # type: ignore[misc]
        # Sans module social : rien n'est connecté. Jamais « connected » par défaut.
        return "not_connected"

    def _verrou_direct_reel() -> Dict[str, Any]:  # type: ignore[misc]
        # Sans module social : le direct réel est TOUJOURS verrouillé.
        return {"autorise": False, "manque": ["social_destinations absent"], "live_mode": "mock", "multistream_mode": mode_multistream()}


# États de compte connus de l'UI (social_destinations.etat_plateforme) — tout autre → « unavailable ».
STATUTS_COMPTE = ("connected", "not_connected", "reauth", "unavailable", "config_required", "not_configured", "configured")


def verrou_direct_reel() -> Dict[str, Any]:
    """Diagnostic du verrou « direct social réel » (aucune valeur secrète)."""
    return _verrou_direct_reel()


def direct_reel_autorise() -> bool:
    """Un direct qui SORT du serveur (Egress → réseaux) n'est possible que verrou levé. En mode mock, rien ne sort."""
    return bool(verrou_direct_reel().get("autorise"))


class DirectVerrouille(RuntimeError):
    """Levée quand on tente un démarrage NON mock sans le GO de Bassi."""


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
            "direct_reel_autorise": direct_reel_autorise(),
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


class EgressFichierQA:
    """🧪 QA INTERNE — même moteur Egress (Track Composite sur les pistes PROGRAMME), mais la seule
    sortie est un FICHIER MP4 dans le conteneur Egress (`EncodedFileOutput`, volume egress-tmp).
    Jamais de `StreamOutput`, jamais d'URL RTMP/RTMPS : ce chemin ne peut rien envoyer à un réseau
    social, quel que soit MULTISTREAM_MODE — le verrou `verrou_direct_reel` (RTMP) reste intact et
    n'est pas consulté ici parce qu'aucune diffusion externe n'est possible par construction."""

    DOSSIER = "/tmp"

    def _api(self):
        from livekit import api as lk  # import tardif

        return lk, lk.LiveKitAPI(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])

    async def pistes_programme(self, room: str) -> Dict[str, Optional[str]]:
        """Retrouve dans la room les pistes publiées sous les noms `program` (vidéo) et `program-audio`
        (audio) — celles du ProgramStream composé, jamais une caméra brute."""
        lk, lkapi = self._api()
        try:
            resp = await lkapi.room.list_participants(lk.ListParticipantsRequest(room=room))
            video: Optional[str] = None
            audio: Optional[str] = None
            for p in getattr(resp, "participants", []):
                for t in getattr(p, "tracks", []):
                    if t.name == "program" and not video:
                        video = t.sid
                    elif t.name == "program-audio" and not audio:
                        audio = t.sid
            return {"video_sid": video, "audio_sid": audio}
        finally:
            await lkapi.aclose()

    async def demarrer(self, room: str, video_sid: str, audio_sid: Optional[str]) -> Dict[str, Any]:
        lk, lkapi = self._api()
        try:
            nom = f"qa-{re.sub(r'[^A-Za-z0-9_-]', '', room)}-{int(time.time())}.mp4"
            sortie = lk.EncodedFileOutput(file_type=lk.EncodedFileType.MP4, filepath=f"{self.DOSSIER}/{nom}", disable_manifest=True)
            req = lk.TrackCompositeEgressRequest(room_name=room, video_track_id=video_sid, audio_track_id=audio_sid or "", file_outputs=[sortie])
            info = await lkapi.egress.start_track_composite_egress(req)
            return {"egress_id": info.egress_id, "fichier": nom}
        finally:
            await lkapi.aclose()

    async def arreter(self, egress_id: str) -> None:
        lk, lkapi = self._api()
        try:
            await lkapi.egress.stop_egress(lk.StopEgressRequest(egress_id=egress_id))
        finally:
            await lkapi.aclose()

    async def statut(self, egress_id: str) -> Dict[str, Any]:
        """Statut symbolique + résultats fichier (nom, taille, durée) — aucun secret, aucune URL."""
        lk, lkapi = self._api()
        try:
            res = await lkapi.egress.list_egress(lk.ListEgressRequest(egress_id=egress_id))
            for item in getattr(res, "items", []):
                fichiers = [{"fichier": f.filename.rsplit("/", 1)[-1], "taille": int(f.size), "duree_ms": int(f.duration) // 1_000_000 if f.duration > 10_000_000 else int(f.duration),
                             "debut": int(f.started_at), "fin": int(f.ended_at)} for f in getattr(item, "file_results", None) or []]
                return {"egress_id": item.egress_id, "statut": lk.EgressStatus.Name(item.status) if hasattr(lk.EgressStatus, "Name") else str(item.status),
                        "erreur": item.error or None, "debut": int(item.started_at), "fin": int(item.ended_at), "fichiers": fichiers}
            return {"egress_id": egress_id, "statut": "INCONNU", "erreur": None, "fichiers": []}
        finally:
            await lkapi.aclose()


# Un seul egress QA par room, en mémoire (le fichier reste dans le conteneur Egress) ; on garde
# aussi le DERNIER egress arrêté par room, pour lire son résultat final (taille, durée, erreur).
_qa_fichier: Dict[str, Dict[str, Any]] = {}
_qa_dernier: Dict[str, Dict[str, Any]] = {}
_moteur_qa: Optional[EgressFichierQA] = None


def definir_moteur_qa(m: Optional[EgressFichierQA]) -> None:
    global _moteur_qa
    _moteur_qa = m


def moteur_qa() -> EgressFichierQA:
    return _moteur_qa or EgressFichierQA()


async def qa_fichier_demarrer(room: str, user_id: str) -> Dict[str, Any]:
    if room in _qa_fichier:
        return dict(_qa_fichier[room], deja_en_cours=True)
    pistes = await moteur_qa().pistes_programme(room)
    if not pistes.get("video_sid"):
        raise ValueError("Aucune piste « program » publiée dans la room : mettez une scène à l'antenne (Programme vers les participants).")
    res = await moteur_qa().demarrer(room, pistes["video_sid"], pistes.get("audio_sid"))
    _qa_fichier[room] = {"egress_id": res["egress_id"], "fichier": res["fichier"], "user_id": user_id,
                         "video_sid": pistes["video_sid"], "audio_sid": pistes.get("audio_sid"), "debut": time.time()}
    logger.info("[QA-EGRESS] démarré room=%s egress=%s fichier=%s", room, res["egress_id"], res["fichier"])
    return dict(_qa_fichier[room])


async def qa_fichier_statut(room: str, egress_id: Optional[str] = None) -> Dict[str, Any]:
    e = _qa_fichier.get(room)
    if egress_id:
        # Lecture explicite d'un egress (le dernier arrêté, typiquement) : résultat final du fichier.
        st = await moteur_qa().statut(egress_id)
        return dict(_qa_dernier.get(room) or {}, actif=bool(e and e["egress_id"] == egress_id), **st)
    if not e:
        d = _qa_dernier.get(room)
        if d:
            st = await moteur_qa().statut(d["egress_id"])
            return dict(d, actif=False, dernier=True, **{k: v for k, v in st.items() if k != "egress_id"})
        return {"actif": False}
    st = await moteur_qa().statut(e["egress_id"])
    return dict(e, actif=True, **{k: v for k, v in st.items() if k != "egress_id"})


async def qa_fichier_arreter(room: str) -> Dict[str, Any]:
    e = _qa_fichier.pop(room, None)
    if not e:
        return {"actif": False}
    _qa_dernier[room] = dict(e, fin_demandee=time.time())
    await moteur_qa().arreter(e["egress_id"])
    logger.info("[QA-EGRESS] arrêté room=%s egress=%s", room, e["egress_id"])
    st = await moteur_qa().statut(e["egress_id"])
    return dict(e, actif=False, **{k: v for k, v in st.items() if k != "egress_id"})


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
        out[p] = st if st in STATUTS_COMPTE else "unavailable"
    return out


async def demarrer(room: str, user_id: str, plateformes: List[str], video_sid: Optional[str] = None, audio_sid: Optional[str] = None) -> Dict[str, Any]:
    # 🔒 VERROU : hors mode mock, un démarrage ferait SORTIR le programme du serveur (Egress → réseaux).
    #    Il exige le GO explicite (SOCIAL_LIVE_MODE=real + MULTISTREAM_MODE=egress + SOCIAL_LIVE_GO). Sinon : refus,
    #    aucun moteur appelé, aucune destination résolue. En mode mock, MoteurMock simule sans réseau.
    if mode_multistream() != "mock" and not direct_reel_autorise():
        logger.warning("[MULTISTREAM] démarrage refusé : direct réel verrouillé (%s)", ", ".join(verrou_direct_reel().get("manque") or []))
        raise DirectVerrouille("Direct social réel verrouillé — en attente du GO de Bassi")
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


def statut_sync(room: str, user_id: str) -> Dict[str, Any]:
    """Statut instantané sans interroger le moteur (bancs, diagnostics)."""
    return _diffusion(room, user_id).statut()


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
