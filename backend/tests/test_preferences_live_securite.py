"""
🔐 05/10 — Revue de sécurité des routes de préférences Live (POST /coach/preferences-live/appliquer,
PUT /coach/preferences-live). Identité = jeton serveur (get_user_from_token) ; un coach n'agit QUE sur
ses préférences et SES Lives ; tout champ relu du stockage est revalidé (liste blanche).
"""
import pytest
from fastapi import HTTPException

from test_preferences_live import AUTRE, HOTE, lancer, m  # noqa: F401


def _ligne(mod, sid):
    return next((r for r in mod._base.playlists if r["session_id"] == sid), None)


def _prefs(mod, p):
    mod._base.profiles[HOTE]["live_preferences"] = p


# (1) AUTORISATION — un Live sans hôte (ou inexistant) ne peut pas être « pris » par un autre coach.
def test_appliquer_ne_s_approprie_jamais_un_live_sans_hote(m):
    _prefs(m, {"entree": "private", "acces": "account", "maj": 1})
    m._base.playlists.append({"session_id": "AUTRE111-ZZZZZZ", "host_id": None, "mode": "open", "access_mode": "guest"})
    with pytest.raises(HTTPException) as e:
        lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="AUTRE111-ZZZZZZ"), authorization="Bearer hote"))
    assert e.value.status_code == 403
    l = _ligne(m, "AUTRE111-ZZZZZZ")
    assert l["host_id"] is None and l["mode"] == "open" and l["access_mode"] == "guest"


def test_appliquer_ne_cree_jamais_un_live_inexistant(m):
    _prefs(m, {"entree": "private", "maj": 1})
    with pytest.raises(HTTPException) as e:
        lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="INCONNU1-AAAAAA"), authorization="Bearer hote"))
    assert e.value.status_code == 403 and _ligne(m, "INCONNU1-AAAAAA") is None


def test_marquer_reglee_la_session_d_un_autre_est_ignore(m):
    m._base.playlists.append({"session_id": "AUTRE222-YYYYYY", "host_id": AUTRE, "mode": "open"})
    p = lancer(m.coach_preferences_live_maj(m.PreferencesLiveBody(acces="guest", session_id="AUTRE222-YYYYYY"), authorization="Bearer hote"))
    assert "AUTRE222-YYYYYY" not in (p["preferences"].get("sessions_reglees") or [])


# (2) CONTOURNEMENT DE VALIDATION — le stockage relu n'est jamais cru sur parole.
def test_prix_memorise_hors_limites_jamais_applique(m):
    async def bornes():
        return {"price_min_chf": 5, "price_max_chf": 100}
    m.get_commission_settings = bornes
    _prefs(m, {"entree": "paid", "prix_chf": 0.01, "capacite": -3, "maj": 1})
    m._base.playlists.append({"session_id": "LIVE1111-AAAAAA", "host_id": HOTE, "mode": "open", "access_mode": "account"})
    lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE1111-AAAAAA"), authorization="Bearer hote"))
    assert _ligne(m, "LIVE1111-AAAAAA")["mode"] == "open"          # « Payante » à 0,01 CHF refusée


def test_preferences_relues_assainies_par_liste_blanche(m):
    _prefs(m, {"entree": "gratuit-hack", "acces": "admin", "x": "<script>", "role": "admin",
               "sessions_reglees": ["../../x", 5, "LIVE1111-AAAAAA"], "maj": "pas-un-nombre"})
    p = lancer(m.coach_preferences_live(authorization="Bearer hote"))["preferences"]
    assert set(p) <= {"entree", "prix_chf", "capacite", "acces", "promo", "sessions_reglees", "maj"}
    assert "entree" not in p and "acces" not in p and p.get("sessions_reglees") == ["LIVE1111-AAAAAA"]
    m._base.playlists.append({"session_id": "LIVE2222-BBBBBB", "host_id": HOTE, "mode": "open", "access_mode": "account"})
    r = lancer(m.coach_preferences_live_appliquer(m.PreferencesAppliquerBody(session_id="LIVE2222-BBBBBB"), authorization="Bearer hote"))
    assert r["applique"] is False and _ligne(m, "LIVE2222-BBBBBB")["access_mode"] == "account"
