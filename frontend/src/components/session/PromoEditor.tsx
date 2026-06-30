import React, { useEffect, useRef, useState, useCallback } from 'react';
import RawCropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { X, Upload, Loader2, Copy, Check, Image as ImageIcon, Video, ArrowRight, Ticket, Play } from 'lucide-react';
import { getPromo, savePromo, uploadPromoMedia, claimHost, getVideoThumbnail } from '@/lib/paymentApi';
import { isHttpUrl } from '@/lib/videoEmbed';
import { useToast } from '@/components/ui/Toast';

// react-easy-crop v6 : caster pour le typage JSX (l'export par défaut perd le type valeur).
const Cropper = RawCropper as unknown as React.ComponentType<{
  image: string; crop: { x: number; y: number }; zoom: number; aspect: number; showGrid?: boolean;
  onCropChange: (c: { x: number; y: number }) => void; onZoomChange: (z: number) => void;
  onCropComplete: (a: unknown, p: { x: number; y: number; width: number; height: number }) => void;
}>;

const AFRO = { gradient: 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)', pink: '#FF2DAA' };
type Fmt = '9:16' | '16:9';
interface Area { x: number; y: number; width: number; height: number }

// Recadre l'image source à la zone choisie → blob JPEG (aspect préservé).
async function cropToBlob(src: string, crop: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.width); canvas.height = Math.round(crop.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non supporté');
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('Recadrage échoué')), 'image/jpeg', 0.9));
}

interface PromoEditorProps { sessionId: string; onClose: () => void }

/**
 * 📣 Éditeur de la PAGE PROMO (coach) : outil image type Instagram (recadrage 9:16 OU 16:9, zoom/déplacement),
 *    aperçu en direct, et enregistrement persistant (affiche/vidéo bucket + champs en base).
 */
