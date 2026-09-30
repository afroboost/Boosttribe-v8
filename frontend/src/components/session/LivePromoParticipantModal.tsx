import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, Megaphone, X } from 'lucide-react';
import { libelleOffre, libelleStatut, peutPayer, type OffrePromo } from '@/lib/livePromo';
import { promoDemander, promoEnvoyerImage, promoPayer, type PromoLigne } from '@/lib/livePromoApi';

/**
 * 📣 « Faire ma promo » — fenêtre COMPACTE du participant.
 * 1) un tarif fixé par l'hôte ; 2) image + titre + texte + lien facultatif ; 3) envoi.
 * AUCUN paiement à l'envoi : l'hôte accepte d'abord, puis « Payer » ouvre le Checkout existant.
 */
export function LivePromoParticipantModal({ sessionId, offres, devise, mesDemandes, onFermer, onEnvoye }: {
  sessionId: string; offres: OffrePromo[]; devise: string; mesDemandes: PromoLigne[];
  onFermer: () => void; onEnvoye: () => void;
}) {
  const enCours = mesDemandes.find((p) => ['requested', 'accepted', 'payment_pending', 'payment_failed', 'ready', 'broadcasting'].includes(p.status));
  const [offre, setOffre] = useState(offres[0]?.id || '');
  const [titre, setTitre] = useState('');
  const [texte, setTexte] = useState('');
  const [lien, setLien] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const fichier = useRef<HTMLInputElement>(null);

  const choisirImage = async (f?: File | null) => {
    if (!f) return;
    setOccupe(true); setErreur('');
    try { setImage(await promoEnvoyerImage(sessionId, f)); } catch (e) { setErreur((e as Error).message); }
    setOccupe(false);
  };
  const envoyer = async () => {
    if (occupe || !offre || !titre.trim()) return;
    setOccupe(true); setErreur('');
    try {
      await promoDemander({ session_id: sessionId, offre_id: offre, titre, texte, media_url: image, lien: lien.trim() || null });
      onEnvoye();
    } catch (e) { setErreur((e as Error).message); }
    setOccupe(false);
  };
  const payer = async (id: string) => {
    if (occupe) return;
    setOccupe(true); setErreur('');
    try { window.location.href = (await promoPayer(id)).url; } catch (e) { setErreur((e as Error).message); setOccupe(false); }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={onFermer}>
      <div className="w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#15151b] p-4 text-white"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Faire ma promo" data-testid="live-promo-participant">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold"><Megaphone className="h-4 w-4 text-[var(--bt-accent)]" /> Faire ma promo</h2>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        {enCours ? (
          <div className="space-y-3" data-testid="live-promo-suivi">
            <p className="text-sm font-semibold">{enCours.title}</p>
            <p className="text-sm text-white/70" data-testid="live-promo-statut">{libelleStatut(enCours.status)}</p>
            {enCours.status === 'ready' ? <p className="text-xs text-white/55">L’hôte choisit le moment de la diffusion.</p> : null}
            {peutPayer(enCours.status) ? (
              <button type="button" onClick={() => payer(enCours.id)} disabled={occupe}
                      className="w-full min-h-[44px] rounded-xl font-semibold text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                      data-testid="live-promo-payer">
                {occupe ? 'Redirection…' : `Payer ${enCours.price_chf} ${devise}`}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <fieldset>
              <legend className="mb-1.5 text-xs text-white/70">Choisis une durée</legend>
              <div className="grid grid-cols-1 gap-2" data-testid="live-promo-offres">
                {offres.map((o) => (
                  <label key={o.id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${offre === o.id ? 'border-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.12)]' : 'border-white/15'}`}>
                    <input type="radio" name="offre-promo" checked={offre === o.id} onChange={() => setOffre(o.id)} className="accent-[var(--bt-accent)]" />
                    {libelleOffre(o, devise)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <input ref={fichier} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => choisirImage(e.target.files?.[0])} />
              <button type="button" onClick={() => fichier.current?.click()} disabled={occupe}
                      className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 text-sm text-white/80"
                      data-testid="live-promo-image-btn">
                {image ? <img src={image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <ImagePlus className="h-4 w-4" />}
                {image ? 'Changer l’image' : 'Ajouter une image'}
              </button>
            </div>
            <input value={titre} onChange={(e) => setTitre(e.target.value.slice(0, 60))} placeholder="Titre (obligatoire)"
                   className="w-full min-h-[44px] rounded-xl border border-white/15 bg-black/40 px-3 text-base" data-testid="live-promo-titre-champ" />
            <textarea value={texte} onChange={(e) => setTexte(e.target.value.slice(0, 280))} placeholder="Petit texte" rows={2}
                      className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-base" data-testid="live-promo-texte-champ" />
            <input value={lien} onChange={(e) => setLien(e.target.value.slice(0, 500))} placeholder="Lien de redirection (facultatif) https://…"
                   inputMode="url" className="w-full min-h-[44px] rounded-xl border border-white/15 bg-black/40 px-3 text-base" data-testid="live-promo-lien-champ" />
            <p className="text-xs text-white/50">Aucun paiement maintenant : l’hôte valide d’abord ta promo.</p>
            <button type="button" onClick={envoyer} disabled={occupe || !offre || !titre.trim()}
                    className="w-full min-h-[44px] rounded-xl font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                    data-testid="live-promo-envoyer">
              {occupe ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Envoyer à l’hôte'}
            </button>
          </div>
        )}
        {erreur ? <p className="mt-3 text-sm text-red-300" role="alert" data-testid="live-promo-erreur">{erreur}</p> : null}
      </div>
    </div>
  );
}

export default LivePromoParticipantModal;
