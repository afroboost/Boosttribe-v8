"""
🎙️ « ÉCHANGER EN VISIO » — la voix du participant devient UNE suggestion orale pour l'hôte.

Garanties vérifiées ici (serveur) :

1. JETON DE TRANSCRIPTION : hôte seul (401 sans jeton, 403 non-hôte), la clé OpenAI standard
   ne sort JAMAIS — seul un secret éphémère (`ek_…`, 10 min) part vers le navigateur de l'hôte,
   pour une session de type « transcription » uniquement (gpt-4o-mini-transcribe, français).
2. MODE « voix » : UNE seule suggestion, tutoiement, ~20 mots, orale. Une réponse qui sonne IA
   est régénérée UNE fois ; si elle reste artificielle, RIEN n'est montré.
3. DONNÉES MINIMALES : seul le texte transcrit de la phrase part au modèle (pas le chat, pas
   d'audio) ; e-mail / numéro retirés.
4. LE CHAT N'A PAS BOUGÉ : le mode « chat » garde ses consignes et son format.

Lancer : python3 -m pytest backend/tests/test_voix_visio.py -q
"""
import importlib.util
import json as _json
import os
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")

BON_DEBUTANT = "Oui bien sûr, tu peux commencer même si tu débutes. Je te montrerai les mouvements tranquillement."
BON_PEUR = "T'inquiète, tu vas à ton rythme. Le but c'est surtout de bouger et de passer un bon moment."
IA_DEBUTANT = ("Absolument, cette activité est parfaitement adaptée aux personnes débutantes "
               "et permet une progression à votre rythme.")
IA_PEUR = "Il est tout à fait normal d'éprouver cette appréhension lors d'une première séance."


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle",
                 "LIVEKIT_API_SECRET": "secret", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_voix", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def appli(monkeypatch):
    m = charger_main()
    etat = {"hotes": {("SESS-1", "uid-hote"), ("SESS-2", "uid-hote")}, "cle": "sk-test-factice", "appels": [],
            "reponses": [], "jeton": "ok", "coach": True}

    async def faux_user(authorization):
        if authorization == "Bearer hote":
            return {"id": "uid-hote", "email": "coach@example.com"}
        if authorization == "Bearer spectateur":
            return {"id": "uid-spectateur", "email": "public@example.com"}
        if authorization == "Bearer admin":
            return {"id": "uid-admin", "email": "contact.artboost@gmail.com"}
        raise HTTPException(status_code=401, detail="Token manquant")

    async def faux_hote(session_id, user_id):
        return (session_id, user_id) in etat["hotes"]

    async def fausse_cle():
        return etat["cle"]

    class FausseReponse:
        def __init__(self, code, data): self.status_code, self._d = code, data
        def json(self): return self._d

    class FauxClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            etat["appels"].append({"url": url, "headers": headers or {}, "json": json or {}})
            if url.endswith("/realtime/client_secrets"):
                if etat["jeton"] == "panne":
                    return FausseReponse(500, {})
                return FausseReponse(200, {"value": "ek_test_ephemere", "expires_at": 1999999999,
                                           "session": {"type": "transcription"}})
            texte = etat["reponses"].pop(0) if etat["reponses"] else BON_DEBUTANT
            return FausseReponse(200, {"choices": [{"message": {"content": _json.dumps({"suggestion": texte})}}]})

    async def hote_coach(session_id):
        return etat["coach"]

    monkeypatch.setattr(m, "_hote_session_coach", hote_coach)
    monkeypatch.setattr(m, "get_user_from_token", faux_user)
    monkeypatch.setattr(m, "_is_host_or_cohost", faux_hote)
    monkeypatch.setattr(m, "get_openai_key", fausse_cle)
    monkeypatch.setattr(m.httpx, "AsyncClient", FauxClient)
    m._souffleur_appels.clear(); m._souffleur_memoire.clear(); m._souffleur_en_vol.clear()
    m._transcription_jetons.clear()
    yield m, etat, TestClient(m.app)


H = {"Authorization": "Bearer hote"}
JETON = "/live/assistant/transcription/jeton"
SUGG = "/live/assistant/suggestions"


def voix(texte, mid="voix-item_1", nom="Amina"):
    return {"session_id": "SESS-1", "mode": "voix", "question": {"nom": nom, "texte": texte},
            "message_id": mid, "invite": nom}


# ══════════ 1. JETON DE TRANSCRIPTION ══════════

def test_jeton_sans_auth_401(appli):
    _m, etat, c = appli
    assert c.post(JETON, json={"session_id": "SESS-1"}).status_code == 401
    assert etat["appels"] == []


