/**
 * 🔗 Normalisation d'URL média (tolérante) — pour les champs de Admin → Gestion du site.
 * Reconnaît YouTube / Vimeo / Google Drive / Dropbox / ImgBB et convertit en une source
 * utilisable (embed vidéo plein écran, ou hotlink image fiable). Les liens directs
 * (.mp4/.png/…) passent inchangés → aucune régression.
 *
 * Fonctions PURES : gèrent null/undefined/"" sans planter. Ne renvoient QUE des URLs
 * (jamais de HTML — l'appelant n'utilise jamais dangerouslySetInnerHTML).
 *
 * Cas couverts (tests) :
 *   https://ibb.co/6JyBrKzd"><img src=            → resolveImageSource → https://ibb.co/6JyBrKzd (+ aide UI)
 *   https://i.ibb.co/x82HXnW4/Design.jpg          → inchangé
 *   https://drive.google.com/file/d/1AbC.../view  → image → https://drive.google.com/thumbnail?id=1AbC...&sz=w2000
 *   https://youtu.be/dQw4w9WgXcQ                  → vidéo → embed YouTube (loop, muet, sans contrôles)
 *   https://vimeo.com/76979871                    → vidéo → player.vimeo background=1
 */

export type VideoKind = 'file' | 'youtube' | 'vimeo' | 'drive' | 'none';

export interface ResolvedVideo {
  kind: VideoKind;
  src: string;
  embed: boolean; // true → à rendre dans un <iframe> ; false → <video> direct (ou aucun)
}

/**
 * Nettoie une entrée : retire les espaces et coupe à la 1ʳᵉ occurrence de `"`, `<` ou espace
 * (fragment HTML collé par erreur, ex. `https://ibb.co/xxx"><img src=`).
 */
export function cleanUrl(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  let s = input.trim();
  const cut = s.search(/["<\s]/);
  if (cut >= 0) s = s.slice(0, cut);
  return s.trim();
}

// Extrait l'identifiant Google Drive de toutes les formes connues.
function driveId(s: string): string | null {
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=[\w-]+&)?id=|thumbnail\?id=)([\w-]+)/i);
  return m ? m[1] : null;
}

/**
 * Résout un lien VIDÉO en source jouable.
 * - fichier direct (.mp4/.webm/.mov/.ogg ou http(s) non reconnu) → <video>
 * - YouTube / Vimeo / Google Drive → <iframe> (embed:true), autoplay muet en boucle sans contrôles
 * - vide/invalide → kind 'none'
 */
export function resolveVideoSource(input?: string | null): ResolvedVideo {
  const s = cleanUrl(input);
  if (!s) return { kind: 'none', src: '', embed: false };

  // YouTube : watch?v=, youtu.be/, shorts/, embed/
  const yt = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) {
    const id = yt[1];
    // playlist=ID est REQUIS pour que loop=1 fonctionne sur une seule vidéo.
    const src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&showinfo=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&fs=0&iv_load_policy=3`;
    return { kind: 'youtube', src, embed: true };
  }

  // Vimeo : vimeo.com/ID ou player.vimeo.com/video/ID
  const vim = s.match(/(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vim) {
    const id = vim[1];
    const src = `https://player.vimeo.com/video/${id}?background=1&autoplay=1&loop=1&muted=1`;
    return { kind: 'vimeo', src, embed: true };
  }

  // Google Drive : lecture fiable en iframe /preview
  const dId = driveId(s);
  if (dId) {
    return { kind: 'drive', src: `https://drive.google.com/file/d/${dId}/preview`, embed: true };
  }

  // Fichier direct (extension vidéo connue) OU toute autre URL http(s) → <video>
  return { kind: 'file', src: s, embed: false };
}

/**
 * Résout un lien IMAGE en hotlink fiable (poster hero, favicon, carrousel, logo).
 * - Google Drive → endpoint thumbnail (affichage fiable en hotlink)
 * - Dropbox → raw=1 + dl.dropboxusercontent.com
 * - ImgBB page (ibb.co/… sans être i.ibb.co) → laissé tel quel (voir aide UI ; pas de dérivation fiable)
 * - sinon (lien direct .png/.jpg/… ou i.ibb.co/…) → renvoyé nettoyé
 */
export function resolveImageSource(input?: string | null): string {
  const s = cleanUrl(input);
  if (!s) return '';

  // Google Drive → thumbnail (fiable pour un <img>)
  const dId = driveId(s);
  if (dId) return `https://drive.google.com/thumbnail?id=${dId}&sz=w2000`;

  // Dropbox → forcer le rendu brut
  if (/dropbox\.com/i.test(s)) {
    let out = s.replace(/^https?:\/\/www\.dropbox\.com/i, 'https://dl.dropboxusercontent.com');
    if (/[?&]dl=0/i.test(out)) out = out.replace(/([?&])dl=0/i, '$1raw=1');
    else if (!/[?&]raw=1/i.test(out)) out += (out.includes('?') ? '&' : '?') + 'raw=1';
    return out;
  }

  // ImgBB page (non directe) → laissée telle quelle (l'UI conseille de coller i.ibb.co/...)
  // ainsi que tout lien direct → renvoyé nettoyé.
  return s;
}

/**
 * Vrai si l'URL est une PAGE ImgBB (ibb.co/…) et NON un lien direct i.ibb.co/… →
 * l'UI peut alors afficher un message d'aide (coller le lien direct i.ibb.co).
 */
export function isImgbbPageLink(input?: string | null): boolean {
  const s = cleanUrl(input);
  if (!s) return false;
  return /(?:^|\/\/)(?:www\.)?ibb\.co\//i.test(s) && !/i\.ibb\.co\//i.test(s);
}

/** Libellé lisible du type de vidéo détecté (indicateur admin). */
export function describeVideoSource(input?: string | null): string {
  const { kind } = resolveVideoSource(input);
  switch (kind) {
    case 'youtube': return 'YouTube détecté';
    case 'vimeo': return 'Vimeo détecté';
    case 'drive': return 'Google Drive détecté';
    case 'file': return 'Fichier vidéo direct';
    default: return '';
  }
}
