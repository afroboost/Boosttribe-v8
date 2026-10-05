/** 🛡️ Contrat Live : jeton FACTICE pour les appels promo du harnais (le réseau y est intercepté).
 *  05/10 : `__contratSansCompte` = invité SANS compte (aucun jeton de compte : sa session invité sert). */
export async function getAccessToken(): Promise<string | null> {
  return (globalThis as unknown as { __contratSansCompte?: boolean }).__contratSansCompte ? null : 'jeton-contrat';
}
