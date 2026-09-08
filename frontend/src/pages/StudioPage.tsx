import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Video, VideoOff, RefreshCw, SwitchCamera, FlipHorizontal2,
  Play, Pause, RotateCcw, Minus, Plus, Maximize2, Minimize2, Timer,
} from 'lucide-react';
import { Prompteur, type PrompteurHandle } from '@/components/studio/Prompteur';
import { useCameraStudio } from '@/hooks/useCameraStudio';
import {
  VITESSE_MIN, VITESSE_MAX, VITESSE_PAS, TAILLE_MIN, TAILLE_MAX, TAILLE_PAS,
  bornerVitesse, bornerTaille, nomCamera, estChampDeSaisie,
} from '@/lib/studioLogic';

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

const CLE_SCRIPT = 'bt_studio_script';
const CLE_REGLAGES = 'bt_studio_reglages';

interface Reglages { vitesse: number; taille: number; miroir: boolean; compteur: boolean }

function lireReglages(): Reglages {
  const defaut: Reglages = { vitesse: 1, taille: 44, miroir: true, compteur: true };
  try {
    const brut = localStorage.getItem(CLE_REGLAGES);
    if (!brut) return defaut;
    const r = JSON.parse(brut) as Partial<Reglages>;
    return {
      vitesse: typeof r.vitesse === 'number' ? bornerVitesse(r.vitesse) : defaut.vitesse,
      taille: typeof r.taille === 'number' ? bornerTaille(r.taille) : defaut.taille,
      miroir: typeof r.miroir === 'boolean' ? r.miroir : defaut.miroir,
      compteur: typeof r.compteur === 'boolean' ? r.compteur : defaut.compteur,
    };
  } catch { return defaut; }
}

export const StudioPage: React.FC = () => {
  const cam = useCameraStudio();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prompteurRef = useRef<PrompteurHandle | null>(null);

  const [script, setScript] = useState<string>(() => {
    try { return localStorage.getItem(CLE_SCRIPT) || ''; } catch { return ''; }
  });
  const reglagesInit = useMemo(lireReglages, []);
  const [vitesse, setVitesse] = useState(reglagesInit.vitesse);
  const [taille, setTaille] = useState(reglagesInit.taille);
  const [miroir, setMiroir] = useState(reglagesInit.miroir);
  const [compteurActif, setCompteurActif] = useState(reglagesInit.compteur);

  const [enLecture, setEnLecture] = useState(false);
  const [focus, setFocus] = useState(false);
  const [compteA, setCompteA] = useState<number | null>(null);

  // Le script reste LOCAL. Aucune écriture réseau ici, volontairement.
  useEffect(() => {
    try { localStorage.setItem(CLE_SCRIPT, script); } catch { /* quota / navigation privée */ }
  }, [script]);
  useEffect(() => {
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify({ vitesse, taille, miroir, compteur: compteurActif })); }
    catch { /* ignore */ }
  }, [vitesse, taille, miroir, compteurActif]);

  // Branche le flux sur la balise <video>. `srcObject` ne peut pas passer par le JSX.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cam.stream;
    if (cam.stream) v.play().catch(() => { /* un geste sera requis, sans conséquence */ });
  }, [cam.stream]);

  const demarrerLecture = useCallback(() => {
    if (!script.trim()) return;
    if (compteurActif) {
      setCompteA(3);
      return;                       // le décompte lancera la lecture
    }
    setEnLecture(true);
  }, [script, compteurActif]);

  const basculerLecture = useCallback(() => {
    if (compteA !== null) return;   // décompte en cours : on ne double-déclenche pas
    if (enLecture) setEnLecture(false);
    else demarrerLecture();
  }, [enLecture, compteA, demarrerLecture]);

  const reinitialiser = useCallback(() => {
    setEnLecture(false);
    setCompteA(null);
    prompteurRef.current?.reset();
  }, []);

  // ⏱️ Décompte 3-2-1 — il ne démarre QUE le prompteur. Jamais un Live, jamais un
  //    enregistrement : rien d'autre n'est déclenché depuis cet écran.
  useEffect(() => {
    if (compteA === null) return;
    if (compteA === 0) { setCompteA(null); setEnLecture(true); return; }
    const id = window.setTimeout(() => setCompteA((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [compteA]);

  // ⌨️ Raccourcis — inertes dès que l'utilisateur écrit dans un champ, sinon Espace
  //    insérerait une espace dans le script au lieu de mettre en pause.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const c = e.target as HTMLElement | null;
      if (estChampDeSaisie(c?.tagName, !!c?.isContentEditable)) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); basculerLecture(); }
      else if (e.key === 'ArrowUp' || e.key === '+') { e.preventDefault(); setVitesse((v) => bornerVitesse(v + VITESSE_PAS)); }
      else if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); setVitesse((v) => bornerVitesse(v - VITESSE_PAS)); }
      else if (e.key === 'Home') { e.preventDefault(); reinitialiser(); }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [basculerLecture, reinitialiser]);

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
              <p className="text-sm text-white/60">{cam.error || 'Ta caméra est éteinte.'}</p>
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
            onFin={() => setEnLecture(false)}
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
                    onClick={() => setVitesse((v) => bornerVitesse(v - VITESSE_PAS))}
                    disabled={vitesse <= VITESSE_MIN} aria-label="Réduire la vitesse">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.2rem] text-center text-xs tabular-nums text-white/80" data-testid="studio-vitesse">
              {vitesse.toFixed(2).replace(/0$/, '')}×
            </span>
            <button type="button" className={ROND} data-testid="studio-vitesse-plus"
                    onClick={() => setVitesse((v) => bornerVitesse(v + VITESSE_PAS))}
                    disabled={vitesse >= VITESSE_MAX} aria-label="Augmenter la vitesse">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Taille du texte */}
          <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Taille du texte">
            <button type="button" className={ROND} data-testid="studio-taille-moins"
                    onClick={() => setTaille((t) => bornerTaille(t - TAILLE_PAS))}
                    disabled={taille <= TAILLE_MIN} aria-label="Réduire la taille du texte">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.2rem] text-center text-xs tabular-nums text-white/80" data-testid="studio-taille">{taille} px</span>
            <button type="button" className={ROND} data-testid="studio-taille-plus"
                    onClick={() => setTaille((t) => bornerTaille(t + TAILLE_PAS))}
                    disabled={taille >= TAILLE_MAX} aria-label="Augmenter la taille du texte">
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

              <button type="button" onClick={() => setMiroir((m) => !m)}
                      className={miroir ? BTN_ACCENT : BTN_SOMBRE} data-testid="studio-miroir"
                      aria-pressed={miroir} title="N'inverse que ton aperçu, rien d'autre">
                <FlipHorizontal2 className="w-4 h-4" /> Miroir
              </button>

              <button type="button" onClick={() => setCompteurActif((c) => !c)}
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
