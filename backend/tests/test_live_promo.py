"""
📣 Promo participant pendant le Live (V1) — routes de main.py + règles de live_promo.py.

Base, Stripe, portefeuille et authentification sont remplacés par des doubles EN MÉMOIRE :
rien ne sort du poste. On vérifie la machine d'état CÔTÉ SERVEUR, l'argent (aucun débit
avant acceptation, un seul crédit hôte même si le webhook est rejoué), le temps serveur et
l'isolation entre sessions.
Lancer : python3 -m pytest backend/tests/test_live_promo.py -q
"""
import asyncio
import importlib.util
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")
sys.path.insert(0, os.path.join(ICI, ".."))
import live_promo as LP  # noqa: E402


def lancer(coro):
    boucle = asyncio.new_event_loop()
    try:
        return boucle.run_until_complete(coro)
    finally:
        boucle.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle-test",
                 "LIVEKIT_API_SECRET": "secret-test-suffisamment-long-pour-hs256",
                 "LIVEKIT_URL": "wss://sfu.test", "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_live_promo", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


HOTE_C = "11111111-1111-1111-1111-111111111111"     # hôte en mode commission
HOTE_A = "22222222-2222-2222-2222-222222222222"     # hôte en mode abonnement
PART = "33333333-3333-3333-3333-333333333333"
PART2 = "44444444-4444-4444-4444-444444444444"
ADMIN = "55555555-5555-5555-5555-555555555555"     # LE super-admin (ADMIN_EMAILS), compte hors commission
OFFRES = [{"id": "o15", "duree_s": 15, "prix": 5}, {"id": "o30", "duree_s": 30, "prix": 10},
          {"id": "o60", "duree_s": 60, "prix": 20}, {"id": "off", "duree_s": 90, "prix": 25, "actif": False}]


