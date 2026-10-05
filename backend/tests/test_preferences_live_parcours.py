"""
⚙️ 05/10 — PARCOURS du coach : son dernier réglage ENREGISTRÉ (mode d'entrée + droits des invités)
revient au prochain Live, et un Live réglé à la main n'est jamais écrasé.

Bug réel : « Gratuit par lien/QR » + « Accès visio » → le coach retrouvait « Avec crédits » à chaque
nouveau Live. Deux causes : (1) la reprise côté navigateur n'avait lieu que si `access_mode` était
VIDE — or la colonne a un défaut ('account') : jamais vide ; (2) `update_profile` ne faisait que
journaliser un échec (colonne `profiles.live_preferences` ou ligne `profiles` absente).

`Coach` rejoue EXACTEMENT les appels réseau de SessionPage (Enregistrer = handleSaveMode,
Annuler = annulerModeAcces, Quitter, ouverture d'un Live par son hôte). Le navigateur ne garde
RIEN entre deux visites : tout vient du serveur (navigateur fermé / rouvert, autre appareil).

`ouverture_hote` : le parcours du navigateur à l'ouverture. Si la route serveur
`/coach/preferences-live/appliquer` n'existe pas (code de 0245365), c'est le parcours navigateur
de 0245365 qui est rejoué (SessionPage.tsx de 0245365, effet « NOUVEAU Live ») — c'est ce qui
permet de lancer CES MÊMES parcours sur l'ancien code et de les voir ÉCHOUER (preuve rouge/vert).
"""
import pytest

from test_preferences_live import HOTE, lancer, m  # noqa: F401  (fixture `m` : faux PostgREST + faux GoTrue)

DEFAUTS_BASE = {"mode": "open", "access_mode": "account"}   # infra : défauts des colonnes playlists


def ouverture_hote(mod, sid, jeton):
    if hasattr(mod, "coach_preferences_live_appliquer"):                    # ce correctif : le SERVEUR décide
        return lancer(mod.coach_preferences_live_appliquer(mod.PreferencesAppliquerBody(session_id=sid), authorization=jeton))
    # 0245365 : reprise seulement si `access_mode` n'a jamais été posé sur ce Live.
    ligne = next((r for r in mod._base.playlists if r["session_id"] == sid), {})
    if ligne.get("access_mode") in ("guest", "account"):
        return {"applique": False}
    p = lancer(mod.coach_preferences_live(authorization=jeton))["preferences"]
    if p.get("entree"):
        lancer(mod.session_configure(mod.SessionConfigBody(session_id=sid, mode=p["entree"]), authorization=jeton))
    if p.get("acces"):
        ligne["access_mode"] = p["acces"]
    return {"applique": bool(p.get("entree") or p.get("acces"))}


class Coach:
    """Un navigateur du coach. Nouvelle instance = navigateur fermé puis rouvert (aucune mémoire locale)."""

    def __init__(self, mod, jeton="Bearer hote"):
        self.m, self.jeton = mod, jeton

    def _ligne(self, sid):
        return next(r for r in self.m._base.playlists if r["session_id"] == sid)

    def ouvrir(self, sid):
        """Ouvre un Live comme hôte. Nouveau Live = ligne créée avec les DÉFAUTS de la base."""
        if not any(r["session_id"] == sid for r in self.m._base.playlists):
            self.m._base.playlists.append({"session_id": sid, "host_id": HOTE, **DEFAUTS_BASE})
        return ouverture_hote(self.m, sid, self.jeton)

    def enregistrer(self, sid, mode, acces):
        """« Enregistrer » de la fenêtre Mode d'accès (handleSaveMode) : mode d'entrée (serveur), droits
        des invités (écriture Supabase du navigateur), puis préférence du coach (serveur)."""
        lancer(self.m.session_configure(self.m.SessionConfigBody(session_id=sid, mode=mode), authorization=self.jeton))
        self._ligne(sid)["access_mode"] = acces
        lancer(self.m.coach_preferences_live_maj(self.m.PreferencesLiveBody(acces=acces, session_id=sid), authorization=self.jeton))

    def fermer_sans_enregistrer(self):
        """Fermer l'overlay (Annuler / croix) : AUCUN appel — rien n'est écrit."""

    def quitter(self):
        """Quitter = temporaire : aucun appel de réglage (le Live continue pour les participants)."""

    def etat(self, sid):
        l = self._ligne(sid)
        return l.get("mode"), l.get("access_mode")


