"""
🤖 SOUFFLEUR — l'assistant PRIVÉ de l'hôte : qui peut l'appeler, et ce qui sort d'ici.

Trois garanties, et ce sont les trois que le produit ne peut pas se permettre de perdre :

1. CACHER LE PANNEAU NE SUFFIT PAS. Un spectateur qui devine l'URL doit être refusé par le
   SERVEUR, pas par du CSS. Sans jeton : 401. Authentifié mais pas hôte : 403.
2. AUCUN SECRET NE SORT. La clé OpenAI reste côté serveur ; la réponse ne contient que du
   texte de suggestion.
3. UN SOUFFLEUR MUET N'ARRÊTE PAS UN DIRECT. Clé absente ou fournisseur en panne → `ok:false`
   avec un motif, jamais une erreur qui casserait la page.

Et une quatrième, de confidentialité : une adresse e-mail ou un numéro présent dans le chat
ne part JAMAIS chez le fournisseur.

Lancer : python3 -m pytest backend/tests/test_souffleur_hote.py -q
"""
import importlib.util
import os
import sys
import types

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle",
                 "LIVEKIT_API_SECRET": "secret", "LIVEKIT_URL": "wss://sfu.test",
                 "ADMIN_EMAILS": "contact.artboost@gmail.com"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_souffleur", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def appli(monkeypatch):
    m = charger_main()
    etat = {"hotes": {("SESS-1", "uid-hote")}, "cle": "sk-test-factice", "appels": [], "reponse": None}

    async def faux_user(authorization):
        if authorization == "Bearer hote":
            return {"id": "uid-hote", "email": "coach@example.com"}
        if authorization == "Bearer spectateur":
            return {"id": "uid-spectateur", "email": "public@example.com"}
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
            if etat["reponse"] == "panne":
                raise RuntimeError("fournisseur injoignable")
            if etat["reponse"] == "http500":
                return FausseReponse(500, {})
            if etat["reponse"] == "illisible":
                return FausseReponse(200, {"choices": [{"message": {"content": "{}"}}]})
            return FausseReponse(200, {"choices": [{"message": {"content":
                '{"suggestions":["Oui, les débutants sont les bienvenus.","Viens essayer une séance."]}'}}]})

    monkeypatch.setattr(m, "get_user_from_token", faux_user)
    monkeypatch.setattr(m, "_is_host_or_cohost", faux_hote)
    monkeypatch.setattr(m, "get_openai_key", fausse_cle)
    monkeypatch.setattr(m.httpx, "AsyncClient", FauxClient)
    ms = sys.modules.get("multistream") or getattr(m, "_ms", None)
    if ms is not None:
        ms.reinitialiser_pour_tests(); ms.definir_moteur(None)
    yield m, etat, TestClient(m.app)
    if ms is not None:
        ms.reinitialiser_pour_tests(); ms.definir_moteur(None)


CORPS = {"session_id": "SESS-1", "mode": "chat",
         "messages": [{"nom": "Julie", "texte": "Je n'ai jamais dansé, c'est pour moi ?"}]}


# ══════════ 1. QUI PEUT APPELER ══════════

def test_sans_jeton_401(appli):
    _m, _e, c = appli
    assert c.post("/live/assistant/suggestions", json=CORPS).status_code == 401


def test_un_spectateur_authentifie_est_refuse_par_le_serveur(appli):
    """Le cœur du sujet : deviner l'URL ne donne rien."""
    _m, etat, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer spectateur"}, json=CORPS)
    assert r.status_code == 403 and r.json()["detail"] == "assistant_reserve_a_l_hote"
    assert etat["appels"] == [], "aucun appel au fournisseur pour un non-hôte"


def test_un_hote_d_une_AUTRE_session_est_refuse(appli):
    _m, _e, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"},
               json={**CORPS, "session_id": "SESS-AUTRE"})
    assert r.status_code == 403


def test_identifiant_de_session_invalide(appli):
    _m, _e, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"},
               json={**CORPS, "session_id": "pas valide !"})
    assert r.status_code == 400