class Monde:
    def __init__(self, m):
        self.m = m
        self.sessions = {
            "liveA": {"session_id": "liveA", "host_id": HOTE_C, "live_promo_enabled": True, "live_promo_offres": OFFRES},
            "liveB": {"session_id": "liveB", "host_id": HOTE_C, "live_promo_enabled": True, "live_promo_offres": OFFRES},
            "liveAbo": {"session_id": "liveAbo", "host_id": HOTE_A, "live_promo_enabled": True, "live_promo_offres": OFFRES},
            "liveAdmin": {"session_id": "liveAdmin", "host_id": ADMIN, "live_promo_enabled": False, "live_promo_offres": []},
        }
        self.promos = {}
        self.wallet = []            # (uid, delta, reason, ref)
        self.refs = set()
        self.stripe_cles = {}       # idempotency_key -> session
        self.stripe_crees = 0
        self.users = {"t-hote": {"id": HOTE_C, "email": "h@x.ch"}, "t-abo": {"id": HOTE_A, "email": "a@x.ch"},
                      "t-part": {"id": PART, "email": "p@x.ch", "user_metadata": {"full_name": "Léa Martin"}},
                      "t-part2": {"id": PART2, "email": "q@x.ch"},
                      "t-admin": {"id": ADMIN, "email": "contact.artboost@gmail.com"}}
        self.installer()

    def installer(self):
        m, W = self.m, self

        async def user(auth):
            t = str(auth or "").replace("Bearer ", "")
            if t not in W.users:
                raise HTTPException(status_code=401, detail="Token invalide")
            return W.users[t]

        async def session(sid):
            if sid not in W.sessions:
                raise HTTPException(status_code=404, detail="Session introuvable")
            return dict(W.sessions[sid])

        async def ptype(uid):
            return "commission" if uid == HOTE_C else "subscription"

        async def lire(filtre, ordre="requested_at.desc", limite=100):
            out = []
            for p in W.promos.values():
                ok = True
                for k, v in filtre.items():
                    op, _, val = v.partition(".")
                    if op == "eq" and str(p.get(k)) != val:
                        ok = False
                    if op == "in" and str(p.get(k)) not in val.strip("()").split(","):
                        ok = False
                if ok:
                    out.append(dict(p))
            return out[:limite]

        async def maj(pid, depuis, patch):
            p = W.promos.get(pid)
            if not p or p["status"] not in depuis:
                return None
            p.update(patch)
            return dict(p)

        async def inserer(row):
            r = {**row, "id": str(uuid.uuid4()), "checkout_attempt": 0}
            W.promos[r["id"]] = r
            return dict(r)

        async def upsert(sid, patch):
            W.sessions[sid].update(patch)
            return True

        async def enregistrer_config(sid, patch):   # 01/10 : UPDATE de la/des ligne(s) de la session
            if sid not in W.sessions:
                return 0
            W.sessions[sid].update(patch)
            return 1

        async def wallet_add(uid, delta, reason, ref, rev):
            if ref in W.refs:
                return
            W.refs.add(ref)
            W.wallet.append((uid, delta, reason, ref))

        async def comm(prix, uid):
            return {"percent": 15.0, "commission_chf": round(prix * 0.15, 2), "net_chf": round(prix * 0.85, 2)}

        async def cle():
            return "sk_test_x"

        class FauxSession:
            @staticmethod
            def create(**kw):
                k = kw.get("idempotency_key")
                if k in W.stripe_cles:
                    return W.stripe_cles[k]
                W.stripe_crees += 1
                s = type("S", (), {"id": f"cs_{W.stripe_crees}", "url": f"https://checkout.stripe.com/{W.stripe_crees}"})()
                s.meta = kw["metadata"]
                W.stripe_cles[k] = s
                return s

            @staticmethod
            def retrieve(sid):
                return {"status": "expired", "url": None}

        async def hote_admin(uid):
            return uid == ADMIN
        m._lp_hote_super_admin = hote_admin
        m.get_user_from_token = user
        m._lp_session = session
        m.get_coach_payment_type = ptype
        m._lp_lire = lire
        m._lp_maj = maj
        m._lp_inserer = inserer
        m.upsert_playlist_fields = upsert
        m._lp_enregistrer_config = enregistrer_config
        m.wallet_add = wallet_add
        m.compute_commission = comm
        m.apply_stripe_key = cle
        m.stripe.checkout.Session = FauxSession

    # raccourcis
    def appel(self, fn, *a, **k):
        return lancer(fn(*a, **k))

    def demander(self, jeton="Bearer t-part", sid="liveA", offre="o30", **x):
        corps = self.m.LivePromoRequestBody(session_id=sid, offre_id=offre, titre=x.get("titre", "Ma boutique"),
                                            texte=x.get("texte", "Nouveautés"), lien=x.get("lien"),
                                            media_url=x.get("media_url"))
        return self.appel(self.m.live_promo_request, corps, authorization=jeton)["promo"]

    def webhook_paye(self, promo_id):
        p = self.promos[promo_id]
        sess = next(s for s in self.stripe_cles.values() if s.meta["promo_id"] == promo_id)
        self.appel(self.m._lp_paiement_confirme, {"id": sess.id, "payment_status": "paid", "payment_intent": "pi_1"}, sess.meta)
        return p


@pytest.fixture()
def w():
    return Monde(charger_main())


def err(w, fn, *a, **k):
    with pytest.raises(HTTPException) as e:
        w.appel(fn, *a, **k)
    return e.value.status_code


# 1-2 — éligibilité
def test_hote_commission_voit_l_option_abonnement_non(w):
    assert w.appel(w.m.live_promo_host_config, "liveA", authorization="Bearer t-hote")["eligible"] is True
    cfg_abo = w.appel(w.m.live_promo_host_config, "liveAbo", authorization="Bearer t-abo")
    assert cfg_abo["eligible"] is False
    assert err(w, w.m.live_promo_save_config, w.m.LivePromoConfigBody(session_id="liveAbo", enabled=True),
               authorization="Bearer t-abo") == 403
    pub = w.appel(w.m.live_promo_config, "liveAbo")
    assert pub["enabled"] is False and pub["offres"] == []          # participant : rien à acheter


# 3 — tarifs
def test_participant_voit_exactement_les_tarifs_actifs(w):
    offres = w.appel(w.m.live_promo_config, "liveA")["offres"]
    assert [(o["duree_s"], o["prix"]) for o in offres] == [(15, 5.0), (30, 10.0), (60, 20.0)]


def test_tarifs_libres_mais_bornes_techniques(w):
    body = w.m.LivePromoConfigBody(session_id="liveA", enabled=True, offres=[{"duree_s": 45, "prix": 12.5}])
    assert w.appel(w.m.live_promo_save_config, body, authorization="Bearer t-hote")["offres"][0]["duree_s"] == 45
    for mauvais in ([{"duree_s": 0, "prix": 5}], [{"duree_s": 999999, "prix": 5}], [{"duree_s": 30, "prix": -1}]):
        assert err(w, w.m.live_promo_save_config, w.m.LivePromoConfigBody(session_id="liveA", offres=mauvais),
                   authorization="Bearer t-hote") == 400
    assert err(w, w.m.live_promo_save_config, w.m.LivePromoConfigBody(session_id="liveA", enabled=False),
               authorization="Bearer t-part") == 403               # seul l'hôte configure


