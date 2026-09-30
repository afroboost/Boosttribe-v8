import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { offresValides, type OffrePromo } from '@/lib/livePromo';
import { promoConfigHote, promoEnregistrerConfig } from '@/lib/livePromoApi';

/**
 * 📣 PROMOTIONS DES PARTICIPANTS — section de la Page promo de la session.
 * Visible SEULEMENT pour un hôte en mode commission (le serveur le dit : `eligible`).
 * Aucun tarif imposé : l'hôte crée, modifie, désactive, supprime ses durées/prix.
 */
export function LivePromoTarifs({ sessionId }: { sessionId: string }) {
  const [etat, setEtat] = useState<{ eligible: boolean; enabled: boolean; offres: OffrePromo[]; currency: string; mode?: string | null; paiement_reel?: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    let vivant = true;
    promoConfigHote(sessionId).then((c) => { if (vivant) setEtat(c); }).catch(() => { if (vivant) setEtat(null); });
    return () => { vivant = false; };
  }, [sessionId]);
  if (!etat || !etat.eligible) return null;

  const maj = (i: number, patch: Partial<OffrePromo>) =>
    setEtat({ ...etat, offres: etat.offres.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const enregistrer = async () => {
    const refus = offresValides(etat.offres);
    if (refus) { setMessage(refus); return; }
    setOccupe(true); setMessage('');
    try { await promoEnregistrerConfig(sessionId, etat.enabled, etat.offres); setMessage('Enregistré'); }
    catch (e) { setMessage((e as Error).message); }
    setOccupe(false);
  };
  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3" data-testid="live-promo-tarifs">
      <p className="text-white/80 text-xs font-semibold uppercase tracking-wide">Promotions des participants</p>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-white">
        <input type="checkbox" checked={etat.enabled} onChange={(e) => setEtat({ ...etat, enabled: e.target.checked })}
               className="h-4 w-4 accent-[var(--bt-accent)]" data-testid="live-promo-activer" />
        Autoriser les promotions payantes pendant ce Live
      </label>
      {etat.paiement_reel === false ? (
        /* Super-admin hors mode commission : aucune destination d'argent n'existe (règle des billets). */
        <p className="text-xs text-amber-200/90" data-testid="live-promo-mode-test">
          Mode test super-admin : le paiement réel n’est pas disponible pour ce compte (hors mode commission).
          Tu peux tester la demande, la validation et la diffusion, sans argent.
        </p>
      ) : null}
      {etat.enabled ? (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[11px] text-white/50"><span>Durée (s)</span><span>Prix ({etat.currency})</span><span>Actif</span><span /></div>
          {etat.offres.map((o, i) => (
            <div key={o.id || i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2" data-testid="live-promo-tarif">
              <input type="number" min={5} max={3600} value={o.duree_s} onChange={(e) => maj(i, { duree_s: parseInt(e.target.value, 10) || 0 })}
                     className="min-h-[40px] rounded-lg border border-white/15 bg-black/40 px-2 text-white" aria-label="Durée en secondes" />
              <input type="number" min={0.5} step={0.5} value={o.prix} onChange={(e) => maj(i, { prix: parseFloat(e.target.value) || 0 })}
                     className="min-h-[40px] rounded-lg border border-white/15 bg-black/40 px-2 text-white" aria-label="Prix" />
              <input type="checkbox" checked={o.actif !== false} onChange={(e) => maj(i, { actif: e.target.checked })}
                     className="h-4 w-4 accent-[var(--bt-accent)]" aria-label="Tarif actif" />
              <button type="button" onClick={() => setEtat({ ...etat, offres: etat.offres.filter((_, j) => j !== i) })}
                      className="p-2 text-white/50 hover:text-white" aria-label="Supprimer ce tarif"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setEtat({ ...etat, offres: [...etat.offres, { id: '', duree_s: 30, prix: 10, actif: true }] })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-white/85"
                  data-testid="live-promo-ajouter-tarif">
            <Plus className="h-4 w-4" /> Ajouter un tarif
          </button>
        </div>
      ) : null}
      <button type="button" onClick={enregistrer} disabled={occupe}
              className="w-full min-h-[40px] rounded-xl border border-white/20 text-sm font-semibold text-white disabled:opacity-60"
              data-testid="live-promo-enregistrer">
        {occupe ? 'Enregistrement…' : 'Enregistrer les promotions'}
      </button>
      {message ? <p className="text-xs text-white/70" role="status">{message}</p> : null}
    </section>
  );
}

export default LivePromoTarifs;
