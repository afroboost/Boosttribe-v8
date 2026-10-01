/**
 * 📣 useLivePromo — l'état de la promo participant d'UNE session Live.
 *
 * Source de vérité : le SERVEUR (`/live-promo/active`, `started_at` / `ends_at` + `server_now`).
 * Le canal `live-promo:<session>` (Supabase broadcast, SÉPARÉ du canal `playback:` du Live)
 * ne transporte qu'un signal « relis l'état » : aucune donnée de promo n'y circule, et il ne
 * touche jamais started / heartbeat / ended. Filet de sécurité : relecture périodique.
 * Dépendances PRIMITIVES seulement (sessionId, actif, estHote, userId) : aucune boucle d'appels.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import supabase, { isSupabaseConfigured } from '@/lib/supabaseClient';
import { decalageHorloge, enAttenteHote, type OffrePromo, type PromoPublique } from '@/lib/livePromo';
import { promoActive, promoConfig, promoListeHote, promoMesDemandes, promoArreter, type PromoLigne } from '@/lib/livePromoApi';

const RELECTURE_MS = 15000;

export interface EtatLivePromo {
  config: { eligible: boolean; enabled: boolean; offres: OffrePromo[]; currency: string; paiement_reel?: boolean; est_hote?: boolean | null } | null;
  active: PromoPublique | null;
  decalageMs: number;
  mesDemandes: PromoLigne[];
  listeHote: PromoLigne[];
  enAttente: number;
  rafraichir: () => void;
  signaler: () => void;
  arreterSiActive: (raison: string) => void;
}

export function useLivePromo(sessionId: string | undefined, actif: boolean, estHote: boolean, userId: string | undefined): EtatLivePromo {
  const [config, setConfig] = useState<EtatLivePromo['config']>(null);
  const [active, setActive] = useState<PromoPublique | null>(null);
  const [decalageMs, setDecalage] = useState(0);
  const [mesDemandes, setMesDemandes] = useState<PromoLigne[]>([]);
  const [listeHote, setListeHote] = useState<PromoLigne[]>([]);
  const canal = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const activeRef = useRef<PromoPublique | null>(null);
  activeRef.current = active;

  const rafraichir = useCallback(() => {
    if (!sessionId) return;
    const t0 = Date.now();
    promoActive(sessionId).then((r) => {
      setDecalage(decalageHorloge(r.server_now, t0));
      // Même promo, même échéance : on garde l'objet (aucun rendu, aucun effet relancé).
      setActive((prev) => (prev && r.promo && prev.id === r.promo.id && prev.ends_at === r.promo.ends_at
        && JSON.stringify(prev.layout ?? null) === JSON.stringify(r.promo.layout ?? null) ? prev : r.promo));
    }).catch(() => { /* réseau : on garde l'état, la prochaine relecture corrigera */ });
    promoConfig(sessionId).then((c) => setConfig((prev) => (prev && JSON.stringify(prev) === JSON.stringify(c) ? prev : c))).catch(() => {});
    if (estHote) promoListeHote(sessionId).then((r) => setListeHote(r.promos || [])).catch(() => {});
    else if (userId) promoMesDemandes(sessionId).then((r) => setMesDemandes(r.promos || [])).catch(() => {});
  }, [sessionId, estHote, userId]);

  // Signal « relis l'état » aux autres (après une demande, une décision, une diffusion).
  const signaler = useCallback(() => {
    try { canal.current?.send({ type: 'broadcast', event: 'PROMO', payload: {} }); } catch { /* sans effet sur le Live */ }
  }, []);

  useEffect(() => {
    if (!sessionId || !actif) return undefined;
    rafraichir();
    const minuterie = window.setInterval(rafraichir, RELECTURE_MS);
    if (supabase && isSupabaseConfigured) {
      canal.current = supabase.channel(`live-promo:${sessionId}`)
        .on('broadcast', { event: 'PROMO' }, () => rafraichir())
        .subscribe();
    }
    return () => {
      window.clearInterval(minuterie);
      if (canal.current && supabase) { try { supabase.removeChannel(canal.current); } catch { /* */ } }
      canal.current = null;
    };
  }, [sessionId, actif, rafraichir]);

  // Fin du Live par l'hôte : la promo diffusée s'arrête aussi (sans rien attendre, sans rien bloquer).
  const arreterSiActive = useCallback((raison: string) => {
    const p = activeRef.current;
    if (!estHote || !p) return;
    promoArreter(p.id, raison).then(() => { setActive(null); signaler(); }).catch(() => {});
  }, [estHote, signaler]);

  return { config, active, decalageMs, mesDemandes, listeHote, enAttente: enAttenteHote(listeHote), rafraichir, signaler, arreterSiActive };
}