# 4-6 — demande, refus, acceptation : aucun débit avant paiement
def test_demande_puis_refus_aucun_debit(w):
    p = w.demander()
    assert p["status"] == LP.REQUESTED and p["price_chf"] == 10.0 and p["duration_seconds"] == 30
    assert w.stripe_crees == 0 and w.wallet == []
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="reject"), authorization="Bearer t-hote")
    assert w.promos[p["id"]]["status"] == LP.REJECTED
    assert err(w, w.m.live_promo_pay, p["id"], authorization="Bearer t-part") == 409   # jamais payable
    assert w.stripe_crees == 0 and w.wallet == []


def test_pas_de_paiement_avant_acceptation_puis_checkout_existant(w):
    p = w.demander()
    assert err(w, w.m.live_promo_pay, p["id"], authorization="Bearer t-part") == 409
    assert err(w, w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"),
               authorization="Bearer t-part") == 403               # le participant ne s'accepte pas
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    url = w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")["url"]
    assert url.startswith("https://checkout.stripe.com/")
    sess = next(iter(w.stripe_cles.values()))
    assert sess.meta["kind"] == "live_promo" and sess.meta["coach_user_id"] == HOTE_C
    assert sess.meta["commission_chf"] == "1.5"                     # la règle de commission EXISTANTE
    assert w.promos[p["id"]]["status"] == LP.PAYMENT_PENDING and w.wallet == []


def test_double_clic_paiement_une_seule_session_stripe(w):
    p = w.demander()
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")
    w.promos[p["id"]]["status"] = LP.ACCEPTED        # 2e clic « en même temps » (avant l'écriture du 1er)
    w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")
    assert w.stripe_crees == 1


# 7-9 — échec, succès, double webhook
def test_paiement_echoue_aucune_diffusion(w):
    p = w.demander()
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")
    w.appel(w.m._lp_paiement_echoue, {}, {"promo_id": p["id"]})
    assert w.promos[p["id"]]["status"] == LP.PAYMENT_FAILED
    assert err(w, w.m.live_promo_start, p["id"], authorization="Bearer t-hote") == 409
    assert w.wallet == []
    # nouvelle tentative : une NOUVELLE session (autre clé d'idempotence)
    w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")
    assert w.stripe_crees == 2


def test_paiement_ok_ready_et_double_webhook_un_seul_credit(w):
    p = w.demander()
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    w.appel(w.m.live_promo_pay, p["id"], authorization="Bearer t-part")
    w.webhook_paye(p["id"])
    w.webhook_paye(p["id"])                            # Stripe rejoue l'événement
    assert w.promos[p["id"]]["status"] == LP.READY
    assert w.wallet == [(HOTE_C, 8.5, "live_promo", f"live_promo:{p['id']}")]


def _prete(w, jeton="Bearer t-part", sid="liveA", offre="o30", **x):
    p = w.demander(jeton, sid, offre, **x)
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    w.appel(w.m.live_promo_pay, p["id"], authorization=jeton)
    w.webhook_paye(p["id"])
    return p["id"]


# 10-13 — diffusion, temps serveur, refresh / arrivant
def test_diffuser_meme_fenetre_pour_tous_et_temps_restant(w):
    pid = _prete(w)
    r = w.appel(w.m.live_promo_start, pid, authorization="Bearer t-hote")
    debut = LP.lire_instant(r["promo"]["started_at"]); fin = LP.lire_instant(r["promo"]["ends_at"])
    assert (fin - debut).total_seconds() == 30
    a = w.appel(w.m.live_promo_active, "liveA")["promo"]
    b = w.appel(w.m.live_promo_active, "liveA")["promo"]
    assert a["ends_at"] == b["ends_at"] == r["promo"]["ends_at"]        # même échéance pour tous
    # refresh 12 s plus tard : il reste ~18 s, pas 30
    w.promos[pid]["started_at"] = (datetime.now(timezone.utc) - timedelta(seconds=12)).isoformat()
    w.promos[pid]["ends_at"] = (datetime.now(timezone.utc) + timedelta(seconds=18)).isoformat()
    reste = w.appel(w.m.live_promo_active, "liveA")["promo"]["remaining_seconds"]
    assert 17 <= reste <= 18
    assert err(w, w.m.live_promo_start, pid, authorization="Bearer t-hote") == 409   # pas deux fois