def test_jeton_non_hote_403(appli):
    _m, etat, c = appli
    r = c.post(JETON, headers={"Authorization": "Bearer spectateur"}, json={"session_id": "SESS-1"})
    assert r.status_code == 403
    assert etat["appels"] == [], "aucun jeton fabriqué pour un non-hôte"


def test_jeton_hote_recoit_un_secret_ephemere_jamais_la_cle(appli):
    _m, etat, c = appli
    r = c.post(JETON, headers=H, json={"session_id": "SESS-1"})
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True and d["client_secret"] == "ek_test_ephemere"
    assert "sk-test-factice" not in r.text, "la clé standard ne sort jamais"
    appel = etat["appels"][0]
    assert appel["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    s = appel["json"]["session"]
    assert s["type"] == "transcription"
    t = s["audio"]["input"]["transcription"]
    assert t["model"] == "gpt-4o-mini-transcribe" and t["language"] == "fr"
    assert s["audio"]["input"]["turn_detection"]["type"] == "server_vad"
    assert appel["json"]["expires_after"]["seconds"] <= 600


def test_jeton_fournisseur_en_panne_ne_casse_rien(appli):
    _m, etat, c = appli
    etat["jeton"] = "panne"
    r = c.post(JETON, headers=H, json={"session_id": "SESS-1"})
    assert r.status_code == 200 and r.json()["ok"] is False


def test_jeton_cle_absente(appli):
    _m, etat, c = appli
    etat["cle"] = None
    r = c.post(JETON, headers=H, json={"session_id": "SESS-1"})
    assert r.json() == {"ok": False, "raison": "ia_non_configuree"}


def test_jeton_hote_sans_espace_coach_refuse(appli):
    """Revue sécurité : un compte quelconque qui crée son Live n'obtient AUCUN jeton payant."""
    _m, etat, c = appli
    etat["coach"] = False
    r = c.post(JETON, headers=H, json={"session_id": "SESS-1"})
    assert r.status_code == 403
    assert etat["appels"] == [], "aucun appel à OpenAI"
    r = c.post(SUGG, headers=H, json=voix("Je peux venir si je débute ?"))
    assert r.status_code == 403 and etat["appels"] == [], "mode voix : même règle"


def test_jeton_admin_sans_espace_coach_accepte(appli):
    _m, etat, c = appli
    etat["coach"] = False
    etat["hotes"].add(("SESS-1", "uid-admin"))
    r = c.post(JETON, headers={"Authorization": "Bearer admin"}, json={"session_id": "SESS-1"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_jeton_plafond_par_compte_tous_lives(appli):
    m, _e, c = appli
    m.TRANSCRIPTION_MAX_JETONS = 100                     # isole le plafond COMPTE
    rep = [c.post(JETON, headers=H, json={"session_id": "SESS-1" if i % 2 else "SESS-2"}).json() for i in range(21)]
    assert all(r["ok"] for r in rep[:20])
    assert rep[20] == {"ok": False, "raison": "trop_de_demandes"}


def test_jeton_plafond_compte_jamais_efface_par_la_borne_memoire(appli):
    """Revue sécurité : d'AUTRES comptes qui remplissent la table ne remettent PAS à zéro le plafond
    d'un compte (avant : la purge effaçait les 1000 premières clés, compteur du compte compris)."""
    m, etat, c = appli
    m.TRANSCRIPTION_MAX_JETONS = 100
    for i in range(20):                                   # le compte épuise son plafond horaire
        etat["hotes"].add((f"LIVE-{i:03d}", "uid-hote"))
        assert c.post(JETON, headers=H, json={"session_id": f"LIVE-{i:03d}"}).json()["ok"] is True
    m.TRANSCRIPTION_MAX_CLES = 25
    maintenant = m.time.time()
    for j in range(10):                                   # d'autres comptes remplissent la table (compteurs vivants)
        m._transcription_jetons[f"autre-{j}|LIVE"] = [maintenant]
    etat["hotes"].add(("LIVE-ADM", "uid-admin"))
    c.post(JETON, headers={"Authorization": "Bearer admin"}, json={"session_id": "LIVE-ADM"})   # déclencheur de purge
    etat["hotes"].add(("LIVE-NEUF", "uid-hote"))
    r = c.post(JETON, headers=H, json={"session_id": "LIVE-NEUF"}).json()
    assert r == {"ok": False, "raison": "trop_de_demandes"}, "plafond du compte contourné par la purge"
    assert "uid-hote|*" in m._transcription_jetons


def test_jeton_table_pleine_purge_seulement_l_expire(appli):
    m, _e, c = appli
    m.TRANSCRIPTION_MAX_CLES = 3
    vieux = m.time.time() - 2 * m.TRANSCRIPTION_FENETRE_COMPTE_S
    m._transcription_jetons.update({"x|A": [vieux], "x|*": [vieux], "y|*": [m.time.time()]})
    assert c.post(JETON, headers=H, json={"session_id": "SESS-1"}).json()["ok"] is True
    assert "y|*" in m._transcription_jetons, "un compteur vivant n'est jamais effacé"
    assert "x|A" not in m._transcription_jetons


def test_jeton_limite_de_frequence(appli):
    _m, _e, c = appli
    rep = [c.post(JETON, headers=H, json={"session_id": "SESS-1"}).json() for _ in range(12)]
    assert rep[0]["ok"] is True
    assert rep[-1] == {"ok": False, "raison": "trop_de_demandes"}


# ══════════ 2. STYLE ORAL ══════════

@pytest.mark.parametrize("texte", [BON_DEBUTANT, BON_PEUR, "Carrément, viens essayer samedi, on y va tranquille."])
def test_style_naturel_accepte(appli, texte):
    m, _e, _c = appli
    assert m._voix_style_artificiel(texte) is None


@pytest.mark.parametrize("texte", [
    IA_DEBUTANT, IA_PEUR,
    "Tout à fait, tu peux venir.",
    "N'hésite pas à venir essayer.",
    "Vous pouvez venir quand vous voulez.",
    "Oui tu peux venir " + "vraiment " * 25 + "sans souci.",
    "Oui. Tu peux venir. On commence doucement. Tu verras.",
])
def test_style_ia_refuse(appli, texte):
    m, _e, _c = appli
    assert m._voix_style_artificiel(texte) is not None


# ══════════ 3. MODE « voix » ══════════

def test_voix_une_seule_suggestion_naturelle(appli):
    _m, etat, c = appli
    etat["reponses"] = [BON_DEBUTANT]
    r = c.post(SUGG, headers=H, json=voix("Est-ce que je peux participer si je suis débutant ?"))
    d = r.json()
    assert d["ok"] is True and d["mode"] == "voix" and d["suggestions"] == [BON_DEBUTANT]
    assert len([a for a in etat["appels"] if "chat/completions" in a["url"]]) == 1


def test_voix_reponse_ia_regeneree_une_fois(appli):
    _m, etat, c = appli
    etat["reponses"] = [IA_PEUR, BON_PEUR]
    d = c.post(SUGG, headers=H, json=voix("J'ai peur de ne pas suivre.")).json()
    assert d["ok"] is True and d["suggestions"] == [BON_PEUR]
    assert len(etat["appels"]) == 2, "une seule régénération"


def test_voix_reste_artificielle_rien_n_est_montre(appli):
    _m, etat, c = appli
    etat["reponses"] = [IA_PEUR, IA_DEBUTANT, BON_PEUR]
    d = c.post(SUGG, headers=H, json=voix("J'ai peur de ne pas suivre.")).json()
    assert d == {"ok": False, "raison": "style_artificiel", "suggestions": []}
    assert len(etat["appels"]) == 2, "jamais une 3e tentative"


def test_voix_rien_a_repondre(appli):
    _m, etat, c = appli
    etat["reponses"] = [""]
    d = c.post(SUGG, headers=H, json=voix("Merci.")).json()
    assert d == {"ok": False, "raison": "rien_a_repondre", "suggestions": []}


def test_voix_donnees_minimales(appli):
    _m, etat, c = appli
    corps = voix("Je suis débutant, mon mail c'est amina@example.com et mon numéro 079 123 45 67")
    corps["messages"] = [{"nom": "Bob", "texte": "message du chat qui ne doit pas partir"}]
    c.post(SUGG, headers=H, json=corps)
    envoye = _json.dumps(etat["appels"][0]["json"], ensure_ascii=False)
    assert "amina@example.com" not in envoye and "079 123 45 67" not in envoye
    assert "message du chat" not in envoye, "le mode voix n'envoie pas le chat"


def test_voix_non_hote_403(appli):
    _m, etat, c = appli
    r = c.post(SUGG, headers={"Authorization": "Bearer spectateur"}, json=voix("Je peux venir ?"))
    assert r.status_code == 403 and etat["appels"] == []


def test_voix_meme_phrase_un_seul_appel(appli):
    _m, etat, c = appli
    c.post(SUGG, headers=H, json=voix("Je peux venir si je débute ?", mid="voix-item_9"))
    d = c.post(SUGG, headers=H, json=voix("Je peux venir si je débute ?", mid="voix-item_9")).json()
    assert d.get("deja") is True and len(etat["appels"]) == 1


# ══════════ 4. LE CHAT N'A PAS BOUGÉ ══════════

def test_consignes_chat_inchangees(appli):
    m, _e, _c = appli
    chat = m._souffleur_instructions("chat")
    assert "Propose des RÉPONSES au dernier message" in chat and '{"suggestions"' in chat
