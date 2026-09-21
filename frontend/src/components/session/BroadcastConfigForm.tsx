import React, { useState } from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { BroadcastDestination, BroadcastResultat, BroadcastSaisie } from '@/components/session/BroadcastTypes';
import { aideConnexion, diagnosticConfig, validerCle, validerUrlServeur } from '@/lib/broadcastUi';

/**
 * 📡 « Configurer » — mini-formulaire SÉCURISÉ Instagram / TikTok : URL du serveur RTMPS + clé de diffusion.
 *
 * Règles (Bassi, 21/09) :
 *  - la saisie vit dans l'état React le temps de l'envoi — jamais localStorage / sessionStorage, jamais un journal ;
 *  - la clé est masquée par défaut (type="password"), autocomplétion coupée, jamais ré-affichée après l'envoi ;
 *  - RTMPS uniquement : le `rtmp://` en clair est refusé AVANT même d'appeler le serveur ;
 *  - après l'enregistrement, l'appelant affiche « Configuré » (jamais « Connecté ») ;
 *  - « Supprimer la configuration » efface la clé chiffrée côté serveur.
 */
interface BroadcastConfigFormProps {
  d: BroadcastDestination;
  onSave: (saisie: BroadcastSaisie) => Promise<BroadcastResultat>;
  onForget: () => Promise<BroadcastResultat>;
  onClose: () => void;
}

export const BroadcastConfigForm: React.FC<BroadcastConfigFormProps> = ({ d, onSave, onForget, onClose }) => {
  const [url, setUrl] = useState('');
  const [cle, setCle] = useState('');
  const [voir, setVoir] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const idUrl = `broadcast-url-${d.platform}`;
  const idCle = `broadcast-key-${d.platform}`;

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    const eu = validerUrlServeur(url); if (eu) { setErreur(eu); return; }
    const ek = validerCle(cle); if (ek) { setErreur(ek); return; }
    setErreur(null); setMissing([]); setEnvoi(true);
    const r = await onSave({ url: url.trim(), cle: cle.trim() });
    setEnvoi(false);
    setCle(''); // la clé ne reste pas en mémoire une fois l'envoi terminé
    if (r.ok) { onClose(); return; }
    setErreur(r.message); setMissing(r.missing ?? []);
  };

  const supprimer = async () => {
    setEnvoi(true);
    const r = await onForget();
    setEnvoi(false);
    if (r.ok) onClose(); else setErreur(r.message);
  };

  return (
    <form onSubmit={soumettre} className="mt-2 mb-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-2" data-testid={`broadcast-config-${d.platform}`} autoComplete="off">
      <p className="text-[11px] text-white/60 leading-snug">{aideConnexion(d.platform, 'manual')}</p>
      <label htmlFor={idUrl} className="block text-[11px] text-white/70">URL du serveur (rtmps://)</label>
      <input
        id={idUrl}
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="rtmps://…/rtmp/"
        autoComplete="off"
        spellCheck={false}
        disabled={envoi}
        className="w-full h-9 rounded-lg bg-black/30 border border-white/15 px-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--bt-accent)]"
        data-testid={`broadcast-config-url-${d.platform}`}
      />
      <label htmlFor={idCle} className="block text-[11px] text-white/70">Clé de diffusion</label>
      <div className="flex items-center gap-1">
        <input
          id={idCle}
          type={voir ? 'text' : 'password'}
          value={cle}
          onChange={(e) => setCle(e.target.value)}
          placeholder={d.keyHint ? `Clé enregistrée (…${d.keyHint}) — coller la nouvelle` : 'Coller la clé'}
          autoComplete="new-password"
          spellCheck={false}
          disabled={envoi}
          className="flex-1 min-w-0 h-9 rounded-lg bg-black/30 border border-white/15 px-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--bt-accent)]"
          data-testid={`broadcast-config-key-${d.platform}`}
        />
        <button type="button" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer la clé' : 'Afficher la clé'} aria-pressed={voir} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10">
          {voir ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {erreur && (
        <p className="text-[11px] text-red-300 leading-snug" role="alert" data-testid={`broadcast-config-error-${d.platform}`}>
          {erreur}{missing.length ? ` — ${diagnosticConfig(missing)}` : ''}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={envoi} className="h-9 px-4 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold disabled:opacity-40" data-testid={`broadcast-config-save-${d.platform}`}>
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" onClick={onClose} disabled={envoi} className="h-9 px-3 rounded-full bg-white/10 text-white/80 text-sm hover:bg-white/20" data-testid={`broadcast-config-cancel-${d.platform}`}>
          Annuler
        </button>
        {d.status === 'configured' && (
          <button type="button" onClick={supprimer} disabled={envoi} className="ml-auto h-9 px-3 inline-flex items-center gap-1 rounded-full text-[11px] text-white/60 hover:text-red-200 hover:bg-red-500/20" data-testid={`broadcast-config-forget-${d.platform}`}>
            <Trash2 className="w-3.5 h-3.5" /> Supprimer la configuration
          </button>
        )}
      </div>
    </form>
  );
};

export default BroadcastConfigForm;