# ══════════ 2. CE QUI SORT, ET CE QUI NE SORT PAS ══════════

def test_l_hote_recoit_des_suggestions_courtes(appli):
    _m, _e, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json=CORPS)
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True and d["mode"] == "chat"
    assert 2 <= len(d["suggestions"]) <= 4
    assert all(isinstance(x, str) and x for x in d["suggestions"])
    # Rien d'autre que du texte : aucune clé, aucun jeton dans la réponse.
    assert set(d) == {"ok", "mode", "suggestions"}
    assert "sk-" not in r.text


def test_adresses_et_numeros_ne_partent_JAMAIS_chez_le_fournisseur(appli):
    _m, etat, c = appli
    c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json={
        "session_id": "SESS-1", "mode": "chat",
        "messages": [{"nom": "Julie", "texte": "écris-moi julie.dupont@example.com ou au +41 79 123 45 67"}]})
    envoye = str(etat["appels"][0]["json"])
    assert "julie.dupont@example.com" not in envoye
    assert "79 123 45 67" not in envoye and "791234567" not in envoye
    assert "[adresse masquée]" in envoye and "[numéro masqué]" in envoye


def test_la_fenetre_de_contexte_reste_courte(appli):
    """On n'envoie pas tout le direct : les 8 derniers messages, tronqués."""
    _m, etat, c = appli
    messages = [{"nom": f"P{i}", "texte": f"message numero {i} " + "x" * 400} for i in range(30)]
    c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"},
           json={"session_id": "SESS-1", "mode": "chat", "messages": messages})
    contenu = etat["appels"][0]["json"]["messages"][1]["content"]
    assert contenu.count(" : ") <= 8
    assert "message numero 29" in contenu and "message numero 21" not in contenu
    assert len(contenu) < 8000


def test_mode_visio_parle_de_la_personne_a_l_ecran(appli):
    _m, etat, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"},
               json={"session_id": "SESS-1", "mode": "visio", "invite": "Julie", "messages": []})
    assert r.json()["mode"] == "visio"
    envoi = etat["appels"][0]["json"]["messages"]
    assert "QUESTIONS" in envoi[0]["content"]
    assert "Julie" in envoi[1]["content"]


def test_le_modele_recoit_l_interdiction_d_inventer_un_prix(appli):
    _m, etat, c = appli
    c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json=CORPS)
    consigne = etat["appels"][0]["json"]["messages"][0]["content"]
    assert "N'invente aucun prix" in consigne
    assert "Tu ne parles JAMAIS au public" in consigne


# ══════════ 3. UNE PANNE NE CASSE PAS LE DIRECT ══════════

@pytest.mark.parametrize("panne,motif", [("panne", "fournisseur_indisponible"),
                                         ("http500", "fournisseur_indisponible"),
                                         ("illisible", "reponse_illisible")])
def test_le_souffleur_se_tait_proprement(appli, panne, motif):
    _m, etat, c = appli
    etat["reponse"] = panne
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json=CORPS)
    assert r.status_code == 200, "jamais une erreur qui casserait la page du direct"
    assert r.json() == {"ok": False, "raison": motif, "suggestions": []}


def test_sans_cle_configuree_il_le_dit_sans_appeler_personne(appli):
    _m, etat, c = appli
    etat["cle"] = None
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json=CORPS)
    assert r.json() == {"ok": False, "raison": "ia_non_configuree", "suggestions": []}
    assert etat["appels"] == []


def test_la_cle_part_dans_l_en_tete_et_nulle_part_ailleurs(appli):
    _m, etat, c = appli
    r = c.post("/live/assistant/suggestions", headers={"Authorization": "Bearer hote"}, json=CORPS)
    appel = etat["appels"][0]
    assert appel["headers"]["Authorization"] == "Bearer sk-test-factice"
    assert "sk-test-factice" not in str(appel["json"]), "la clé n'est pas dans le corps"
    assert "sk-test-factice" not in r.text, "la clé ne revient pas au navigateur"
