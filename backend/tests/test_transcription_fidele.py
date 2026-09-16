"""
🎙️ Transcription FIDÈLE (Phase 1 mini studio, 16/09/2026) — deux bancs, zéro réseau par défaut.

1. `_nettoyer_transcription` est une mise en forme SANS PERTE : une phrase par ligne, une
   répétition technique ×3 retirée, et rien d'autre. Aucun mot réécrit, aucun mot retiré.
2. Le parcours d'enregistrement n'appelle plus la passe LLM (`_openai_refine`) : le texte du
   moteur EST la transcription, `summary` reste vide.

Preuve avec le VRAI moteur (coût minime, uniquement si OPENAI_API_KEY est posé) :
    OPENAI_API_KEY=… python3 backend/tests/test_transcription_fidele.py --reel chemin/echantillon.wav chemin/attendu.txt
→ imprime ATTENDU / PRODUIT (avec et sans vocabulaire), le taux d'erreur mots, et vérifie
  qu'aucun résumé n'est produit (nombre de mots ≥ 90 % de l'attendu).
Lancer sans argument = bancs hors ligne seulement :  python3 backend/tests/test_transcription_fidele.py
"""
import importlib.util
import os
import re
import sys
import difflib

ICI = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(ICI, "..", "main.py")


def charger_main():
    for k, v in {"SUPABASE_URL": "http://localhost", "SUPABASE_SERVICE_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x",
                 "SUPABASE_ANON_KEY": "x", "STRIPE_SECRET_KEY": "sk_test_x", "LIVEKIT_API_KEY": "x",
                 "LIVEKIT_API_SECRET": "x", "ENCRYPTION_KEY": "x" * 32}.items():
        os.environ.setdefault(k, v)
    spec = importlib.util.spec_from_file_location("btmain", MAIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def mots(t):
    return re.findall(r"[a-zà-ÿ0-9']+", (t or "").lower())


def wer(ref, hyp):
    r, h = mots(ref), mots(hyp)
    sm = difflib.SequenceMatcher(a=r, b=h)
    ok = sum(b.size for b in sm.get_matching_blocks())
    return 1 - ok / max(1, len(r))


verts = 0
rouges = 0


def verifier(nom, cond, detail=""):
    global verts, rouges
    if cond:
        verts += 1
        print(f"  PASS  {nom}")
    else:
        rouges += 1
        print(f"  FAIL  {nom}   -> {detail}")


def bancs_hors_ligne(m):
    src = open(MAIN, encoding="utf-8").read()
    n = m._nettoyer_transcription
    # 1) sans perte : mêmes mots, même ordre
    brut = "Bonjour à tous.  Est-ce qu'il faut savoir danser ?   Non, tu peux venir même si tu débutes !"
    prop = n(brut)
    verifier("N1. une phrase par ligne", prop.count("\n") == 2, repr(prop))
    verifier("N2. aucun mot perdu ni réécrit", mots(brut) == mots(prop), prop)
    # 2) répétition technique ×3 (artefact moteur) retirée, ×2 conservée (une vraie insistance)
    rep3 = "On y va. On y va. On y va. Bonjour."
    verifier("N3. une même phrase collée 3 fois -> 2 gardées, la 3e retirée", n(rep3).count("On y va.") == 2, n(rep3))
    rep2 = "Encore. Encore. Merci."
    verifier("N4. deux répétitions restent (parole réelle)", n(rep2).count("Encore.") == 2, n(rep2))
    # 3) rien inventé, vide -> vide
    verifier("N5. texte vide -> vide", n("   ") == "")
    verifier("N6. les mots [inaudible]/[incertain] passent tels quels", "[inaudible]" in n("Il a dit [inaudible] puis merci."))
    # 4) structure : plus de passe LLM dans le parcours d'enregistrement
    i = src.index("raw = await _openai_transcribe(")
    route = src[i:src.index('@app.get("/session/recordings")')]
    verifier("T1. le parcours n'appelle plus _openai_refine (aucun résumé automatique)", "await _openai_refine(" not in route)
    verifier("T2. transcript = texte du moteur, summary vide", 'patch = {"status": "done", "transcript": raw, "summary": ""}' in route)
    verifier("T3. température 0 + vocabulaire Afroboost en contexte", '"temperature": "0"' in src and "Afroboost, Afroboosteur" in src)
    verifier("T4. la fonction de résumé subsiste mais DÉCOUPLÉE (usage à la demande)", "async def _openai_refine(" in src)


def preuve_reelle(m, wav, attendu_path):
    import asyncio
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        print("  SKIP  preuve réelle : OPENAI_API_KEY absent")
        return
    audio = open(wav, "rb").read()
    attendu = open(attendu_path, encoding="utf-8").read().strip()

    async def run():
        avec = await m._openai_transcribe(audio, os.path.basename(wav), "audio/wav", key)
        sans = await m._openai_transcribe(audio, os.path.basename(wav), "audio/wav", key, prompt="")
        return avec, sans
    avec, sans = asyncio.run(run())
    print("\n=== ATTENDU ===\n" + attendu + "\n\n=== PRODUIT (avec vocabulaire) ===\n" + avec + "\n\n=== PRODUIT (sans vocabulaire) ===\n" + sans + "\n")
    verifier("R1. aucun résumé : ≥ 90 % des mots attendus", len(mots(avec)) >= 0.9 * len(mots(attendu)), f"{len(mots(avec))}/{len(mots(attendu))}")
    # R2 tolère singulier/pluriel (« fondateurs » ↔ « fondateur ») : ce n'est pas un résumé, c'est le moteur.
    sing = lambda w: w[:-1] if w.endswith("s") and len(w) > 4 else w
    produits = {sing(w) for w in mots(avec)}
    verifier("R2. chaque ligne attendue a ses 3 premiers mots dans le produit",
             all(all(sing(w) in produits for w in mots(l)[:3]) for l in attendu.splitlines() if mots(l)))
    w_avec, w_sans = wer(attendu, avec), wer(attendu, sans)
    verifier(f"R3. fidélité : WER avec vocabulaire = {w_avec:.1%} (sans = {w_sans:.1%}), seuil 15 %", w_avec <= 0.15)
    verifier("R4. le vocabulaire n'ajoute pas de mot absent de l'audio",
             not [w for w in set(mots(avec)) - set(mots(sans)) if w in {"afroboost", "afroboosteur", "bassi", "pulse", "fondateurs", "freedom", "flex", "auvernier"} and w not in mots(attendu)])


if __name__ == "__main__":
    m = charger_main()
    print("— bancs hors ligne —")
    bancs_hors_ligne(m)
    if len(sys.argv) >= 4 and sys.argv[1] == "--reel":
        print("— preuve avec le vrai moteur —")
        preuve_reelle(m, sys.argv[2], sys.argv[3])
    print(f"\n{verts} vert(s) / {rouges} rouge(s)")
    sys.exit(1 if rouges else 0)
