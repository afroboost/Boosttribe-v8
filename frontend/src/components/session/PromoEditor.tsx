import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Loader2, Copy, Check, Image as ImageIcon, Video } from 'lucide-react';
import { getPromo, savePromo, uploadPromoMedia, type PromoConfig } from '@/lib/paymentApi';
import { useToast } from '@/components/ui/Toast';

const AFRO = { gradient: 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)', pink: '#FF2DAA' };

interface PromoEditorProps {
  sessionId: string;
  onClose: () => void;
}

/**
 * 📣 Éditeur de la PAGE PROMO d'une session (coach/hôte) :
 *  affiche/vidéo 9:16, description, CTA, lien de paiement (coach encaisse) OU gratuite, + lien partageable.
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
  const [description, setDescription] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [price, setPrice] = useState('');

  const shareUrl = `${window.location.origin}/promo/${sessionId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { promo } = await getPromo(sessionId);
      if (cancelled || !promo) { setLoading(false); return; }
      setEnabled(promo.enabled !== false);
      setMediaUrl(promo.media_url || null);
      setMediaType((promo.media_type as 'image' | 'video') || null);
      setDescription(promo.description || '');
      setCtaText(promo.cta_text || '');
      setPaymentLink(promo.payment_link || '');
      setIsPaid(!!(promo.payment_link && promo.payment_link.trim()));
      setPrice(promo.price || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { url, media_type, error } = await uploadPromoMedia(sessionId, file);
    setUploading(false);
    if (error || !url) { showToast(error || 'Upload échoué', 'error'); return; }
    setMediaUrl(url);
    setMediaType(media_type || (file.type.startsWith('video/') ? 'video' : 'image'));
    showToast('Média téléversé', 'success');
  };

  const handleSave = async () => {
    setSaving(true);
    const payload: PromoConfig & { session_id: string } = {
      session_id: sessionId,
      enabled,
      media_url: mediaUrl,
      media_type: mediaType,
      description,
      cta_text: ctaText,
      payment_link: isPaid ? paymentLink.trim() : '',
      price: isPaid ? price.trim() : '',
    };
    const { ok, error } = await savePromo(payload);
    setSaving(false);
    if (ok) showToast('Page promo enregistrée ✅', 'success');
    else showToast(error || 'Enregistrement impossible', 'error');
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { showToast(shareUrl, 'default'); }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border-2 border-[#D91CD2]/40 bg-[#15151b] p-5 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            📣 Page promo de la session
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: AFRO.pink }} /></div>
        ) : (
          <div className="space-y-4">
            {/* Média 9:16 */}
            <div>
              <label className="text-white/80 text-xs">Affiche (image) ou vidéo 9:16</label>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="w-20 rounded-lg overflow-hidden border border-white/15 bg-black flex-shrink-0" style={{ aspectRatio: '9/16' }}>
                  {mediaUrl ? (
                    mediaType === 'video'
                      ? <video src={mediaUrl} className="w-full h-full object-cover" muted />
                      : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30">
                      {mediaType === 'video' ? <Video size={18} /> : <ImageIcon size={18} />}
                    </div>
                  )}
                </div>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white border border-white/20 hover:bg-white/10 disabled:opacity-60">
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? 'Envoi…' : 'Téléverser'}
                </button>
                <input ref={fileRef} type="file" accept="image/*,video/*" onChange={handlePickFile} className="hidden" />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-white/80 text-xs">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 600))} rows={3}
                placeholder="Présente ta session…"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
            </div>

            {/* CTA + Gratuit/Payant */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setIsPaid(false)}
                className={`p-2.5 rounded-xl border text-sm font-medium ${!isPaid ? 'border-[#D91CD2] bg-[#D91CD2]/10 text-white' : 'border-white/15 text-white/60'}`}>
                Gratuite
              </button>
              <button onClick={() => setIsPaid(true)}
                className={`p-2.5 rounded-xl border text-sm font-medium ${isPaid ? 'border-[#D91CD2] bg-[#D91CD2]/10 text-white' : 'border-white/15 text-white/60'}`}>
                Payante
              </button>
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
              <input value={ctaText} onChange={(e) => setCtaText(e.target.value)}
                placeholder={isPaid ? 'Payer' : 'Rejoindre gratuitement'}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" />
            </div>

            {/* Publier */}
            <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[#D91CD2]" />
              Page publiée (visible via le lien)
            </label>

            {/* Lien partageable */}
            <div>
              <label className="text-white/80 text-xs">Lien partageable (Instagram, etc.)</label>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={shareUrl} className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-white/70 text-xs" />
                <button onClick={handleCopy} className="p-2 rounded-lg text-white border border-white/20 hover:bg-white/10" title="Copier">
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <button onClick={handleSave} disabled={saving}
              className="w-full py-2.5 rounded-xl text-white font-semibold disabled:opacity-60"
              style={{ background: AFRO.gradient }}>
              {saving ? 'Enregistrement…' : 'Enregistrer la page promo'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromoEditor;
