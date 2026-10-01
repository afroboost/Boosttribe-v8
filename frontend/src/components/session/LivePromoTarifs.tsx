import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { offresValides, type OffrePromo } from '@/lib/livePromo';
import { promoConfig, promoConfigHote, promoEnregistrerConfig, promoJournal, nouvelIdRequete, resumeOffres } from '@/lib/livePromoApi';

/**
 * 📣 PROMOTIONS DES PARTICIPANTS — section de la Page promo de la session.
 * Visible SEULEMENT pour un hôte en mode commission (le serveur le dit : `eligible`).
 * Aucun tarif imposé : l'hôte crée, modifie, désactive, supprime ses durées/prix.
 */
export function LivePromoTarifs({ sessionId }: { sessionId: string }) {
  const [etat, setEtat] = useState<{ eligible: boolean; enabled: boolean; offres: OffrePromo[]; currency: string; mode?: string | null; paiement_reel?: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const [occupe, setOccupe] = useState(false);
  const charge = useRef('');      // dernier état ENREGISTRÉ (sérialisé) : rien à envoyer s'il n'a pas changé
  const immediatRef = useRef(false); // ajout / suppression d'un tarif : envoi IMMÉDIAT (pas d'attente de 700 ms)
  // 01/10 — PREUVE : ce que REÇOIVENT les participants de CETTE session (lecture publique), relu
  // après chaque enregistrement. En prod, les sessions Live réelles répondaient enabled:false.
  const [vuParticipants, setVuParticipants] = useState<{ enabled: boolean; n: number } | null>(null);
  const relirePublic = () => {
    promoConfig(sessionId).then((c) => { promoJournal(sessionId, 'relecture-publique', { enabled: !!c.enabled, n: (c.offres || []).length }); setVuParticipants({ enabled: !!c.enabled, n: (c.offres || []).length }); })
      .catch((e) => { promoJournal(sessionId, 'relecture-publique:erreur', { erreur: (e as Error).message }); setVuParticipants(null); });
  };
  // Dernier état connu, pour l'enregistrement « au départ » (fermeture de la fenêtre).
  const dernier = useRef<{ etat: typeof etat; signature: string }>({ etat: null, signature: '' });
  useEffect(() => {
    let vivant = true;
    const rid = nouvelIdRequete();
    promoJournal(sessionId, 'monte', { rid });
    promoConfigHote(sessionId, rid).then((c) => {
      promoJournal(sessionId, 'host-config:ok', { rid, vivant, eligible: c.eligible, enabled: c.enabled, offres: resumeOffres(c.offres || []) });
      if (!vivant) return;
      setEtat(c);
      charge.current = JSON.stringify({ e: c.enabled, o: c.offres });
    }).catch((e) => { promoJournal(sessionId, 'host-config:erreur', { rid, erreur: (e as Error).message }); if (vivant) setEtat(null); });
    return () => { vivant = false; };
  }, [sessionId]);
  // ✅ Enregistrement AUTOMATIQUE (le 1er test réel : la case cochée n'était jamais envoyée —
  //    le bouton « Enregistrer la page promo » ne concerne pas cette section). Dépendance =
  //    une CHAÎNE (primitive) : aucune boucle d'appels ; rien n'est envoyé si rien n'a changé.
  const signature = etat && etat.eligible ? JSON.stringify({ e: etat.enabled, o: etat.offres }) : '';
  useEffect(() => {
    if (etat) promoJournal(sessionId, 'etat', { enabled: etat.enabled, offres: resumeOffres(etat.offres), deja_enregistre: signature === charge.current, refus: offresValides(etat.offres) || null, eligible: etat.eligible });
    if (!signature || signature === charge.current || !etat) return undefined;
    if (offresValides(etat.offres)) return undefined;          // saisie incomplète : on attend
    dernier.current = { etat, signature };
    const delai = immediatRef.current ? 0 : 700;
    const t = window.setTimeout(() => {
      const rid = nouvelIdRequete();
      promoJournal(sessionId, 'envoi:auto', { rid, enabled: etat.enabled, offres: resumeOffres(etat.offres) });
      promoEnregistrerConfig(sessionId, etat.enabled, etat.offres, false, rid)
        .then((r) => { promoJournal(sessionId, 'reponse:ok', { rid, offres: resumeOffres(r.offres || []) }); adopter(r.offres); dernier.current = { etat: null, signature: '' }; setMessage('Enregistré automatiquement'); relirePublic(); })
        .catch((e) => { promoJournal(sessionId, 'reponse:erreur', { rid, erreur: (e as Error).message }); setMessage(`Enregistrement du tarif impossible : ${(e as Error).message}`); });
    }, delai);
    immediatRef.current = false;
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, sessionId]);
  // Fermer la fenêtre OU quitter la page AVANT l'envoi : la modification en attente part au départ,
  // en `keepalive` (un fetch ordinaire est annulé par le navigateur à la navigation). Rien n'est
  // renvoyé si tout est déjà enregistré (sinon le tarif repartait sans id → nouvel id côté serveur).
  useEffect(() => {
    const envoyerEnAttente = () => {
      const d = dernier.current;
      if (d.etat && d.signature && d.signature !== charge.current && !offresValides(d.etat.offres)) {
        dernier.current = { etat: null, signature: '' };
        const rid = nouvelIdRequete();
        promoJournal(sessionId, 'envoi:depart', { rid, enabled: d.etat.enabled, offres: resumeOffres(d.etat.offres) });
        promoEnregistrerConfig(sessionId, d.etat.enabled, d.etat.offres, true, rid).catch(() => { /* la page est fermée */ });
      } else promoJournal(sessionId, 'depart:rien-en-attente', {});
    };
    window.addEventListener('pagehide', envoyerEnAttente);
    return () => { window.removeEventListener('pagehide', envoyerEnAttente); envoyerEnAttente(); };
  }, [sessionId]);
  useEffect(() => { relirePublic(); /* état réel au montage */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Le serveur attribue l'identifiant d'un NOUVEAU tarif : on reprend sa liste, sinon chaque
  // enregistrement recréerait un identifiant (et une demande en cours viserait un tarif disparu).
  function adopter(offres?: OffrePromo[]) {
    setEtat((prev) => {
      if (!prev) return prev;
      const suivant = { ...prev, offres: Array.isArray(offres) ? offres : prev.offres };
      charge.current = JSON.stringify({ e: suivant.enabled, o: suivant.offres });
      return suivant;
    });
  }
  if (!etat || !etat.eligible) return null;

  const maj = (i: number, patch: Partial<OffrePromo>, brut?: string) => {
    promoJournal(sessionId, 'champ', { i, champ: Object.keys(patch)[0], brut: brut ?? null, valeur: Object.values(patch)[0] as unknown as string });
    setEtat({ ...etat, offres: etat.offres.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  };
  const enregistrer = async () => {
    const refus = offresValides(etat.offres);
    if (refus) { setMessage(refus); return; }
    setOccupe(true); setMessage('');
    const rid = nouvelIdRequete();
    promoJournal(sessionId, 'envoi:manuel', { rid, enabled: etat.enabled, offres: resumeOffres(etat.offres) });
    try { const r = await promoEnregistrerConfig(sessionId, etat.enabled, etat.offres, false, rid); promoJournal(sessionId, 'reponse:ok', { rid, offres: resumeOffres(r.offres || []) }); adopter(r.offres); dernier.current = { etat: null, signature: '' }; setMessage('Enregistré'); relirePublic(); }
    catch (e) { promoJournal(sessionId, 'reponse:erreur', { rid, erreur: (e as Error).message }); setMessage(`Enregistrement du tarif impossible : ${(e as Error).message}`); }
    setOccupe(false);
  };
  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3" data-testid="live-promo-tarifs">
      <p className="text-white/80 text-xs font-semibold uppercase tracking-wide">Promotions des participants</p>
      {/* Ce que voient les participants de CETTE session, relu sur le serveur (preuve, pas une supposition). */}
      <p className="text-xs text-white/60" data-testid="live-promo-vu-participants">
        Session {sessionId} — visible des participants :{' '}
        {vuParticipants === null ? '…' : vuParticipants.enabled && vuParticipants.n > 0
          ? <b className="text-emerald-300">oui ({vuParticipants.n} tarif{vuParticipants.n > 1 ? 's' : ''})</b>
          : <b className="text-amber-300">non{vuParticipants.enabled ? ' (aucun tarif actif)' : ' (désactivée)'}</b>}
      </p>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-white">
        <input type="checkbox" checked={etat.enabled} onChange={(e) => setEtat({ ...etat, enabled: e.target.checked })}
               className="h-4 w-4 accent-[var(--bt-accent)]" data-testid="live-promo-activer" />
        Autoriser les promotions payantes pendant ce Live
      </label>
      {etat.mode === 'coach_gratuit' ? (
        /* 01/10 : Espace Coach en abonnement — promotions GRATUITES ; le payant passe par le mode commission. */
        <p className="text-xs text-white/70" data-testid="live-promo-mode-coach">
          Espace Coach : tu peux proposer des promotions gratuites. Les offres payantes nécessitent le mode commission.
        </p>
      ) : etat.paiement_reel === false ? (
        /* Super-admin hors mode commission : aucune destination d'argent n'existe (règle des billets). */
        <p className="text-xs text-amber-200/90" data-testid="live-promo-mode-test">
          Mode test super-admin : le paiement réel n’est pas disponible pour ce compte (hors mode commission).
          Tu peux tester la demande, la validation et la diffusion, sans argent.
        </p>
      ) : null}
      {etat.enabled ? (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[11px] text-white/50"><span>Durée (s)</span><span>Prix ({etat.currency})</span><span>Actif</span><span /></div>
          {/* 01/10 : chaque offre est GRATUITE ou PAYANTE (type explicite, décidé ici par l'hôte). */}
          {etat.offres.map((o, i) => (
            <div key={o.id || i} className="space-y-1.5" data-testid="live-promo-tarif">
              <div className="inline-flex rounded-lg border border-white/15 p-0.5 text-xs" role="radiogroup" aria-label="Type d'offre">
                {(['free', 'paid'] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={(o.type ?? 'paid') === t}
                          disabled={t === 'paid' && etat.paiement_reel === false}
                          onClick={() => { immediatRef.current = true; maj(i, t === 'free' ? { type: 'free' } : { type: 'paid', prix: o.prix >= 0.5 ? o.prix : 10 }, t); }}
                          className={`min-h-[32px] rounded-md px-3 font-semibold disabled:opacity-40 ${(o.type ?? 'paid') === t ? 'bg-[var(--bt-accent)] text-white' : 'text-white/65'}`}
                          data-testid={t === 'free' ? 'live-promo-type-gratuit' : 'live-promo-type-payant'}>
                    {t === 'free' ? 'Gratuit' : 'Payant'}
                  </button>
                ))}
              </div>
            <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
              <input type="number" min={5} max={3600} value={o.duree_s} onChange={(e) => maj(i, { duree_s: parseInt(e.target.value, 10) || 0 }, e.target.value)}
                     className="min-h-[40px] rounded-lg border border-white/15 bg-black/40 px-2 text-white" aria-label="Durée en secondes" />
              {o.type === 'free' ? (
                <span className="flex min-h-[40px] items-center rounded-lg border border-white/10 px-2 text-sm text-white/70" data-testid="live-promo-prix-gratuit">Gratuit</span>
              ) : (
              <input type="number" min={0.5} step={0.5} value={o.prix} onChange={(e) => maj(i, { prix: parseFloat(e.target.value) || 0 }, e.target.value)}
                     className="min-h-[40px] rounded-lg border border-white/15 bg-black/40 px-2 text-white" aria-label="Prix" />
              )}
              <input type="checkbox" checked={o.actif !== false} onChange={(e) => maj(i, { actif: e.target.checked }, String(e.target.checked))}
                     className="h-4 w-4 accent-[var(--bt-accent)]" aria-label="Tarif actif" />
              <button type="button" onClick={() => { immediatRef.current = true; setEtat({ ...etat, offres: etat.offres.filter((_, j) => j !== i) }); }}
                      className="p-2 text-white/50 hover:text-white" aria-label="Supprimer ce tarif"><Trash2 className="h-4 w-4" /></button>
            </div>
            </div>
          ))}
          <button type="button" onClick={() => { immediatRef.current = true; setEtat({ ...etat, offres: [...etat.offres, { id: '', duree_s: 30, prix: 10, actif: true, type: etat.paiement_reel === false ? 'free' : 'paid' }] }); }}
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
      {/* Jamais un succès périmé : tant que la dernière modification n'est pas confirmée par le serveur,
          on le DIT ; une saisie invalide dit pourquoi elle n'est pas envoyée. */}
      {(() => {
        const refusSaisie = etat.enabled ? offresValides(etat.offres) : '';
        const enAttente = !!signature && signature !== charge.current;
        const texte = refusSaisie ? `Non enregistré : ${refusSaisie}` : enAttente && !message.startsWith('Enregistrement du tarif impossible') ? 'Enregistrement en cours…' : message;
        return texte ? <p className="text-xs text-white/70" role="status" data-testid="live-promo-statut">{texte}</p> : null;
      })()}
    </section>
  );
}

export default LivePromoTarifs;
