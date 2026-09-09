import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Video, VideoOff, RefreshCw, SwitchCamera, FlipHorizontal2,
  Play, Pause, RotateCcw, Minus, Plus, Maximize2, Minimize2, Timer,
} from 'lucide-react';
import { Prompteur, type PrompteurHandle } from '@/components/studio/Prompteur';
import { useCameraStudio } from '@/hooks/useCameraStudio';
import { nomCamera } from '@/lib/studioLogic';
import { usePrompteur } from '@/hooks/usePrompteur';

/**
 * 🎬 StudioPage — « Vidéo face caméra » : choisir sa caméra, se voir, lire son texte.
 *
 * Surface 100 % LOCALE et volontairement isolée de la session live :
 *  - aucune room LiveKit, aucun participant, aucune publication de piste ;
 *  - aucun Go Live n'est déclenché ici, jamais ;
 *  - le script du prompteur ne quitte PAS le navigateur (aucune requête, aucun socket,
 *    aucune piste WebRTC, aucun log de contenu). Il est simplement mémorisé en
 *    `localStorage` pour être retrouvé à la prochaine visite.
 *
 * L'enregistrement vidéo n'existe pas encore dans BoostTribe (`useSessionRecorder` ne
 * capte que l'AUDIO d'une session). On livre donc caméra + aperçu + prompteur, et rien
 * de plus : pas d'infrastructure vidéo bâtie à la volée.
 */

/**
 * 🎬 StudioPage — « Vidéo face caméra » : choisir sa caméra, se voir, lire son texte.
 *
 * Le prompteur (texte, réglages, Play/Pause, décompte) vit désormais dans
 * `usePrompteur`, PARTAGÉ avec le panneau de la session Live : un seul script, une
 * seule sauvegarde, une seule logique de lecture. Cette page garde ce qui lui est
 * propre : la caméra, l'aperçu plein cadre et le Mode Focus.
 */
