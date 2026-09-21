"""
📡 Multistream — banc HORS LIGNE (aucun Egress, aucune plateforme, aucun réseau).

Prouve : mode mock par défaut ; start/stop/status ; échec ISOLÉ (une destination en erreur, les
autres `live`) ; arrêt individuel puis total ; AUCUN secret (URL RTMP / clé) dans une réponse ni
dans un journal ; mode egress avec client mocké (UpdateStream reçoit les bonnes URLs).
Lancer : python3 -m pytest backend/tests/test_multistream.py -q   (ou python3 backend/tests/test_multistream.py)
"""
import asyncio
import logging
import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, ".."))

import multistream as ms  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _destinations_test(monkeypatch=None):
    async def resoudre(user_id, platform):
        if platform == "instagram":
            return None  # compte non connecté
        if platform == "tiktok":
            return {"rtmp_url": "rtmps://push.tiktok.test/live", "stream_key": "SECRET-tiktok-echec"}
        return {"rtmp_url": f"rtmps://push.{platform}.test/live", "stream_key": f"SECRET-{platform}"}

    async def statut(user_id, platform):
        return "not_connected" if platform == "instagram" else "connected"

    ms._resoudre_destination = resoudre
    ms._statut_compte = statut


def setup_function(_fn=None):
    for v in ("MULTISTREAM_MODE", "SOCIAL_LIVE_MODE", "SOCIAL_LIVE_GO"):
        os.environ.pop(v, None)
    ms.reinitialiser_pour_tests()
    ms.definir_moteur(None)
    _destinations_test()


def test_mode_mock_par_defaut():
    assert ms.mode_multistream() == "mock"
    assert isinstance(ms.moteur(), ms.MoteurMock)


def test_comptes_sans_secret():
    c = _run(ms.comptes("u1"))
    assert c == {"instagram": "not_connected", "facebook": "connected", "youtube": "connected", "tiktok": "connected"}
    assert ms.reponse_sans_secret(c)


def test_start_status_echec_isole_et_stop(caplog):
    caplog.set_level(logging.INFO, logger="multistream")
    r = _run(ms.demarrer("room1", "u1", ["facebook", "youtube", "tiktok", "instagram"], "TR_v", "TR_a"))
    assert ms.reponse_sans_secret(r), r
    par = {d["platform"]: d for d in r["destinations"]}
    # instagram : pas de destination → erreur immédiate, sans toucher aux autres
    assert par["instagram"]["status"] == "error"
    # tiktok : URL contenant « echec » → le moteur mock la déclare en erreur ; facebook/youtube live
    assert par["tiktok"]["status"] == "error" and "TikTok" in par["tiktok"]["error"]
    assert par["facebook"]["status"] == "live" and par["youtube"]["status"] == "live"
    assert r["live"] is True and r["elapsedSec"] >= 0
    # les journaux ne contiennent jamais la clé
    assert "SECRET-" not in caplog.text
    # le moteur a reçu 3 URLs (instagram n'en a pas) avec les SIDs des pistes programme
    appels = ms.moteur().appels
    assert appels[0] == {"op": "start", "room": "room1", "n": 3, "video": True, "audio": True}
    # arrêt individuel : youtube s'arrête, facebook continue
    r2 = _run(ms.arreter("room1", "u1", "youtube"))
    par2 = {d["platform"]: d for d in r2["destinations"]}
    assert par2["youtube"]["status"] == "off" and par2["facebook"]["status"] == "live"
    assert appels[-1]["op"] == "update" and appels[-1]["remove"] == 1
    # retry tiktok → nouvel UpdateStream avec 1 ajout
    r3 = _run(ms.demarrer("room1", "u1", ["tiktok"]))
    assert appels[-1] == {"op": "update", "add": 1, "remove": 0}
    assert ms.reponse_sans_secret(r3)
    # arrêt total
    r4 = _run(ms.arreter("room1", "u1"))
    assert r4["live"] is False and all(d["status"] == "off" for d in r4["destinations"])
    assert appels[-1]["op"] == "stop"


def test_start_idempotent_sur_destination_deja_live():
    _run(ms.demarrer("room2", "u1", ["facebook"]))
    n = len(ms.moteur().appels)
    _run(ms.demarrer("room2", "u1", ["facebook"]))
    assert len(ms.moteur().appels) == n  # déjà live → aucun nouvel appel


