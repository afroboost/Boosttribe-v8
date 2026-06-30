/**
 * Lien vidéo (Instagram, Facebook, YouTube, TikTok, Vimeo, …) → URL d'EMBED iframe quand c'est possible.
 * YouTube / Vimeo s'intègrent en iframe ; les autres (IG/FB/TikTok) bloquent souvent l'iframe → on
 * renvoie null et l'appelant affiche un bouton « Voir la vidéo » (miniature/lien).
 * 🔒 N'accepte QUE des URL http(s).
 */
export function videoEmbedUrl(raw?: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const href = url.href;
  // YouTube (watch, youtu.be, shorts, embed)
  const yt = href.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Vimeo
  const vm = href.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null; // IG / FB / TikTok / autres : pas d'embed iframe fiable
}

/** true si l'URL est http(s) valide (pour autoriser un lien « Voir la vidéo »). */
export function isHttpUrl(raw?: string | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
