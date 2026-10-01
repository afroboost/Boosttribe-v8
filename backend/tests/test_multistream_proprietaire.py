"""
🔐 01/10 — CLOISONNEMENT de la diffusion sociale entre coachs (banc hors ligne, moteur mock).

Défaut trouvé : l'état de diffusion était rangé PAR ROOM, sans propriétaire vérifié. Le coach B
co-hôte du Live du coach A pouvait LIRE l'état de la diffusion de A, l'ARRÊTER, ou greffer ses
propres destinations sur le flux de A. Règle : la diffusion d'une room appartient au compte qui
l'a démarrée ; tant qu'elle tourne, personne d'autre ne la lit, ne la modifie, ne l'arrête.
"""
import asyncio
import os
import sys

import pytest

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, ".."))

import multistream as ms  # noqa: E402

RESOLUS = []


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def setup_function(_fn=None):
    for v in ("MULTISTREAM_MODE", "SOCIAL_LIVE_MODE", "SOCIAL_LIVE_GO"):
        os.environ.pop(v, None)
    ms.reinitialiser_pour_tests()
    ms.definir_moteur(None)
    RESOLUS.clear()

    async def resoudre(user_id, platform):
        RESOLUS.append((user_id, platform))
        return {"rtmp_url": f"rtmps://push.{platform}.test/{user_id}", "stream_key": f"SECRET-{user_id}-{platform}"}

    async def statut(user_id, platform):
        return "connected"

    ms._resoudre_destination = resoudre
    ms._statut_compte = statut


def test_b_ne_voit_pas_la_diffusion_de_a():
    _run(ms.demarrer("ROOM-A", "coachA", ["facebook", "youtube"]))
    vu_par_b = _run(ms.statut("ROOM-A", "coachB"))
    assert vu_par_b["live"] is False and vu_par_b["destinations"] == []
    assert _run(ms.statut("ROOM-A", "coachA"))["live"] is True


def test_b_ne_peut_pas_arreter_la_diffusion_de_a():
    _run(ms.demarrer("ROOM-A", "coachA", ["facebook"]))
    with pytest.raises(ms.PasProprietaire):
        _run(ms.arreter("ROOM-A", "coachB"))
    with pytest.raises(ms.PasProprietaire):
        _run(ms.arreter("ROOM-A", "coachB", "facebook"))
    assert _run(ms.statut("ROOM-A", "coachA"))["live"] is True, "la diffusion de A continue"


def test_b_ne_peut_pas_greffer_ses_destinations_sur_le_flux_de_a():
    _run(ms.demarrer("ROOM-A", "coachA", ["facebook"]))
    n = len(ms.moteur().appels)
    with pytest.raises(ms.PasProprietaire):
        _run(ms.demarrer("ROOM-A", "coachB", ["tiktok"]))
    assert len(ms.moteur().appels) == n, "aucun appel moteur pour B"
    assert all(u == "coachA" for u, _p in RESOLUS), "seules les destinations de A ont été résolues"


def test_room_liberee_apres_arret_b_demarre_avec_ses_propres_destinations():
    _run(ms.demarrer("ROOM-A", "coachA", ["facebook"]))
    _run(ms.arreter("ROOM-A", "coachA"))
    r = _run(ms.demarrer("ROOM-A", "coachB", ["youtube"]))
    assert r["live"] is True and [d["platform"] for d in r["destinations"]] == ["youtube"]
    assert RESOLUS[-1] == ("coachB", "youtube")
    assert _run(ms.statut("ROOM-A", "coachA"))["destinations"] == [], "A ne voit pas la diffusion de B"


def test_proprietaire_inchange_start_status_stop():
    r = _run(ms.demarrer("ROOM-A", "coachA", ["facebook", "tiktok"]))
    assert r["live"] is True
    assert _run(ms.arreter("ROOM-A", "coachA", "tiktok"))["live"] is True
    assert _run(ms.arreter("ROOM-A", "coachA"))["live"] is False
