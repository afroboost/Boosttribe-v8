// 🛡️ S0 (19/10/2026) — Ce que le Live affiche des AUTRES participants (nom, photo).
//
// Après le verrou S0, la table `profiles` ne laisse lire que SA propre ligne : les autres
// profils passent par la vue `profiles_public` (id, full_name, avatar_url — rien d'autre).
// Tant que la migration n'est pas appliquée, la vue n'existe pas : on retombe sur `profiles`
// (comportement d'avant). Le frontend peut donc être déployé AVANT ou APRÈS la migration.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfilPublic = { id: string; full_name: string | null; avatar_url: string | null };

type Ligne = { id?: string; full_name?: string | null; avatar_url?: string | null };
const normaliser = (rows: unknown): ProfilPublic[] => ((rows as Ligne[] | null) || [])
  .filter((r) => !!r && typeof r.id === 'string')
  .map((r) => ({ id: r.id as string, full_name: r.full_name ?? null, avatar_url: r.avatar_url ?? null }));

export async function lireProfilsPublics(
  client: SupabaseClient,
  ids: string[],
  colonnes: 'id, avatar_url' | 'id, full_name, avatar_url',
): Promise<ProfilPublic[]> {
  if (ids.length === 0) return [];
  const vue = await client.from('profiles_public').select(colonnes).in('id', ids);
  if (!vue.error) return normaliser(vue.data);
  const table = await client.from('profiles').select(colonnes).in('id', ids);
  return table.error ? [] : normaliser(table.data);
}
