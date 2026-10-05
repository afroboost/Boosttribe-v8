import React from 'react';

/**
 * 📣 05/10 — « Faire ma promo » pour un invité SANS compte (entré par « Gratuit par lien / QR ») :
 * la demande exige une identité côté serveur, donc on explique et on propose la connexion.
 * Rendu dans la zone promo de la visio ; aucune requête ici.
 */
export function PromoConnexionInvite({ onFermer, onConnexion }: { onFermer: () => void; onConnexion: () => void }) {
  return (
    <div role="dialog" aria-label="Faire ma promo" data-testid="promo-connexion"
      className="pointer-events-auto max-w-sm mx-auto rounded-2xl bg-black/85 border border-white/15 p-4 text-white space-y-3">
      <p className="text-sm">Pour publier ta promo pendant le Live, connecte-toi à ton compte (ou crée-le en 1 minute).</p>
      <div className="flex gap-2 justify-end">
        <button type="button" data-testid="promo-connexion-plus-tard" onClick={onFermer}
          className="px-3 py-1.5 rounded-lg text-sm text-white/70 hover:bg-white/10">Plus tard</button>
        <button type="button" data-testid="promo-connexion-go" onClick={onConnexion}
          className="px-3 py-1.5 rounded-lg text-sm bg-[var(--bt-accent)] text-white">Se connecter</button>
      </div>
    </div>
  );
}

export default PromoConnexionInvite;
