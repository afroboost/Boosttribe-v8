/**
 * 🪪 L'IDENTITÉ D'UN PARTICIPANT AU LIVE — d'où vient son nom, et quand le demander.
 *
 * CONSTAT (audit du 22/09/2026). Le pseudo ne venait QUE de `localStorage['bt_nickname']` :
 * un coach ou un abonné déjà connu d'Afroboost devait le ressaisir à chaque nouvel appareil,
 * alors que son nom voyage depuis toujours dans le pont d'intégration — `/api/embed/verify`
 * l'écrit dans `user_metadata.full_name`, `useAuth()` l'expose en `profile.full_name`, et
 * c'est DÉJÀ ce nom que le serveur vidéo affiche (`_clean_name`, backend/main.py). Le champ
 * existait, il n'était simplement jamais lu ici.
 *
 * ⚠️ POURQUOI ON N'ACCEPTE PAS N'IMPORTE QUEL `full_name`. `AuthContext` le remplit avec
 * `email.split('@')[0]` quand le compte n'a pas de nom. « contact.artboost » n'est pas une
 * identité : c'est une adresse tronquée. L'afficher d'office comme pseudo public devant tous
 * les participants serait PIRE que la modale qu'on cherche à supprimer. Ce repli est donc
 * écarté, et la modale reste — mais pré-remplie.
 *
 * Aucun compte créé, aucun champ de base nouveau, aucune migration : on lit ce qui est là.
 */

/** Longueur maximale d'un pseudo — la même que celle imposée par la modale. */
export const PSEUDO_MAX = 20;

/**
 * Le nom Afroboost, s'il en est vraiment un. `null` quand il n'y a rien d'utilisable :
 * champ vide, trop court, ou simple repli sur la partie locale de l'e-mail.
 */
export function nomAfroboostUtilisable(fullName?: string | null, email?: string | null): string | null {
  const nom = String(fullName || '').trim();
  if (nom.length < 2) return null;
  const local = String(email || '').split('@')[0].trim().toLowerCase();
  if (local && nom.toLowerCase() === local) return null;   // repli e-mail : pas un nom
  return nom.slice(0, PSEUDO_MAX);
}

export interface SourcesPseudo {
  /** Pseudo déjà SAISI par la personne (localStorage) — un choix humain explicite. */
  memorise?: string | null;
  /** `profile.full_name` tel qu'exposé par `useAuth()`. */
  nomProfil?: string | null;
  /** Adresse du compte, pour écarter le repli « partie locale de l'e-mail ». */
  email?: string | null;
}

export interface DecisionPseudo {
  /** Le pseudo à utiliser, ou `null` s'il faut le demander. */
  pseudo: string | null;
  /** Faut-il ouvrir la modale ? */
  demander: boolean;
  /** Valeur à pré-remplir dans la modale quand on la montre malgré tout. */
  prerempli: string;
  /** D'où vient le pseudo retenu — utile aux bancs et au journal. */
  source: 'memorise' | 'profil' | 'aucune';
}

/**
 * Décide s'il faut demander un pseudo, et lequel utiliser.
 *
 * ORDRE : le pseudo MÉMORISÉ l'emporte sur le nom du profil. Ce n'est pas un détail —
 * « Changer de pseudo » existe dans l'application ; si le nom du profil reprenait la main
 * à chaque chargement, ce bouton ne servirait plus à rien. Un pseudo mémorisé n'existe que
 * si quelqu'un l'a tapé : c'est une décision, et une décision ne s'écrase pas toute seule.
 */
export function deciderPseudo(sources: SourcesPseudo): DecisionPseudo {
  const memorise = String(sources.memorise || '').trim();
  if (memorise) return { pseudo: memorise.slice(0, PSEUDO_MAX), demander: false, prerempli: memorise.slice(0, PSEUDO_MAX), source: 'memorise' };

  const duProfil = nomAfroboostUtilisable(sources.nomProfil, sources.email);
  if (duProfil) return { pseudo: duProfil, demander: false, prerempli: duProfil, source: 'profil' };

  // Rien d'utilisable : on demande. Le champ part quand même avec le meilleur brouillon
  // connu (le repli e-mail, par exemple) — un clic plutôt qu'une saisie.
  const brouillon = String(sources.nomProfil || '').trim().slice(0, PSEUDO_MAX);
  return { pseudo: null, demander: true, prerempli: brouillon, source: 'aucune' };
}
