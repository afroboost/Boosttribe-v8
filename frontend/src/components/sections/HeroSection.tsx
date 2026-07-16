import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Video, FileText, ArrowRight, ChevronDown } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { useToast } from "@/components/ui/Toast";
import { sessionExists } from "@/lib/supabaseClient";
import { useReveal } from "@/hooks/useReveal";
import { useSiteSettings } from "@/hooks/useSiteSettings";

// ✅ Bénéfices honnêtes (remplacent des stats peu crédibles).
const HERO_BENEFITS = [
  { icon: Radio, label: "Sessions synchronisées en temps réel" },
  { icon: Video, label: "Live visio & chat en direct" },
  { icon: FileText, label: "Transcription IA des sessions" },
];

export const HeroSection: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { t } = useI18n();
  const { showToast } = useToast();
  const { colors, fonts, buttons } = theme;
  const revealRef = useReveal<HTMLElement>();

  // 🎬 Média de fond du hero (configurable en admin — Gestion du site).
  const { settings } = useSiteSettings();
  const heroVideo = settings.hero_video_url?.trim() || "";
  const heroPoster = settings.hero_poster_url?.trim() || "";
  const firstCarouselImage = settings.home_carousel?.find((i) => i?.url?.trim())?.url?.trim() || "";
  // Fallback (ordre) : vidéo → 1ʳᵉ image du carrousel (Ken Burns) → poster → fond sombre.
  const bgImage = firstCarouselImage || heroPoster;

  // Session code input state
  const [sessionCode, setSessionCode] = useState<string>("");
  const [isJoining, setIsJoining] = useState<boolean>(false);

  // Item 3 : dernier code de session rejoint (mémorisé en localStorage) → reprise rapide.
  // 🧹 BUG « code fantôme » : à l'ouverture, on VÉRIFIE en DB que la session existe encore.
  //    Si elle n'existe plus → on efface le code, on ne propose pas « Reprendre », on notifie.
  const [lastCode, setLastCode] = useState<string>("");
  React.useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("bt_last_session_code"); } catch { /* ignore */ }
    if (!saved) return;
    (async () => {
      const exists = await sessionExists(saved);
      if (exists === false) {
        try { localStorage.removeItem("bt_last_session_code"); } catch { /* ignore */ }
        setLastCode("");
        setSessionCode("");
        showToast("Cette session n'existe plus.", "default");
        return;
      }
      // existe (true) ou inconnu (null : Supabase non configuré / mode démo) → reprise possible
      setLastCode(saved!);
      setSessionCode(saved!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vérifie en base que la session existe AVANT d'y entrer. Si elle n'existe plus
  // (supprimée par l'hôte / code invalide) : notifier, oublier le code mémorisé, rester sur l'accueil.
  const checkAndEnter = useCallback(async (code: string) => {
    const exists = await sessionExists(code);
    if (exists === false) {
      showToast("Cette session n'existe plus ou a été supprimée par l'hôte.", "error");
      try { localStorage.removeItem("bt_last_session_code"); } catch { /* ignore */ }
      setLastCode("");
      setSessionCode("");
      setIsJoining(false);
      return;
    }
    // exists === true (existe) OU null (inconnu : Supabase non configuré / mode démo) → on passe par la
    // PAGE PROMO d'abord (affiche + CTA). Si aucune promo n'est publiée, /promo redirige vers /session.
    try { localStorage.setItem("bt_last_session_code", code); } catch { /* ignore */ }
    navigate(`/promo/${code}`);
  }, [navigate, showToast]);

  // Handle join session
  const handleJoinSession = useCallback((e: React.FormEvent) => {
    e.preventDefault();

    const trimmedCode = sessionCode.trim().toUpperCase();

    if (!trimmedCode) {
      showToast("Veuillez entrer un code de session", "error");
      return;
    }

    setIsJoining(true);
    checkAndEnter(trimmedCode);
  }, [sessionCode, showToast, checkAndEnter]);

  // Item 3 : reprendre directement la dernière session mémorisée (avec vérification d'existence)
  const handleResumeSession = useCallback(() => {
    const code = lastCode.trim().toUpperCase();
    if (!code) return;
    setIsJoining(true);
    checkAndEnter(code);
  }, [lastCode, checkAndEnter]);

  // Handle create new session
  const handleCreateSession = useCallback(() => {
    navigate("/session");
  }, [navigate]);

  // Handle input change
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Convert to uppercase and remove spaces
    const value = e.target.value.toUpperCase().replace(/\s/g, "");
    setSessionCode(value);
  }, []);

  return (
    <section
      ref={revealRef}
      className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-24"
      style={{ background: "#000000", fontFamily: fonts.body }}
    >
      {/* ===== Média de fond plein écran ===== */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {heroVideo ? (
          <video
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={heroPoster || undefined}
            key={heroVideo}
          >
            <source src={heroVideo} />
          </video>
        ) : bgImage ? (
          <div
            className="kenburns-media absolute inset-0 w-full h-full bg-center bg-cover"
            style={{ backgroundImage: `url("${bgImage}")` }}
          />
        ) : (
          // Aucun média fourni → fond sombre sobre (on ne charge rien de lourd)
          <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 0%, #1a1a1f 0%, #000000 70%)" }} />
        )}
        {/* Voile sombre pour la lisibilité (haut + bas) */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 42%, rgba(0,0,0,0.78) 100%)" }} />
      </div>

      {/* ===== Contenu superposé, centré ===== */}
      <div className="relative z-10 w-full max-w-4xl mx-auto text-center">
        <p className="eyebrow reveal mb-6" style={{ color: colors.primary }}>
          {t('hero.badge')}
        </p>

        <h1 className="font-display display-hero reveal reveal-delay-1 mb-7 text-white" style={{ textShadow: "0 2px 30px rgba(0,0,0,0.4)" }}>
          La même musique.
          <br />
          <span className="text-white/70">Au même instant.</span>
        </h1>

        <p className="reveal reveal-delay-2 mx-auto max-w-xl text-lg sm:text-xl leading-relaxed mb-12 text-white/75">
          {t('hero.subtitle')}
        </p>

        {/* Console « rejoindre / créer » — fonctionnel, verre sur média sombre */}
        <div className="reveal reveal-delay-3 mx-auto max-w-md text-left">
          <form onSubmit={handleJoinSession} className="space-y-3">
            <div className="relative">
              <Input
                type="text"
                value={sessionCode}
                onChange={handleCodeChange}
                placeholder="Code de la session (ex: MKTQUYEY-5LFJ94)"
                className="w-full h-14 px-5 text-center text-base font-mono tracking-wider rounded-2xl transition-all duration-200 placeholder:text-white/40"
                style={{
                  background: 'rgba(255,255,255,0.10)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: `1px solid ${sessionCode ? colors.primary : 'rgba(255,255,255,0.22)'}`,
                  color: '#FFFFFF',
                }}
                maxLength={20}
                disabled={isJoining}
              />
            </div>

            <PrimaryButton
              type="submit"
              size="lg"
              className="w-full h-14"
              disabled={isJoining}
            >
              {isJoining ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connexion...
                </span>
              ) : (
                buttons.joinTribe
              )}
            </PrimaryButton>
          </form>

          {/* Item 3 : Reprendre la dernière session mémorisée */}
          {lastCode && (
            <button
              onClick={handleResumeSession}
              disabled={isJoining}
              className="w-full h-12 mt-3 rounded-2xl font-medium transition-all duration-200 flex items-center justify-center gap-2 hover:bg-white/[0.14] disabled:opacity-60"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.20)',
                color: '#FFFFFF',
              }}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="truncate">Reprendre la session <span className="font-mono">{lastCode}</span></span>
            </button>
          )}

          {/* Séparateur */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" style={{ borderColor: 'rgba(255,255,255,0.18)' }} />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 uppercase tracking-widest text-white/60" style={{ background: 'transparent' }}>
                ou
              </span>
            </div>
          </div>

          {/* Créer une session */}
          <button
            onClick={handleCreateSession}
            className="group w-full h-12 rounded-2xl font-medium transition-all duration-200 flex items-center justify-center gap-2 text-white"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.35)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#000000'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; }}
          >
            {t('hero.cta.create')}
            <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </div>

        {/* Bénéfices honnêtes — ligne discrète */}
        <div className="reveal mt-16 flex flex-col sm:flex-row items-center justify-center gap-x-8 gap-y-3 text-sm text-white/55">
          {HERO_BENEFITS.map(({ icon: Icon, label }, index) => (
            <div key={index} className="flex items-center gap-2">
              <Icon size={15} className="flex-shrink-0 text-white/80" />
              <span style={{ fontFamily: fonts.body }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Indicateur de défilement (chevron discret, façon Apple) */}
      <div className="absolute bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-white/60">
        <span className="text-[11px] uppercase tracking-[0.2em]" style={{ fontFamily: fonts.body }}>
          {theme.scrollIndicator}
        </span>
        <ChevronDown size={20} className="animate-[bt-float_1.8s_ease-in-out_infinite]" />
      </div>
    </section>
  );
};

export default HeroSection;