export const PromoEditor: React.FC<PromoEditorProps> = ({ sessionId, onClose }) => {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [format, setFormat] = useState<Fmt>('9:16');
  const [description, setDescription] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [price, setPrice] = useState('');

  // Crop modal
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const cropPixelsRef = useRef<Area | null>(null);

  const shareUrl = `${window.location.origin}/promo/${sessionId}`;
  const aspect = format === '9:16' ? 9 / 16 : 16 / 9;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { promo } = await getPromo(sessionId);
      if (cancelled || !promo) { setLoading(false); return; }
      setEnabled(promo.enabled !== false);
      setMediaUrl(promo.media_url || null);
      setMediaType((promo.media_type as 'image' | 'video') || null);
      setFormat((promo.format as Fmt) || '9:16');
      setDescription(promo.description || '');
      setCtaText(promo.cta_text || '');
      setPaymentLink(promo.payment_link || '');
      setIsPaid(!!(promo.payment_link && promo.payment_link.trim()));
      setPrice(promo.price || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const doUpload = useCallback(async (file: File) => {
    setUploading(true);
    const { url, media_type, error } = await uploadPromoMedia(sessionId, file);
    setUploading(false);
    if (error || !url) { showToast(error || 'Upload échoué', 'error'); return; }
    setMediaUrl(url);
    setMediaType(media_type || (file.type.startsWith('video/') ? 'video' : 'image'));
    showToast('Média ajouté — pensez à Enregistrer', 'success');
  }, [sessionId, showToast]);

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    // 🖼️ Affiche = IMAGE uniquement (la vidéo se fait désormais par LIEN, pas d'upload serveur).
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => { setCropSrc(String(reader.result)); setCrop({ x: 0, y: 0 }); setZoom(1); };
      reader.readAsDataURL(file);
      return;
    }
    showToast('Image requise (la vidéo se renseigne par lien)', 'error');
  };

  // 🔗 Lien vidéo (IG/FB/YouTube/TikTok/Vimeo…) — http(s) uniquement. Stocke media_type='video'.
  const videoLink = mediaType === 'video' ? (mediaUrl || '') : '';
  const setVideoLink = (v: string) => {
    const t = v.trim();
    if (!t) { if (mediaType === 'video') { setMediaUrl(null); setMediaType(null); } return; }
    setMediaUrl(t); setMediaType('video');
  };
  // 🎬 Aperçu : clic sur la miniature → ouvre le lien vidéo dans un nouvel onglet (jamais d'embed).
  const openVideo = () => { if (mediaUrl && isHttpUrl(mediaUrl)) window.open(mediaUrl, '_blank', 'noopener,noreferrer'); };
  // Miniature PROPRE de la vidéo (image seule) pour l'aperçu — récupérée via le backend (og:image/oEmbed).
  const [videoThumb, setVideoThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (mediaType === 'video' && mediaUrl && isHttpUrl(mediaUrl)) {
      const t = setTimeout(async () => {
        const { thumbnail_url } = await getVideoThumbnail(mediaUrl);
        if (!cancelled) setVideoThumb(thumbnail_url);
      }, 600); // léger délai (l'admin tape l'URL)
      return () => { cancelled = true; clearTimeout(t); };
    }
    setVideoThumb(null);
    return () => { cancelled = true; };
  }, [mediaType, mediaUrl]);

  const confirmCrop = async () => {
    if (!cropSrc || !cropPixelsRef.current) return;
    try {
      const blob = await cropToBlob(cropSrc, cropPixelsRef.current);
      const file = new File([blob], `promo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCropSrc(null);
      await doUpload(file);
    } catch (err) { showToast(err instanceof Error ? err.message : 'Recadrage échoué', 'error'); }
  };

  const handleSave = async () => {
    // 🔒 Lien vidéo : http(s) uniquement (bloque javascript:/data:).
    if (mediaType === 'video' && mediaUrl && !isHttpUrl(mediaUrl)) {
      showToast('Lien vidéo invalide (http(s) requis)', 'error'); return;
    }
    setSaving(true);
    // 🔑 S'assurer que la session est « réclamée » par cet hôte (idempotent, sécurisé : ne vole jamais
    //    une session déjà détenue par un autre) → débloque l'enregistrement (host_id requis par la RLS).
    try { await claimHost(sessionId); } catch { /* ignore : savePromo renverra l'erreur d'autorisation */ }
    const { ok, error } = await savePromo({
      session_id: sessionId, enabled, media_url: mediaUrl, media_type: mediaType, format,
      description, cta_text: ctaText,
      payment_link: isPaid ? paymentLink.trim() : '', price: isPaid ? price.trim() : '',
    });
    setSaving(false);
    if (ok) showToast('Page promo enregistrée ✅', 'success');
    else showToast(error || 'Enregistrement impossible', 'error');
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { showToast(shareUrl, 'default'); }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border-2 border-[#D91CD2]/40 bg-[#15151b] p-5 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>📣 Page promo de la session</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: AFRO.pink }} /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ÉDITEUR */}
            <div className="space-y-4">
              {/* Format + upload */}
              <div>
                <label className="text-white/80 text-xs">Format de l'affiche</label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(['9:16', '16:9'] as Fmt[]).map((f) => (
                    <button key={f} onClick={() => setFormat(f)}
                      className={`p-2.5 rounded-xl border text-sm font-medium ${format === f ? 'border-[#D91CD2] bg-[#D91CD2]/10 text-white' : 'border-white/15 text-white/60'}`}>
                      {f === '9:16' ? 'Portrait 9:16' : 'Paysage 16:9'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-white border border-white/20 hover:bg-white/10 disabled:opacity-60">
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {uploading ? 'Envoi…' : 'Téléverser une affiche (image)'}
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePickFile} className="hidden" />

              {/* 🔗 Vidéo par LIEN (IG, Facebook, YouTube, TikTok, Vimeo…) — pas d'upload serveur */}
              <div>
                <label className="text-white/80 text-xs">Ou lien vidéo (Instagram, Facebook, YouTube, TikTok, Vimeo…)</label>
                <input value={videoLink} onChange={(e) => setVideoLink(e.target.value)} placeholder="https://…"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
                {videoLink && isHttpUrl(videoLink) && !videoThumb && (
                  <p className="text-white/40 text-[11px] mt-1">Miniature en cours de récupération… (vignette neutre si introuvable).</p>
                )}
              </div>

              <div>
                <label className="text-white/80 text-xs">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 600))} rows={3}
                  placeholder="Présente ta session…"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setIsPaid(false)} className={`p-2.5 rounded-xl border text-sm font-medium ${!isPaid ? 'border-[#D91CD2] bg-[#D91CD2]/10 text-white' : 'border-white/15 text-white/60'}`}>Gratuite</button>
                <button onClick={() => setIsPaid(true)} className={`p-2.5 rounded-xl border text-sm font-medium ${isPaid ? 'border-[#D91CD2] bg-[#D91CD2]/10 text-white' : 'border-white/15 text-white/60'}`}>Payante</button>
              </div>
              {isPaid && (
                <div className="space-y-2">
                  <div>
                    <label className="text-white/80 text-xs">Ton lien de paiement (Stripe / Twint / etc.)</label>
                    <input value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} placeholder="https://…"
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
                  </div>
                  <div>
                    <label className="text-white/80 text-xs">Prix affiché (ex. « 20 CHF »)</label>
                    <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="20 CHF"
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
                  </div>
                </div>
              )}
              <div>
                <label className="text-white/80 text-xs">Texte du bouton (CTA)</label>
                <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder={isPaid ? 'Payer' : 'Rejoindre gratuitement'}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
              </div>
              <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[#D91CD2]" />
                Page publiée (visible via le lien)
              </label>
              <div>
                <label className="text-white/80 text-xs">Lien partageable (Instagram, etc.)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input readOnly value={shareUrl} className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-white/70 text-xs" />
                  <button onClick={handleCopy} className="p-2 rounded-lg text-white border border-white/20 hover:bg-white/10" title="Copier">
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
              <button onClick={handleSave} disabled={saving} data-testid="promo-save"
                className="w-full py-2.5 rounded-xl text-white font-semibold disabled:opacity-60" style={{ background: AFRO.gradient }}>
                {saving ? 'Enregistrement…' : 'Enregistrer la page promo'}
              </button>
            </div>

            {/* APERÇU EN DIRECT (tel que vu par le participant) */}
            <div className="lg:border-l lg:border-white/10 lg:pl-6">
              <p className="text-white/50 text-xs mb-2 uppercase tracking-wide">Aperçu</p>
              <div className="flex flex-col items-center gap-4 rounded-2xl bg-black/40 border border-white/10 p-5">
                <div className="w-full max-w-[230px] rounded-2xl overflow-hidden border border-white/10 bg-black"
                     style={{ aspectRatio: format === '9:16' ? '9 / 16' : '16 / 9' }}>
                  {mediaUrl && mediaType === 'video' ? (
                    // Miniature PROPRE (image seule) + play — pas de carte plateforme. Clic = ouvre le lien vidéo.
                    <button type="button" onClick={openVideo} className="group relative w-full h-full block" aria-label="Voir la vidéo">
                      {videoThumb
                        ? <img src={videoThumb} alt="Aperçu vidéo" className="w-full h-full object-cover" />
                        : <div className="w-full h-full" style={{ background: AFRO.gradient }} />}
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-12 h-12 rounded-full bg-black/55 group-hover:bg-black/70 flex items-center justify-center backdrop-blur-sm transition-colors">
                          <Play className="w-6 h-6 text-white ml-0.5" fill="currentColor" />
                        </span>
                      </span>
                    </button>
                  ) : mediaUrl && mediaType === 'image' ? (
                    <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: AFRO.gradient }}><Ticket className="w-12 h-12 text-white/80" /></div>
                  )}
                </div>
                {description && <p className="text-white/85 text-center text-sm whitespace-pre-wrap max-w-[260px]">{description}</p>}
                <div className="w-full max-w-[260px] flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-white font-bold" style={{ background: AFRO.gradient }}>
                  {isPaid ? `${ctaText || 'Payer'}${price ? ` ${price}` : ''}` : (ctaText || 'Rejoindre gratuitement')}
                  <ArrowRight className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* OUTIL DE RECADRAGE (image) */}
      {cropSrc && (
        <div className="fixed inset-0 z-[160] bg-black/95 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="relative flex-1">
            <Cropper image={cropSrc} crop={crop} zoom={zoom} aspect={aspect} showGrid
              onCropChange={setCrop} onZoomChange={setZoom}
              onCropComplete={(_, px) => { cropPixelsRef.current = px; }} />
          </div>
          <div className="p-4 bg-black/90 flex items-center gap-3 flex-wrap justify-center">
            <span className="text-white/60 text-xs flex items-center gap-1">{format === '9:16' ? <ImageIcon size={14} /> : <Video size={14} />} {format}</span>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-40 accent-[#D91CD2]" />
            <button onClick={() => setCropSrc(null)} className="px-4 py-2 rounded-xl text-white/70 border border-white/20 text-sm">Annuler</button>
            <button onClick={confirmCrop} className="px-5 py-2 rounded-xl text-white font-semibold text-sm" style={{ background: AFRO.gradient }}>Valider le cadrage</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromoEditor;
