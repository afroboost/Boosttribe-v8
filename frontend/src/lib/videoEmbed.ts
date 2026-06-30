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
  // Instagram (post / reel / tv) — embed officiel
  const ig = href.match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/);
  if (ig) { const t = ig[1] === 'reels' ? 'reel' : ig[1]; return `https://www.instagram.com/${t}/${ig[2]}/embed`; }
  // TikTok (URL complète avec /video/{id}) — embed officiel v2
  const tk = href.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tk) return `https://www.tiktok.com/embed/v2/${tk[1]}`;
  // Facebook (watch / videos / fb.watch) — plugin vidéo officiel
  if (/facebook\.com\/(?:watch\/?\?v=|[^/]+\/videos\/|reel\/)|fb\.watch\//.test(href)) {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`;
  }
  return null; // autres / liens raccourcis non résolus : fallback « Voir la vidéo »
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