export const StudioPage: React.FC = () => {
  const cam = useCameraStudio();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prompteurRef = useRef<PrompteurHandle | null>(null);

  // Raccourcis clavier ACTIFS ici : cette page n'a pas de lecteur audio avec qui
  // se disputer la barre d'espace.
  const p = usePrompteur(true);
  const { script, setScript, vitesse, taille, miroir, compteurActif, enLecture, compteA } = p;

  const [focus, setFocus] = useState(false);

  // Branche le flux sur la balise <video>. `srcObject` ne peut pas passer par le JSX.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cam.stream;
    if (cam.stream) v.play().catch(() => { /* un geste sera requis, sans conséquence */ });
  }, [cam.stream]);

  const basculerLecture = p.basculerLecture;
  const reinitialiser = useCallback(() => { p.reinitialiser(); prompteurRef.current?.reset(); }, [p]);

  const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors px-3 py-2';
  const BTN_SOMBRE = `${BTN} bg-white/10 text-white/75 hover:bg-white/20`;
  const BTN_ACCENT = `${BTN} bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.35)]`;
  const ROND = 'w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 text-white/75 hover:bg-white/20 transition-colors disabled:opacity-35 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen bg-[#0b0b10] text-white" data-testid="studio-page">
      <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-5 sm:py-6">

        {/* En-tête — masqué en Mode Focus pour ne garder que l'essentiel. */}
        {!focus && (
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link to="/session" className={BTN_SOMBRE} data-testid="studio-retour">
              <ArrowLeft className="w-4 h-4" /> Retour
            </Link>
            <h1 className="text-base sm:text-lg font-semibold">Vidéo face caméra</h1>
            <button type="button" onClick={() => setFocus(true)} className={BTN_SOMBRE}
                    aria-label="Passer en mode focus" data-testid="studio-focus-on">
              <Maximize2 className="w-4 h-4" /> <span className="hidden sm:inline">Mode Focus</span>
            </button>
          </div>
        )}

        {/* ───────── Aperçu caméra + prompteur par-dessus ───────── */}
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black"
             style={{ aspectRatio: '16 / 9' }} data-testid="studio-apercu">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
            // 🪞 Le miroir est une commodité de CONFORT, purement visuelle : il n'inverse
            //    que l'aperçu local, comme dans toutes les applis vidéo. Aucun flux
            //    n'étant publié depuis cet écran, rien d'autre n'est affecté.
            style={{ transform: miroir ? 'scaleX(-1)' : undefined }}
            data-testid="studio-video"
          />

          {!cam.active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
              <VideoOff className="h-8 w-8 text-white/30" />
              {/* La phrase par défaut DIT POURQUOI on demande la caméra. « Ta caméra est
                  éteinte » ne disait ni ce qui allait se passer, ni ce qu'on peut
                  brancher — or c'est exactement le moment où Chrome demande
                  l'autorisation. Un message d'erreur réel, lui, prime toujours. */}
              <p className="text-sm text-white/60">
                {cam.error
                  || 'Autorise la caméra pour utiliser ta webcam, une caméra USB ou ton téléphone dans le Studio.'}
              </p>
              <button
                type="button"
                onClick={() => { cam.start(); cam.refresh(true); }}
                disabled={cam.starting}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                data-testid="studio-activer-camera"
              >
                {cam.starting ? 'Activation…' : 'Activer la caméra'}
              </button>
            </div>
          )}

          {/* 📜 Le texte est placé en HAUT de l'aperçu : c'est le bord le plus proche de
              l'objectif sur un portable comme sur un téléphone, donc le moins de
              mouvement des yeux. Il ne couvre jamais tout le cadre (le visage reste
              visible en bas). */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[58%] bg-gradient-to-b from-black/80 via-black/60 to-transparent" />
          <Prompteur
            ref={prompteurRef}
            texte={script}
            tailleTexte={taille}
            vitesse={vitesse}
            enLecture={enLecture}
            onFin={p.surFin}
            className="absolute inset-x-0 top-0 h-[58%] px-2 sm:px-8"
          />

          {compteA !== null && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60" data-testid="studio-compte-a-rebours">
              <span className="text-7xl font-bold text-white tabular-nums" aria-live="assertive">{compteA}</span>
            </div>
          )}

          {focus && (
            <button type="button" onClick={() => setFocus(false)}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white/80 hover:bg-black/80"
                    aria-label="Quitter le mode focus" data-testid="studio-focus-off">
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ───────── Commandes du prompteur ───────── */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3" data-testid="studio-commandes">
          <button
            type="button"
            onClick={basculerLecture}
            disabled={!script.trim()}
            className="inline-flex h-12 w-12 items-center justify-center rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: script.trim() ? 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' : '#555' }}
            aria-label={enLecture ? 'Mettre le prompteur en pause' : 'Démarrer le prompteur'}
            title={enLecture ? 'Pause (Espace)' : 'Démarrer (Espace)'}
            data-testid="studio-play"
          >
            {enLecture ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>

          <button type="button" onClick={reinitialiser} className={ROND}
                  aria-label="Revenir au début du texte" title="Revenir au début (Début)" data-testid="studio-reset">
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Vitesse */}
          <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Vitesse de défilement">
            <button type="button" className={ROND} data-testid="studio-vitesse-moins"
                    onClick={p.moinsVite}
                    disabled={vitesse <= p.bornes.vitesseMin} aria-label="Réduire la vitesse">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.2rem] text-center text-xs tabular-nums text-white/80" data-testid="studio-vitesse">
              {vitesse.toFixed(2).replace(/0$/, '')}×
            </span>
            <button type="button" className={ROND} data-testid="studio-vitesse-plus"
                    onClick={p.plusVite}
                    disabled={vitesse >= p.bornes.vitesseMax} aria-label="Augmenter la vitesse">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Taille du texte */}
          <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Taille du texte">
            <button type="button" className={ROND} data-testid="studio-taille-moins"
                    onClick={p.plusPetit}
                    disabled={taille <= p.bornes.tailleMin} aria-label="Réduire la taille du texte">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.2rem] text-center text-xs tabular-nums text-white/80" data-testid="studio-taille">{taille} px</span>
            <button type="button" className={ROND} data-testid="studio-taille-plus"
                    onClick={p.plusGrand}
                    disabled={taille >= p.bornes.tailleMax} aria-label="Augmenter la taille du texte">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ───────── Réglages + script — repliés en Mode Focus ───────── */}
        {!focus && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {cam.active ? (
                <button type="button" onClick={cam.stop} className={BTN_SOMBRE} data-testid="studio-couper-camera">
                  <VideoOff className="w-4 h-4" /> Couper la caméra
                </button>
              ) : (
                <button type="button" onClick={() => { cam.start(); cam.refresh(true); }} className={BTN_ACCENT}
                        disabled={cam.starting} data-testid="studio-activer-camera-2">
                  <Video className="w-4 h-4" /> {cam.starting ? 'Activation…' : 'Activer la caméra'}
                </button>
              )}

              <button type="button" onClick={() => p.setMiroir((m) => !m)}
                      className={miroir ? BTN_ACCENT : BTN_SOMBRE} data-testid="studio-miroir"
                      aria-pressed={miroir} title="N'inverse que ton aperçu, rien d'autre">
                <FlipHorizontal2 className="w-4 h-4" /> Miroir
              </button>

              <button type="button" onClick={() => p.setCompteurActif((c) => !c)}
                      className={compteurActif ? BTN_ACCENT : BTN_SOMBRE} data-testid="studio-compteur"
                      aria-pressed={compteurActif} title="Décompte 3-2-1 avant le défilement">
                <Timer className="w-4 h-4" /> 3-2-1
              </button>

              <button type="button" onClick={cam.flip} className={BTN_SOMBRE + ' sm:hidden'}
                      data-testid="studio-flip" aria-label="Basculer caméra avant / arrière">
                <SwitchCamera className="w-4 h-4" /> Avant / arrière
              </button>
            </div>

            {/* Choix de la caméra — libellé humain, jamais d'identifiant technique. */}
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="studio-camera" className="text-xs font-medium text-white/70">Choisir ma caméra</label>
                <button type="button" onClick={() => cam.refresh(true)}
                        className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors"
                        data-testid="studio-rafraichir">
                  <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
                </button>
              </div>
              <select
                id="studio-camera"
                value={cam.devices.some((d) => d.deviceId === cam.deviceId) ? (cam.deviceId || '') : ''}
                onChange={(e) => { if (e.target.value) cam.select(e.target.value); }}
                className="w-full cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white/85 focus:border-[rgb(var(--bt-accent-rgb)/0.5)] focus:outline-none"
                data-testid="studio-camera-select"
              >
                <option value="" className="bg-[#15151b] text-white">
                  {cam.devices.length === 0 ? 'Aucune caméra détectée — branche-la puis « Rafraîchir »' : 'Choisir une caméra…'}
                </option>
                {cam.devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-[#15151b] text-white" data-testid="studio-camera-option">
                    {nomCamera(d.label, i)}
                  </option>
                ))}
              </select>
              {cam.error && <p className="mt-1.5 text-xs text-amber-300/90" data-testid="studio-erreur">{cam.error}</p>}
            </div>

            {/* Script */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="studio-script" className="text-xs font-medium text-white/70">Script / Texte du prompteur</label>
                {script.length > 0 && (
                  <button type="button" data-testid="studio-effacer"
                          onClick={() => { if (window.confirm('Effacer tout le texte du prompteur ?')) { setScript(''); reinitialiser(); } }}
                          className="text-xs text-white/50 hover:text-white/80 transition-colors">
                    Effacer
                  </button>
                )}
              </div>
              <textarea
                id="studio-script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                placeholder="Écris ou colle ici le texte que tu veux lire face caméra…"
                className="w-full resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-[rgb(var(--bt-accent-rgb)/0.5)] focus:outline-none"
                data-testid="studio-script"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-white/40">
                Ton texte reste sur cet appareil : il n'est envoyé à personne, n'apparaît pas dans ta vidéo
                et reste invisible pour les autres participants. Raccourcis : Espace lecture/pause,
                ↑ ↓ vitesse, Début pour revenir au commencement.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StudioPage;
