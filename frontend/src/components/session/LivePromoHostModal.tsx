import React, { useState } from 'react';
import { ExternalLink, Megaphone, X } from 'lucide-react';
import { actionsHote, libelleStatut, lienDecouvrir, libelleMontant } from '@/lib/livePromo';
import { promoArreter, promoDecider, promoDiffuser, promoPretSansPaiement, type PromoLigne } from '@/lib/livePromoApi';

/**
 * 📣 PROMOTIONS LIVE — la file de l'hôte (aperçu, Refuser / Accepter, Diffuser maintenant,
 * Arrêter) et l'historique compact de la session. Chaque action est revalidée par le serveur.
 */
export function LivePromoHostModal({ liste, devise, onFermer, onChange, paiementReel = true }: {
  liste: PromoLigne[]; devise: string; onFermer: () => void; onChange: () => void;
  /** false = super-admin hors commission : « Préparer sans paiement (test) » sur une demande acceptée. */
  paiementReel?: boolean;
}) {
  const [occupe, setOccupe] = useState('');
  const [erreur, setErreur] = useState('');
  const agir = async (p: PromoLigne, action: string) => {
    if (occupe) return;
    if (action === 'arreter' && !window.confirm('Arrêter la promo maintenant ?')) return;
    setOccupe(p.id); setErreur('');
    try {
      if (action === 'accepter') await promoDecider(p.id, 'accept');
      else if (action === 'refuser') await promoDecider(p.id, 'reject');
      else if (action === 'diffuser') await promoDiffuser(p.id);
      else if (action === 'arreter') await promoArreter(p.id, 'arret_hote');
      else if (action === 'tester') await promoPretSansPaiement(p.id);
      onChange();
    } catch (e) { setErreur((e as Error).message); }
    setOccupe('');
  };
  const libelle: Record<string, string> = { accepter: 'Accepter', refuser: 'Refuser', diffuser: 'Diffuser maintenant', arreter: 'Arrêter la promo', tester: 'Préparer sans paiement (test)' };
  // Super-admin hors commission : une demande ACCEPTÉE peut être préparée SANS argent (test).
  const actions = (s: string) => [...actionsHote(s), ...(!paiementReel && s === 'accepted' ? ['tester'] : [])];
  const aTraiter = liste.filter((p) => actions(p.status).length > 0);
  const historique = liste.filter((p) => actions(p.status).length === 0);
  return (
    <div className="fixed inset-0 z-[160] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={onFermer}>
      <div className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#15151b] p-4 text-white"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Promotions live" data-testid="live-promo-hote">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold"><Megaphone className="h-4 w-4 text-[var(--bt-accent)]" /> Promotions live</h2>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        {aTraiter.length === 0 ? <p className="text-sm text-white/55">Aucune promo à traiter.</p> : null}
        <ul className="space-y-3">
          {aTraiter.map((p) => (
            <li key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid={`live-promo-demande-${p.id}`}>
              <div className="flex gap-3">
                {p.media_url ? <img src={p.media_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white/55">{p.participant_name || 'Participant'} · {p.duration_seconds} s · {libelleMontant(p, devise)}</p>
                  <p className="font-semibold [overflow-wrap:anywhere]">{p.title}</p>
                  {p.body ? <p className="text-sm text-white/75 [overflow-wrap:anywhere]">{p.body}</p> : null}
                  {lienDecouvrir(p.external_url) ? (
                    <a href={lienDecouvrir(p.external_url) as string} target="_blank" rel="noopener noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--bt-accent)] [overflow-wrap:anywhere]">
                      {p.external_url} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  <p className="mt-1 text-xs text-white/60">{libelleStatut(p.status)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {actions(p.status).map((a) => (
                  <button key={a} type="button" disabled={!!occupe} onClick={() => agir(p, a)}
                          className={`min-h-[40px] rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${a === 'refuser' || a === 'arreter' ? 'border border-white/20 text-white/85' : 'text-white'}`}
                          style={a === 'refuser' || a === 'arreter' ? undefined : { background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                          data-testid={`live-promo-${a}-${p.id}`}>
                    {libelle[a]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {historique.length ? (
          <div className="mt-4">
            <p className="mb-1.5 text-xs uppercase tracking-wide text-white/45">Historique de la session</p>
            <ul className="space-y-1" data-testid="live-promo-historique">
              {historique.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-x-2 text-xs text-white/65">
                  <span className="font-semibold text-white/80">{p.participant_name || 'Participant'}</span>
                  <span>{p.duration_seconds} s · {libelleMontant(p, devise)}</span>
                  <span>· {libelleStatut(p.status)}</span>
                  {p.actual_duration_seconds != null ? <span>· diffusée {p.actual_duration_seconds} s</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {erreur ? <p className="mt-3 text-sm text-red-300" role="alert">{erreur}</p> : null}
      </div>
    </div>
  );
}

export default LivePromoHostModal;
