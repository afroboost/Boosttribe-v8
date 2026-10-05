"""
📣 05/10 — « Faire la promo » pour l'INVITÉ IDENTIFIÉ d'un Live Afroboost (sans compte BoostTribe).

L'identité de l'invité = SA session invité Afroboost (cookie HttpOnly `afb_live_guest`, « Bon retour »).
afroboost.com/api/live-guest/jeton la convertit en un jeton COURT (HS256, secret partagé EXISTANT
`AFRO_BT_SHARED_SECRET`, iss=afroboost, aud=boosttribe-live-guest, sub = id de l'invité, pseudo,
session_code). Ce serveur ne fait confiance qu'à CE jeton : jamais à un e-mail / nom envoyé par le front.

Doubles en mémoire (aucune base, aucun Stripe, aucun réseau) : le monde de test_live_promo.
Lancer : python3 -m pytest backend/tests/test_live_promo_invite.py -q
"""
import time
import uuid

import jwt as pyjwt
import pytest
from fastapi import HTTPException

from test_live_promo import Monde, charger_main, lancer  # noqa: F401  (même monde que la promo V1)

SECRET = "secret-partage-de-test-suffisamment-long"
INVITE_ID = "9b1d6e2a-0000-4000-8000-000000000001"
AUTRE_INVITE_ID = "9b1d6e2a-0000-4000-8000-000000000002"


def jeton(sub=INVITE_ID, session="LIVEA", pseudo="Test", exp_dans=600, secret=SECRET, aud="boosttribe-live-guest", iss="afroboost", **x):
    t = int(time.time())
    corps = {"iss": iss, "aud": aud, "sub": sub, "pseudo": pseudo, "session_code": session,
             "iat": t, "exp": t + exp_dans, "jti": uuid.uuid4().hex, **x}
    return pyjwt.encode(corps, secret, algorithm="HS256")


@pytest.fixture()
def w(monkeypatch):
    monde = Monde(charger_main())
    monde.m.AFRO_BT_SHARED_SECRET = SECRET
    return monde


def demander_invite(w, j, sid="liveA", offre="o30", **x):
    corps = w.m.LivePromoRequestBody(session_id=sid, offre_id=offre, titre=x.get("titre", "Cours de salsa samedi"),
                                     texte="Viens danser", lien=None, media_url=None)
    return w.appel(w.m.live_promo_request, corps, authorization=None, x_live_guest=j)


def code(w, fn, *a, **k):
    with pytest.raises(HTTPException) as e:
        w.appel(fn, *a, **k)
    return e.value.status_code


# G + H — la demande de l'invité identifié est ACCEPTÉE et REÇUE par l'hôte, sous SON pseudo
def test_invite_identifie_envoie_sa_demande_et_l_hote_la_recoit(w):
    p = demander_invite(w, jeton())["promo"]
    assert p["status"] == "requested" and p["participant_name"] == "Test"
    assert p["participant_id"] == w.m._lp_id_invite(INVITE_ID)               # identifiant STABLE dérivé du serveur
    liste = w.appel(w.m.live_promo_host_list, "liveA", authorization="Bearer t-hote")["promos"]
    assert [x["id"] for x in liste] == [p["id"]] and liste[0]["participant_name"] == "Test"
    # « Mes demandes » : l'invité retrouve la sienne avec la même session
    mine = w.appel(w.m.live_promo_mine, "liveA", authorization=None, x_live_guest=jeton())["promos"]
    assert [x["id"] for x in mine] == [p["id"]]


def test_invite_une_seule_demande_ouverte_comme_un_compte(w):
    demander_invite(w, jeton())
    assert code(w, w.m.live_promo_request, w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="Encore"),
                authorization=None, x_live_guest=jeton()) == 409


# J — session invité expirée / invalide / falsifiée / d'un autre Live : refus, jamais d'usurpation
def test_session_invite_expiree_ou_falsifiee_refusee(w):
    corps = w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="X")
    for mauvais in (jeton(exp_dans=-5),                           # expirée
                    jeton(secret="autre-secret-de-meme-longueur-xx"),  # signée par un autre
                    jeton(aud="boosttribe"),                       # jeton d'accès BoostTribe ≠ session invité
                    jeton(aud="afroboost-contacts"),
                    jeton(iss="boosttribe"),
                    jeton(sub=""),
                    "pas-un-jeton", ""):
        assert code(w, w.m.live_promo_request, corps, authorization=None, x_live_guest=mauvais) == 401, mauvais
    assert w.promos == {}


def test_jeton_d_un_autre_live_refuse(w):
    assert code(w, w.m.live_promo_request, w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="X"),
                authorization=None, x_live_guest=jeton(session="LIVEB")) == 403
    assert w.promos == {}


def test_aucune_usurpation_ni_email_arbitraire(w):
    # Le corps ne porte NI identité NI e-mail : un champ ajouté par le front est ignoré (modèle Pydantic).
    corps = w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="X",
                                     participant_name="Léa Martin", email="lea@x.ch", participant_id=w.m._lp_id_invite(AUTRE_INVITE_ID))
    p = w.appel(w.m.live_promo_request, corps, authorization=None, x_live_guest=jeton())["promo"]
    assert p["participant_name"] == "Test" and p["participant_id"] == w.m._lp_id_invite(INVITE_ID)
    assert "lea@x.ch" not in str(p)
    # L'invité ne voit / ne paie QUE ses demandes : un autre invité n'y a pas accès.
    assert w.appel(w.m.live_promo_mine, "liveA", authorization=None, x_live_guest=jeton(sub=AUTRE_INVITE_ID))["promos"] == []
    assert code(w, w.m.live_promo_pay, p["id"], authorization=None, x_live_guest=jeton(sub=AUTRE_INVITE_ID)) == 403
    # Deux invités distincts = deux identités distinctes ; jamais celle d'un compte.
    assert w.m._lp_id_invite(INVITE_ID) != w.m._lp_id_invite(AUTRE_INVITE_ID)
    assert w.m._lp_id_invite(INVITE_ID) not in (w.users[k]["id"] for k in w.users)


def test_sans_aucune_identite_401_et_sans_secret_503(w):
    corps = w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="X")
    assert code(w, w.m.live_promo_request, corps, authorization=None, x_live_guest=None) == 401
    w.m.AFRO_BT_SHARED_SECRET = ""
    assert code(w, w.m.live_promo_request, corps, authorization=None, x_live_guest=jeton()) == 503


def test_compte_inchange_et_prioritaire(w):
    # Un compte connecté garde EXACTEMENT son chemin (jeton Supabase) ; l'en-tête invité n'y change rien.
    p = w.appel(w.m.live_promo_request, w.m.LivePromoRequestBody(session_id="liveA", offre_id="o30", titre="X"),
                authorization="Bearer t-part", x_live_guest=jeton())["promo"]
    assert p["participant_name"] == "Léa Martin"


def test_le_jeton_invite_n_ouvre_aucune_route_hote(w):
    p = demander_invite(w, jeton())["promo"]
    # Décider / lister / diffuser restent réservés au jeton de compte de l'hôte (aucun paramètre invité).
    for fn in (w.m.live_promo_decision, w.m.live_promo_host_list):
        assert "x_live_guest" not in fn.__code__.co_varnames
    assert code(w, w.m.live_promo_host_list, "liveA", authorization=None) == 401
    assert w.promos[p["id"]]["status"] == "requested"
