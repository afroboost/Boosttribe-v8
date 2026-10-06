"""
🎙️ Aide à la MESURE RÉELLE de « Échanger en visio » (pas un test automatique : appelle OpenAI, payant).

Passe par les VRAIES routes du serveur (`/live/assistant/transcription/jeton`, `/live/assistant/suggestions`
mode « voix »), avec la vraie requête HTTP vers OpenAI. Seuls l'identité et le rôle d'hôte sont simulés.
La clé est lue dans OPENAI_API_KEY (jamais affichée).

  python3 backend/tests/voix_reelle_aide.py jeton
  python3 backend/tests/voix_reelle_aide.py souffle "J'ai peur de ne pas suivre."
"""
import importlib.util
import json
import os
import sys

from fastapi.testclient import TestClient

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def appli():
    cle = os.environ.get("OPENAI_API_KEY", "").strip()
    if not cle.startswith("sk-"):
        print(json.dumps({"ok": False, "raison": "cle_absente"}))
        sys.exit(2)
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x",
                 "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x",
                 "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "cle",
                 "LIVEKIT_API_SECRET": "secret", "LIVEKIT_URL": "wss://sfu.test"}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain_voix_reelle", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    async def user(_a):
        return {"id": "uid-mesure", "email": "mesure@example.com"}

    async def hote(_s, _u):
        return True

    async def cle_ia():
        return cle

    m.get_user_from_token, m._is_host_or_cohost, m.get_openai_key = user, hote, cle_ia
    return m, TestClient(m.app)


if __name__ == "__main__":
    m, c = appli()
    H = {"Authorization": "Bearer mesure"}
    if sys.argv[1] == "jeton":
        print(json.dumps(c.post("/live/assistant/transcription/jeton", headers=H, json={"session_id": "MESURE-VOIX"}).json()))
    elif sys.argv[1] == "souffle":
        texte = sys.argv[2]
        d = c.post("/live/assistant/suggestions", headers=H, json={
            "session_id": "MESURE-VOIX", "mode": "voix", "invite": "Amina",
            "question": {"nom": "Amina", "texte": texte}, "message_id": f"voix-{abs(hash(texte))}"}).json()
        d["style"] = m._voix_style_artificiel(d["suggestions"][0]) if d.get("suggestions") else None
        print(json.dumps(d, ensure_ascii=False))
