// 🆔 Détection d'UUID valide. Les IDs « invités » (ex. `user_1784107695394_fynvg4`) NE SONT PAS des
//    UUID ; les envoyer à une colonne Postgres `uuid` (ex. profiles.id) → PostgREST renvoie 400.
//    → filtrer ces IDs AVANT toute requête `profiles?id=in.(…)`.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}