PANNES = ["aucune", "colonne_profiles_absente", "ligne_profiles_absente"]


def _panne(mod, panne):
    if panne == "colonne_profiles_absente":
        mod._base.colonne_prefs = False
    if panne == "ligne_profiles_absente":
        del mod._base.profiles[HOTE]


@pytest.mark.parametrize("panne", PANNES)
def test_gratuit_lien_qr_et_acces_visio_reviennent_au_prochain_live(m, panne):
    _panne(m, panne)
    c = Coach(m)
    c.ouvrir("LIVE1-AAAA")
    c.enregistrer("LIVE1-AAAA", "private", "account")        # Gratuit par lien/QR + Accès visio
    c.quitter()
    c = Coach(m)                                              # navigateur fermé puis rouvert
    c.ouvrir("LIVE2-BBBB")                                    # NOUVEAU Live
    assert c.etat("LIVE2-BBBB") == ("private", "account")


@pytest.mark.parametrize("panne", PANNES)
def test_avec_credits_et_ecoute_uniquement_reviennent_au_prochain_live(m, panne):
    _panne(m, panne)
    c = Coach(m)
    c.ouvrir("LIVE1-AAAA")
    c.enregistrer("LIVE1-AAAA", "private", "account")
    c.enregistrer("LIVE1-AAAA", "open", "guest")              # le DERNIER enregistrement fait foi
    Coach(m).ouvrir("LIVE2-BBBB")
    assert Coach(m).etat("LIVE2-BBBB") == ("open", "guest")


def test_fermer_l_overlay_sans_enregistrer_ne_change_aucune_preference(m):
    c = Coach(m)
    c.ouvrir("LIVE1-AAAA")
    c.enregistrer("LIVE1-AAAA", "private", "account")
    c.fermer_sans_enregistrer()                               # le coach ouvre la fenêtre, change, puis ferme
    c.ouvrir("LIVE2-BBBB")
    assert c.etat("LIVE2-BBBB") == ("private", "account")


def test_refresh_et_retour_sur_le_meme_live_ne_l_ecrasent_jamais(m):
    c = Coach(m)
    c.ouvrir("LIVE1-AAAA")
    c.enregistrer("LIVE1-AAAA", "private", "account")         # Live 1 réglé à la main : Gratuit + visio
    c.ouvrir("LIVE2-BBBB")
    c.enregistrer("LIVE2-BBBB", "open", "guest")              # Live 2 réglé à la main : Avec crédits + écoute
    for _ in range(3):                                        # refresh, Quitter puis retour, navigateur rouvert
        Coach(m).ouvrir("LIVE1-AAAA")
        Coach(m).ouvrir("LIVE2-BBBB")
    assert Coach(m).etat("LIVE1-AAAA") == ("private", "account")
    assert Coach(m).etat("LIVE2-BBBB") == ("open", "guest")


def test_reconnexion_meme_compte_nouveau_jeton(m):
    jetons = {"Bearer hote": HOTE, "Bearer hote-reconnecte": HOTE}
    ancien = m.get_user_from_token

    async def user(auth):
        return {"id": jetons[auth], "email": "a@x.ch"} if auth in jetons else await ancien(auth)
    m.get_user_from_token = user
    Coach(m).ouvrir("LIVE1-AAAA")
    Coach(m).enregistrer("LIVE1-AAAA", "private", "account")
    c = Coach(m, jeton="Bearer hote-reconnecte")              # déconnexion / reconnexion : nouveau jeton
    c.ouvrir("LIVE2-BBBB")
    assert c.etat("LIVE2-BBBB") == ("private", "account")


def test_un_live_jamais_regle_et_sans_preference_garde_les_defauts(m):
    c = Coach(m)
    c.ouvrir("LIVE1-AAAA")
    assert c.etat("LIVE1-AAAA") == ("open", "account")