def test_verrou_egress_sans_go_refuse_sans_toucher_au_moteur(monkeypatch):
    """🔒 Hors mock, SANS le GO de Bassi : `demarrer` lève DirectVerrouille, le moteur n'est JAMAIS appelé,
    aucune destination n'est résolue (aucune clé déchiffrée)."""
    import pytest
    monkeypatch.setenv("MULTISTREAM_MODE", "egress")
    ms.definir_moteur(None)
    assert ms.mode_multistream() == "egress" and ms.direct_reel_autorise() is False

    class MoteurInterdit(ms.MoteurEgress):
        async def demarrer(self, *a, **k):
            raise AssertionError("le moteur Egress ne doit pas être appelé sans GO")

    resolutions = []

    async def resoudre_espion(user_id, platform):
        resolutions.append(platform)
        return {"rtmp_url": "rtmps://push.test/live", "stream_key": "SECRET"}

    ms._resoudre_destination = resoudre_espion
    ms.definir_moteur(MoteurInterdit())
    with pytest.raises(ms.DirectVerrouille):
        _run(ms.demarrer("room-verrou", "u1", ["facebook"], "TR_v", "TR_a"))
    assert resolutions == [], "aucune clé n'est résolue tant que le verrou est fermé"
    # deux conditions sur trois : toujours verrouillé
    monkeypatch.setenv("SOCIAL_LIVE_MODE", "real")
    with pytest.raises(ms.DirectVerrouille):
        _run(ms.demarrer("room-verrou", "u1", ["facebook"], "TR_v", "TR_a"))
    assert ms.statut_sync("room-verrou", "u1")["direct_reel_autorise"] is False


def test_mode_mock_par_defaut_ne_sort_jamais_du_serveur(monkeypatch):
    """Mode mock (défaut prod) : le moteur est MoteurMock, aucun import livekit, aucun réseau, même « live » simulé."""
    import builtins
    vrai_import = builtins.__import__

    def import_espion(name, *a, **k):
        if name.startswith("livekit"):
            raise AssertionError("livekit ne doit pas être importé en mode mock")
        return vrai_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", import_espion)
    assert ms.mode_multistream() == "mock" and isinstance(ms.moteur(), ms.MoteurMock)
    r = _run(ms.demarrer("room-mock", "u1", ["facebook"], "TR_v", "TR_a"))
    assert r["mode"] == "mock" and r["direct_reel_autorise"] is False
    assert ms.reponse_sans_secret(r)


def test_mode_egress_client_mocke(monkeypatch):
    monkeypatch.setenv("MULTISTREAM_MODE", "egress")
    # le GO complet est requis pour qu'un démarrage egress soit accepté
    monkeypatch.setenv("SOCIAL_LIVE_MODE", "real")
    monkeypatch.setenv("SOCIAL_LIVE_GO", "GO_BASSI_TEST_LIVE_SOCIAL")
    ms.definir_moteur(None)
    assert ms.mode_multistream() == "egress" and ms.direct_reel_autorise() is True

    class FauxEgress(ms.MoteurEgress):
        def __init__(self):
            self.urls = []
            self.updates = []

        async def demarrer(self, room, urls, video_sid, audio_sid):
            assert video_sid == "TR_v" and audio_sid == "TR_a"
            self.urls = list(urls)
            return "EG_1"

        async def mettre_a_jour(self, egress_id, ajouter, retirer):
            self.updates.append((egress_id, list(ajouter), list(retirer)))

        async def arreter(self, egress_id):
            self.urls = []

        async def statut(self, egress_id):
            return {u: "live" for u in self.urls}

    faux = FauxEgress()
    ms.definir_moteur(faux)
    r = _run(ms.demarrer("room3", "u1", ["facebook", "youtube"], "TR_v", "TR_a"))
    assert sorted(faux.urls) == ["rtmps://push.facebook.test/live/SECRET-facebook", "rtmps://push.youtube.test/live/SECRET-youtube"]
    assert ms.reponse_sans_secret(r)
    _run(ms.arreter("room3", "u1", "facebook"))
    assert faux.updates[-1] == ("EG_1", [], ["rtmps://push.facebook.test/live/SECRET-facebook"])


def test_url_complete_et_masquage():
    assert ms.url_rtmp_complete("rtmps://a/b/", "k") == "rtmps://a/b/k"
    assert "SECRET" not in ms.masquer("SECRET-xyz-longue")
    assert ms.masquer(None) == "∅"


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
