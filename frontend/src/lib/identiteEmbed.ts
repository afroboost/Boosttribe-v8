/**
 * 🔐 01/10 — Entrée Live depuis Afroboost : on ne continue QUE sous le compte annoncé par le jeton.
 *
 * Défaut corrigé : si la connexion du nouveau compte échouait, l'entrée réussissait quand même et
 * le Live tournait sous la session Supabase PRÉCÉDENTE restée dans le navigateur (afroboost.com,
 * même origine) — par exemple celle de l'administrateur → ses réseaux sociaux, son rôle d'hôte.
 */
export function memeCompte(attendu: string | null | undefined, actuel: string | null | undefined): boolean {
  const a = (attendu || '').trim().toLowerCase();
  const b = (actuel || '').trim().toLowerCase();
  return !!a && a === b;
}

/** Une session déjà ouverte pour un AUTRE compte doit être fermée avant de connecter le nouveau. */
export function sessionEtrangere(attendu: string | null | undefined, actuel: string | null | undefined): boolean {
  return !!(actuel || '').trim() && !memeCompte(attendu, actuel);
}