def test_fin_automatique_a_ends_at(w):
    pid = _prete(w)
    w.appel(w.m.live_promo_start, pid, authorization="Bearer t-hote")
    w.promos[pid]["ends_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    assert w.appel(w.m.live_promo_active, "liveA")["promo"] is None
    assert w.promos[pid]["status"] == LP.COMPLETED


def test_arret_hote_stopped_early_duree_reelle_sans_remboursement(w):
    pid = _prete(w)
    w.appel(w.m.live_promo_start, pid, authorization="Bearer t-hote")
    w.promos[pid]["started_at"] = (datetime.now(timezone.utc) - timedelta(seconds=7)).isoformat()
    assert err(w, w.m.live_promo_stop, pid, w.m.LivePromoStopBody(), authorization="Bearer t-part") == 403
    w.appel(w.m.live_promo_stop, pid, w.m.LivePromoStopBody(raison="fin_live"), authorization="Bearer t-hote")
    p = w.promos[pid]
    assert p["status"] == LP.STOPPED_EARLY and 6 <= p["actual_duration_seconds"] <= 8
    assert p["stopped_by"] == HOTE_C and p["stop_reason"] == "fin_live" and p["stopped_at"]
    assert len(w.wallet) == 1 and w.wallet[0][1] == 8.5                 # aucun remboursement automatique
    assert w.appel(w.m.live_promo_active, "liveA")["promo"] is None


# 14-16 — lien Découvrir
def test_lien_valide_absent_ou_dangereux(w):
    p = w.demander(lien="https://ma-boutique.ch/offre")
    assert p["external_url"] == "https://ma-boutique.ch/offre"
    p2 = w.demander("Bearer t-part2", lien="")
    assert p2["external_url"] is None
    for danger in ("javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.ch", "https://x.ch/\"><script>"):
        with pytest.raises(HTTPException) as e:
            w.demander("Bearer t-part", sid="liveB", lien=danger)
        assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        w.demander("Bearer t-part", sid="liveB", media_url="https://evil.example/x.jpg")   # image hors stockage contrôlé


def test_texte_sans_html_et_borne():
    assert LP.texte_propre("<b>Promo</b>\x00 ok", 60) == "<b>Promo</b> ok"     # conservé comme TEXTE (échappé à l'écran)
    assert len(LP.texte_propre("x" * 500, LP.TEXTE_MAX)) == LP.TEXTE_MAX


# 20 — isolation
def test_session_b_ne_voit_jamais_la_promo_de_a(w):
    pid = _prete(w)
    w.appel(w.m.live_promo_start, pid, authorization="Bearer t-hote")
    assert w.appel(w.m.live_promo_active, "liveA")["promo"]["id"] == pid
    assert w.appel(w.m.live_promo_active, "liveB")["promo"] is None
    assert all(p["session_id"] == "liveA" for p in w.appel(w.m.live_promo_host_list, "liveA", authorization="Bearer t-hote")["promos"])
    assert w.appel(w.m.live_promo_host_list, "liveB", authorization="Bearer t-hote")["promos"] == []
    assert err(w, w.m.live_promo_host_list, "liveA", authorization="Bearer t-part") == 403


def test_une_seule_demande_ouverte_par_participant_et_hote_exclu(w):
    w.demander()
    with pytest.raises(HTTPException) as e:
        w.demander()
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        w.demander("Bearer t-hote")
    assert e.value.status_code == 400


# 21 — la promo ne touche jamais au cycle de vie du Live
def test_aucune_route_promo_ne_touche_started_heartbeat_ended():
    src = open(MAIN, encoding="utf-8").read()
    bloc = src[src.index("📣 PROMO PARTICIPANT PENDANT LE LIVE (V1)"):]
    for mot in ("heartbeat", "live-status", "ended", "started", "is_live", "livekit_api", "EVENEMENT_LIVE"):
        assert mot not in bloc.replace("started_at", "").replace("started/heartbeat/ended", ""), mot


def test_transitions_serveur_refusent_les_raccourcis():
    assert not LP.transition_autorisee(LP.REQUESTED, LP.BROADCASTING)
    assert not LP.transition_autorisee(LP.ACCEPTED, LP.READY)
    assert not LP.transition_autorisee(LP.REJECTED, LP.PAYMENT_PENDING)
    assert LP.transition_autorisee(LP.READY, LP.BROADCASTING)


def test_schema_ajout_pur_idempotent_avec_sauvegarde():
    sql = LP.SQL_SCHEMA.lower()
    assert "create table if not exists public.playlists_backup_live_promo_20260930 as table public.playlists" in sql
    assert "add column if not exists live_promo_enabled" in sql and "create table if not exists public.live_promos" in sql
    for interdit in ("drop ", "delete ", "update ", "truncate"):
        assert interdit not in sql


# ─── HOTFIX : le super-admin voit, configure, modère et teste (sans règle d'argent inventée) ───
def test_super_admin_voit_et_configure_sa_session(w):
    cfg = w.appel(w.m.live_promo_host_config, "liveAdmin", authorization="Bearer t-admin")
    assert cfg["eligible"] is True and cfg["mode"] == "super_admin" and cfg["paiement_reel"] is False
    body = w.m.LivePromoConfigBody(session_id="liveAdmin", enabled=True, offres=[{"duree_s": 15, "prix": 5}, {"duree_s": 30, "prix": 10}])
    w.appel(w.m.live_promo_save_config, body, authorization="Bearer t-admin")
    pub = w.appel(w.m.live_promo_config, "liveAdmin")
    assert pub["enabled"] is True and len(pub["offres"]) == 2 and pub["paiement_reel"] is False   # « Faire ma promo » disponible


def test_super_admin_parcours_de_test_sans_argent(w):
    w.appel(w.m.live_promo_save_config, w.m.LivePromoConfigBody(session_id="liveAdmin", enabled=True,
            offres=[{"id": "t30", "duree_s": 30, "prix": 10}]), authorization="Bearer t-admin")
    p = w.demander(sid="liveAdmin", offre="t30")
    w.appel(w.m.live_promo_decision, p["id"], w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-admin")
    assert err(w, w.m.live_promo_pay, p["id"], authorization="Bearer t-part") == 409        # paiement réel fermé
    w.appel(w.m.live_promo_test_ready, p["id"], authorization="Bearer t-admin")
    assert w.promos[p["id"]]["status"] == LP.READY and w.promos[p["id"]]["test_sans_paiement"] is True
    w.appel(w.m.live_promo_start, p["id"], authorization="Bearer t-admin")
    assert w.appel(w.m.live_promo_active, "liveAdmin")["promo"]["id"] == p["id"]
    assert w.stripe_crees == 0 and w.wallet == []                                            # AUCUN argent


def test_test_sans_paiement_interdit_ailleurs(w):
    pid = w.demander()["id"]                                                                 # hôte commission
    w.appel(w.m.live_promo_decision, pid, w.m.LivePromoDecisionBody(decision="accept"), authorization="Bearer t-hote")
    assert err(w, w.m.live_promo_test_ready, pid, authorization="Bearer t-hote") == 403     # pas super-admin
    assert w.appel(w.m.live_promo_config, "liveA")["paiement_reel"] is True                  # commission inchangé


def test_hote_abonnement_ordinaire_toujours_refuse(w):
    cfg = w.appel(w.m.live_promo_host_config, "liveAbo", authorization="Bearer t-abo")
    assert cfg["eligible"] is False and cfg["mode"] is None
    assert err(w, w.m.live_promo_save_config, w.m.LivePromoConfigBody(session_id="liveAbo", enabled=True),
               authorization="Bearer t-abo") == 403
    assert w.appel(w.m.live_promo_config, "liveAbo")["enabled"] is False


def test_super_admin_ne_gere_que_SA_session(w):
    assert err(w, w.m.live_promo_host_list, "liveA", authorization="Bearer t-admin") == 403


def test_mode_promo_pur():
    assert LP.mode_promo("commission", False) == "commission"
    assert LP.mode_promo("commission", True) == "commission"       # super-admin EN commission : paiement réel
    assert LP.mode_promo("subscription", True) == "super_admin"
    assert LP.mode_promo("subscription", False) is None
    assert "test_sans_paiement boolean" in LP.SQL_SCHEMA and "drop " not in LP.SQL_SCHEMA.lower()
