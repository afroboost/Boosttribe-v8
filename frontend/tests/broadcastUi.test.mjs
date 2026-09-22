/**
 * 📡 « Diffuser en direct » — UI : banc STRUCTUREL (esbuild + node --test, même style que
 * studioUi.test.mjs) + banc LOGIQUE des helpers purs du tiroir.
 *
 * Ce que Bassi a exigé :
 *  - une icône Radio dans la barre (aria-label, tooltip, fuchsia quand un direct tourne) + item ⋮ ;
 *  - le tiroir ne présélectionne AUCUN réseau ; « Démarrer le direct » est inerte sans sélection ;
 *  - statuts lisibles par réseau ; « Connecter » / « Reconnecter » discrets ;
 *  - pendant le direct : « ● EN DIRECT » + durée, état par réseau, Réessayer ISOLÉ, arrêt
 *    individuel, « Arrêter tout » derrière une confirmation ;
 *  - aucun secret (clé, jeton, URL RTMP) dans l'UI ;
 *  - partage d'écran indisponible → bouton désactivé « Indisponible sur cet appareil ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const DRAWER = lire('components', 'session', 'BroadcastDrawer.tsx');
const TYPES = lire('components', 'session', 'BroadcastTypes.ts');
const VISIO = lire('components', 'session', 'LiveVisioPanel.tsx');
const CODE = codeSeul(DRAWER);

// ── Contrat ──────────────────────────────────────────────────────────────────
test('contrat : quatre plateformes, statuts nommés, rappels du hook — rien d’autre', () => {
  for (const p of ["'instagram'", "'facebook'", "'youtube'", "'tiktok'"]) assert.ok(TYPES.includes(p), p);
  for (const s of ["'connected'", "'not_connected'", "'reauth'", "'unavailable'", "'config_required'", "'not_configured'", "'configured'", "'starting'", "'live'", "'error'", "'off'"]) assert.ok(TYPES.includes(s), s);
  for (const f of ['select:', 'start:', 'stopAll:', 'stop:', 'retry:', 'connect:', 'configure:', 'forget:', 'refresh:', 'directAutorise:']) assert.ok(TYPES.includes(f), f);
  assert.ok(!/streamKey|stream_key|rtmp_url|token|secret/i.test(codeSeul(TYPES)), 'le contrat ne transporte aucun secret');
  assert.ok(TYPES.includes('missing: string[]') && TYPES.includes('keyHint: string | null'), 'diagnostic (noms) et indice (4 car.) seulement');
});

// ── Barre / entrée ───────────────────────────────────────────────────────────
test('barre : icône Radio « Diffuser en direct », aria-label + tooltip, fuchsia quand live, item ⋮', () => {
  assert.ok(VISIO.includes("Radio } from 'lucide-react'") || /Radio\b.*from 'lucide-react'/.test(VISIO), 'icône Lucide Radio');
  assert.ok(VISIO.includes('data-testid="visio-broadcast"'), 'bouton de barre');
  assert.ok(VISIO.includes("aria-label={broadcastLive ? 'En direct — gérer la diffusion' : 'Diffuser en direct'}"), 'aria-label');
  assert.ok(VISIO.includes("title={broadcastLive ? 'En direct — gérer la diffusion' : 'Diffuser en direct'}"), 'tooltip');
  assert.ok(VISIO.includes('${broadcastLive ? ACCENT : DARK}'), 'fuchsia (ACCENT = var(--bt-accent)) quand un direct tourne');
  assert.ok(VISIO.includes('aria-pressed={broadcastOpen}'), 'état ouvert exposé');
  assert.ok(VISIO.includes("testId: 'visio-broadcast-item'"), 'item du menu ⋮');
  assert.ok(VISIO.includes('{broadcastOpen && broadcastNode}'), 'tiroir monté seulement si ouvert');
  const propsBloc = VISIO.slice(VISIO.indexOf('interface LiveVisioPanelProps'), VISIO.indexOf('type Layout'));
  for (const p of ['broadcastNode?: React.ReactNode', 'broadcastOpen?: boolean', 'broadcastLive?: boolean', 'onToggleBroadcast?: () => void', 'screenShareDisponible?: boolean']) assert.ok(propsBloc.includes(p), p);
});

test('partage d’écran indisponible : bouton désactivé avec « Indisponible sur cet appareil », caméra intacte', () => {
  assert.ok(VISIO.includes('disabled={!screenShareDisponible}'), 'désactivé');
  assert.ok(VISIO.includes("'Indisponible sur cet appareil'"), 'texte court');
  assert.ok(VISIO.includes("hidden sm:inline-flex opacity-40 cursor-not-allowed"), 'masqué sur mobile, grisé sur desktop');
  assert.ok(VISIO.includes('data-testid="visio-camera-toggle"') && VISIO.includes('data-testid="visio-camera-flip"'), 'caméra / bascule intactes');
});

// ── Tiroir ───────────────────────────────────────────────────────────────────
test('tiroir : fermé = rien ; titre et texte exacts ; quatre réseaux dans l’ordre, icônes propres, pas d’emoji', () => {
  assert.ok(DRAWER.includes('if (!open) return null;'), 'rien de rendu fermé');
  assert.ok(DRAWER.includes('Diffuser en direct</h2>'), 'titre');
  assert.ok(DRAWER.includes('Choisissez où diffuser votre Live Afroboost'), 'texte court');
  assert.ok(DRAWER.includes("const ORDRE: BroadcastPlatform[] = ['instagram', 'facebook', 'youtube', 'tiktok'];"), 'ordre');
  assert.ok(DRAWER.includes('Instagram, Facebook, Youtube, Radio') && DRAWER.includes('const TikTokIcon'), 'Lucide + glyphe TikTok en ligne');
  assert.ok(DRAWER.includes('stroke="currentColor"'), 'glyphe SVG en ligne, stroke=currentColor');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(CODE), 'aucun emoji dans le code rendu');
  assert.ok(DRAWER.includes('data-testid="broadcast-drawer"'));
});

test('aucune présélection : l’état vient du hook, l’UI n’appelle jamais select() toute seule', () => {
  // Le seul appel à select() est dans le onClick de l'interrupteur — jamais dans un effet.
  const appels = CODE.split('b.select(').length - 1;
  assert.equal(appels, 1, 'un seul site d’appel de select');
  assert.ok(CODE.includes("onClick={() => b.select(d.platform, !d.selected)}"), 'et c’est le clic sur l’interrupteur');
  assert.ok(!/useEffect\([^)]*select\(/s.test(CODE), 'aucun select() dans un effet');
});

test('interrupteur : role=switch + aria-checked, seulement pour un compte relié', () => {
  assert.ok(DRAWER.includes('role="switch"') && DRAWER.includes('aria-checked={d.selected}'));
  assert.ok(DRAWER.includes("import { libelleStatut, selectionnable, nbSelectionnes, formatDuree, actionPour, actionSecondaire, diagnosticConfig, EXPLICATION_ACCES_RESERVE, AIDE_TIKTOK_ENCODEUR, GUIDE_TIKTOK_ENCODEUR, NOTE_TIKTOK_LIVE_STUDIO } from '@/lib/broadcastUi';"), 'helpers purs importés');
  assert.ok(DRAWER.includes('{!pendantLive && selectionnable(d.status) && ('), 'rendu conditionné à selectionnable');
});

test('Démarrer le direct : désactivé sans sélection, sinon start() ; « simulation » tant que le serveur ne débloque pas', () => {
  assert.ok(DRAWER.includes('disabled={nbSelection === 0}'));
  assert.ok(DRAWER.includes('onClick={() => broadcast.start()}'));
  assert.ok(DRAWER.includes('data-testid="broadcast-start"'));
  assert.ok(DRAWER.includes("{broadcast.directAutorise ? 'Démarrer le direct' : 'Démarrer (simulation)'}"), 'libellé honnête');
  assert.ok(DRAWER.includes('data-testid="broadcast-simulation"') && DRAWER.includes('aucun direct réel n’est envoyé aux réseaux'), 'bandeau mode test');
  assert.ok(DRAWER.includes('data-broadcast-simulation={!broadcast.directAutorise}'));
});

test('Connecter / Reconnecter : VRAI parcours OAuth via b.connect() — plus de lien mort sans jeton', () => {
  assert.ok(!CODE.includes('connectUrl'), 'l’ancien lien <a href> sans jeton a disparu');
  assert.ok(!CODE.includes('target="_blank"'), 'plus de lien vers un JSON 501 dans un nouvel onglet');
  assert.ok(DRAWER.includes("{!pendantLive && action.kind === 'oauth' && ("), 'bouton OAuth seulement pour Facebook / YouTube');
  assert.ok(DRAWER.includes('await b.connect(d.platform)'), 'clic → b.connect()');
  assert.ok(DRAWER.includes('{action.libelle} <ExternalLink'), 'libellé = Connecter | Reconnecter (actionPour)');
  assert.ok(DRAWER.includes('data-testid={`broadcast-connect-${d.platform}`}'));
});

test('Configurer (Instagram / TikTok) : bouton → formulaire séparé ; Configuration requise : diagnostic, aucun bouton', () => {
  assert.ok(DRAWER.includes("{!pendantLive && (action.kind === 'configure' || action.kind === 'configured') && ("), 'Configurer / Modifier');
  assert.ok(DRAWER.includes('data-testid={`broadcast-configure-${d.platform}`}') && DRAWER.includes('aria-expanded={ouvert}'));
  assert.ok(DRAWER.includes('<BroadcastConfigForm d={d} onSave={(s) => b.configure(d.platform, s)} onForget={() => b.forget(d.platform)}'), 'formulaire câblé sur configure()/forget()');
  assert.ok(DRAWER.includes("{!pendantLive && action.kind === 'diagnostic' && ("), 'diagnostic');
  assert.ok(DRAWER.includes('data-testid={`broadcast-diagnostic-${d.platform}`}') && DRAWER.includes('diagnosticConfig(action.missing)'), 'noms des variables serveur');
  assert.ok(DRAWER.includes("import { libelleStatut, selectionnable, nbSelectionnes, formatDuree, actionPour, actionSecondaire, diagnosticConfig, EXPLICATION_ACCES_RESERVE, AIDE_TIKTOK_ENCODEUR, GUIDE_TIKTOK_ENCODEUR, NOTE_TIKTOK_LIVE_STUDIO } from '@/lib/broadcastUi';"));
  assert.ok(DRAWER.includes('data-testid="broadcast-avis"'), 'avis (retour OAuth, refus) affiché');
});

test('pendant le direct : ● EN DIRECT + durée, arrêt individuel, Réessayer isolé, Arrêter tout confirmé', () => {
  assert.ok(DRAWER.includes('data-testid="broadcast-live"') && DRAWER.includes('EN DIRECT'));
  assert.ok(DRAWER.includes('data-testid="broadcast-elapsed"') && DRAWER.includes('formatDuree(broadcast.elapsedSec)'));
  assert.ok(DRAWER.includes("onClick={() => b.stop(d.platform)}") && DRAWER.includes('data-testid={`broadcast-stop-${d.platform}`}'), 'arrêt individuel');
  assert.ok(DRAWER.includes("onClick={() => b.retry(d.platform)}") && DRAWER.includes('data-testid={`broadcast-retry-${d.platform}`}'), 'réessai');
  assert.ok(DRAWER.includes("{pendantLive && d.status === 'error' && ("), 'Réessayer seulement sur la ligne en erreur');
  assert.ok(DRAWER.includes('data-testid="broadcast-stop-all"') && DRAWER.includes('onClick={() => setConfirmerArret(true)}'), 'Arrêter tout = 1er clic → confirmation');
  assert.ok(DRAWER.includes('data-testid="broadcast-stop-all-yes"') && DRAWER.includes('broadcast.stopAll();'), '2e clic → stopAll()');
  assert.equal(CODE.split('broadcast.stopAll()').length - 1, 1, 'stopAll() appelé depuis la confirmation seulement');
});

test('aucun secret ni champ de clé dans le tiroir (la saisie vit dans BroadcastConfigForm, jamais stockée)', () => {
  assert.ok(!/stream ?key|streamKey|rtmp|token|secret|<input/i.test(CODE), 'ni clé, ni jeton, ni URL RTMP, ni champ de saisie dans le tiroir');
  const FORM = codeSeul(lire('components', 'session', 'BroadcastConfigForm.tsx'));
  assert.ok(FORM.includes("type={voir ? 'text' : 'password'}") && FORM.includes('autoComplete="new-password"'), 'clé masquée, sans autocomplétion');
  assert.ok(FORM.includes('autoComplete="off"'), 'formulaire sans autocomplétion');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|console\.(log|info|debug)/.test(FORM), 'jamais de stockage navigateur ni de journal');
  assert.ok(FORM.includes("setCle('')"), 'la clé est vidée de la mémoire après l’envoi');
  assert.ok(FORM.includes('validerUrlServeur(url)') && FORM.includes('validerCle(cle)'), 'RTMPS + clé validés avant l’envoi');
  assert.ok(FORM.includes('Supprimer la configuration') && FORM.includes('data-testid={`broadcast-config-forget-${d.platform}`}'));
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(FORM) && !/#[0-9a-fA-F]{6}\b/.test(FORM), 'ni emoji, ni hexa figé');
});

test('mobile : plein écran, réseaux en colonne, bouton principal en bas (zone sûre) ; desktop : panneau fixed borné', () => {
  const mobile = DRAWER.slice(DRAWER.indexOf('if (mobile) {'), DRAWER.indexOf('// 🖥️ Desktop'));
  assert.ok(mobile.includes('fixed inset-0') && mobile.includes('overflow-y-auto') && mobile.includes('env(safe-area-inset-bottom)'));
  const desktop = DRAWER.slice(DRAWER.indexOf('// 🖥️ Desktop'));
  assert.ok(desktop.includes('fixed z-[135]') && desktop.includes('max-h-[calc(100vh-7rem)]') && desktop.includes('w-[min(360px,calc(100vw-2rem))]'));
  assert.ok(DRAWER.includes("e.key === 'Escape'") && DRAWER.includes('data-testid="broadcast-close"'), 'Échap + ✕');
});

test('rien du studio, du prompteur, du chat ni du minuteur dans le tiroir', () => {
  assert.ok(!/Prompteur|ChatPanel|Timer\b|Interval|StudioPanel|SceneRenderer/.test(CODE));
});

// ── Helpers purs (compilés par le banc, exécutés) ─────────────────────────────
test('helpers : libellés de statut, durée, sélection', async () => {
  const { libelleStatut, formatDuree, selectionnable, nbSelectionnes } = await import('./.build/broadcastUi.mjs');
  assert.equal(formatDuree(754), '00:12:34');
  assert.equal(formatDuree(3600 * 2 + 5), '02:00:05');
  assert.equal(libelleStatut({ status: 'live', selected: true }, true), 'En direct');
  assert.equal(libelleStatut({ status: 'connected', selected: false }, true), 'Non diffusé', 'relié mais non coché pendant un direct = non diffusé');
  assert.equal(libelleStatut({ status: 'connected', selected: false }, false), 'Connecté');
  assert.equal(libelleStatut({ status: 'error', error: 'TikTok n’a pas pu démarrer', selected: true }, true), 'Échec — TikTok n’a pas pu démarrer');
  assert.equal(libelleStatut({ status: 'reauth', selected: false }, false), 'Reconnexion nécessaire');
  assert.equal(libelleStatut({ status: 'unavailable', selected: false }, false), 'Indisponible');
  assert.equal(libelleStatut({ status: 'config_required', selected: false }, false), 'Configuration requise');
  assert.equal(libelleStatut({ status: 'not_configured', selected: false }, false), 'Non configuré');
  assert.equal(libelleStatut({ status: 'configured', selected: false }, false), 'Configuré');
  assert.equal(libelleStatut({ status: 'configured', selected: false, keyHint: 'ab12' }, false), 'Configuré — clé enregistrée (…ab12)');
  assert.equal(libelleStatut({ status: 'configured', selected: false }, true), 'Non diffusé');
  assert.equal(selectionnable('connected'), true); assert.equal(selectionnable('reauth'), false);
  assert.equal(selectionnable('configured'), true); assert.equal(selectionnable('not_configured'), false); assert.equal(selectionnable('config_required'), false);
  // aucune présélection : un jeu « tout relié, rien coché » ne démarre rien
  assert.equal(nbSelectionnes([{ status: 'connected', selected: false }, { status: 'connected', selected: false }]), 0);
  // un réseau coché mais non relié ne compte pas
  assert.equal(nbSelectionnes([{ status: 'connected', selected: true }, { status: 'not_connected', selected: true }, { status: 'connected', selected: true }]), 2);
});

// ── ACCÈS RÉSERVÉ (21/09) : un 403 de liste blanche n'est plus « Indisponible », c'est la vraie raison ──
test('accès réservé : libellé, action « reserve » sans bouton, explication nommant SOCIAL_ALLOWED_EMAILS', async () => {
  const { libelleStatut, actionPour, selectionnable, EXPLICATION_ACCES_RESERVE } = await import('./.build/broadcastUi.mjs');
  const { comptesAccesReserve } = await import('./.build/broadcastLogic.mjs');
  assert.ok(TYPES.includes("'restricted'"), 'statut déclaré dans BroadcastTypes');
  assert.ok(CODE.includes("action.kind === 'reserve'"), 'le tiroir rend l’explication de l’accès réservé');
  assert.equal(libelleStatut({ status: 'restricted', selected: false }, false), 'Accès réservé');
  assert.deepEqual(actionPour({ status: 'restricted', selected: false, kind: 'oauth' }), { kind: 'reserve', libelle: 'Accès réservé' });
  assert.deepEqual(actionPour({ status: 'restricted', selected: false, kind: 'manual' }), { kind: 'reserve', libelle: 'Accès réservé' });
  assert.equal(selectionnable('restricted'), false);
  assert.match(EXPLICATION_ACCES_RESERVE, /SOCIAL_ALLOWED_EMAILS/);
  const c = comptesAccesReserve();
  assert.deepEqual(Object.keys(c).sort(), ['facebook', 'instagram', 'tiktok', 'youtube']);
  for (const p of Object.keys(c)) assert.equal(c[p].status, 'restricted', p);
  assert.equal(c.instagram.kind, 'manual'); assert.equal(c.facebook.kind, 'oauth');
});

// ── 🧪 TEST INTERNE EGRESS (21/09) : un bouton « Test interne » → fichier serveur, jamais RTMP, jamais pendant le direct ──
test('test interne egress : contrôle présent hors direct, caché en « Accès réservé », publie vidéo+audio programme avant la route QA', () => {
  assert.ok(CODE.includes("data-testid=\"broadcast-qa\""), 'bloc test interne rendu');
  assert.ok(CODE.includes("data-testid=\"broadcast-qa-start\"") && CODE.includes("data-testid=\"broadcast-qa-stop\""));
  assert.ok(CODE.includes("!broadcast.live && !!broadcast.qaFichierStart && !broadcast.destinations.some((d) => d.status === 'restricted')"), 'jamais pendant un direct, jamais pour un compte non autorisé');
  const HOOK = codeSeul(lire('hooks', 'useBroadcast.ts'));
  assert.ok(HOOK.includes("await appel('/live/broadcast/qa-fichier/start', { room: oRef.current.room })"), 'route QA fichier');
  assert.ok(HOOK.includes("if (!(await assurerProgramme())) return { ok: false, message: 'Programme indisponible.' };"), 'le Programme (vidéo + audio) est publié AVANT, comme un vrai démarrage');
  assert.ok(!/qa-fichier[^\n]*rtmp/i.test(HOOK), 'aucune URL RTMP dans le chemin QA');
  assert.ok(TYPES.includes('qaFichierStart?:') && TYPES.includes('interface QaFichierEtat'));
});

// ── FACEBOOK deux voies + TIKTOK cause exacte (21/09, mission « plus jamais bloqué par Meta App Review ») ──
test('Facebook : OAuth Meta OU repli RTMPS manuel — deux actions, jamais un « Configuration requise » muet', async () => {
  const { actionPour, actionSecondaire, libelleStatut, aideConnexion } = await import('./.build/broadcastUi.mjs');
  // Sans variables Meta mais chiffrement OK : diagnostic « Configuration Meta requise » + « Configurer manuellement »
  const sansMeta = { platform: 'facebook', status: 'config_required', selected: false, kind: 'oauth', missing: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'AFROBOOST_FB_PAGE_ID'], manualOk: true, oauthOk: false };
  assert.equal(libelleStatut(sansMeta, false), 'Configuration Meta requise');
  assert.deepEqual(actionPour(sansMeta), { kind: 'diagnostic', libelle: 'Configuration Meta requise', missing: sansMeta.missing });
  assert.deepEqual(actionSecondaire(sansMeta), { kind: 'configure', libelle: 'Configurer manuellement' });
  // Avec Meta : « Connecter avec Meta » + « Configurer manuellement »
  const avecMeta = { ...sansMeta, status: 'not_connected', missing: [], oauthOk: true };
  assert.deepEqual(actionPour(avecMeta), { kind: 'oauth', libelle: 'Connecter avec Meta' });
  assert.deepEqual(actionSecondaire(avecMeta), { kind: 'configure', libelle: 'Configurer manuellement' });
  assert.deepEqual(actionSecondaire({ ...avecMeta, status: 'reauth' }), { kind: 'configure', libelle: 'Configurer manuellement' });
  // Sans clé de chiffrement : aucun repli possible → pas de bouton mort
  assert.equal(actionSecondaire({ ...sansMeta, manualOk: false, missing: ['SOCIAL_SECRETS_KEY', ...sansMeta.missing] }), null);
  assert.equal(libelleStatut({ ...sansMeta, manualOk: false }, false), 'Configuration requise', 'sans chiffrement : diagnostic serveur générique');
  // Configuré (RTMPS manuel) : « Configuré — clé enregistrée (…) », Modifier, cochable
  const configure = { ...avecMeta, status: 'configured', keyHint: 'piJP' };
  assert.equal(libelleStatut(configure, false), 'Configuré — clé enregistrée (…piJP)');
  assert.deepEqual(actionPour(configure), { kind: 'configured', libelle: 'Modifier' });
  assert.equal(actionSecondaire(configure), null);
  // Connecté (OAuth) : rien de plus
  assert.equal(actionSecondaire({ ...avecMeta, status: 'connected' }), null);
  // YouTube : INCHANGÉ (mission) — « Connecter », jamais de repli manuel proposé
  assert.deepEqual(actionPour({ platform: 'youtube', status: 'not_connected', selected: false, kind: 'oauth', manualOk: true, oauthOk: true }), { kind: 'oauth', libelle: 'Connecter' });
  assert.equal(actionSecondaire({ platform: 'youtube', status: 'not_connected', selected: false, kind: 'oauth', manualOk: true, oauthOk: true }), null);
  // Aide du formulaire Facebook = Live Producer (pas « Connexion Facebook »)
  assert.match(aideConnexion('facebook', 'manual'), /Live Producer/);
  assert.ok(!/Connexion Facebook/.test(aideConnexion('facebook', 'manual')));
});

test('TikTok : message précis, guide numéroté, note LIVE Studio — jamais un seuil d’abonnés en dur', async () => {
  const { actionPour, actionSecondaire, libelleStatut, AIDE_TIKTOK_ENCODEUR, GUIDE_TIKTOK_ENCODEUR, NOTE_TIKTOK_LIVE_STUDIO } = await import('./.build/broadcastUi.mjs');
  const tiktok = { platform: 'tiktok', status: 'not_configured', selected: false, kind: 'manual', manualOk: true };
  // 1. état : ce que TikTok ne fournit PAS (fait prouvé), jamais une cause devinée
  assert.equal(libelleStatut(tiktok, false), 'Aucune clé de diffusion externe fournie par TikTok');
  assert.deepEqual(actionPour(tiktok), { kind: 'aide_encodeur', libelle: 'Comment faire' });
  assert.deepEqual(actionSecondaire(tiktok), { kind: 'configure', libelle: 'J’ai une clé' });
  // 2. l’aide dit POURQUOI et QUAND ce sera possible
  assert.match(AIDE_TIKTOK_ENCODEUR, /URL de serveur/i);
  assert.match(AIDE_TIKTOK_ENCODEUR, /cl[ée] de diffusion/i);
  assert.match(AIDE_TIKTOK_ENCODEUR, /d[èe]s que TikTok/i);
  assert.match(AIDE_TIKTOK_ENCODEUR, /[ée]ligibilit[ée] du compte/i, 'éligibilité : générique, décidée par TikTok');
  // 3. guide numéroté : où chercher, quoi chercher, quoi faire ensuite
  assert.ok(Array.isArray(GUIDE_TIKTOK_ENCODEUR) && GUIDE_TIKTOK_ENCODEUR.length >= 4);
  const guide = GUIDE_TIKTOK_ENCODEUR.join(' | ');
  assert.match(guide, /ordinateur/i);
  assert.match(guide, /Outils LIVE|LIVE Center|Centre LIVE/i);
  assert.match(guide, /Logiciel de streaming|Streaming software/i);
  assert.match(guide, /Server URL|URL du serveur/i);
  assert.match(guide, /Stream Key|cl[ée] de diffusion/i);
  assert.match(guide, /J’ai une clé/);
  // 4. LIVE Studio : disponible, mais il diffuse lui-même — aucune promesse de pont
  assert.match(NOTE_TIKTOK_LIVE_STUDIO, /LIVE Studio/);
  assert.match(NOTE_TIKTOK_LIVE_STUDIO, /diffuse lui-m[êe]me/i);
  assert.ok(!/Afroboost (peut|pourra) (envoyer|diffuser).{0,30}LIVE Studio/i.test(NOTE_TIKTOK_LIVE_STUDIO), 'aucun pont promis');
  // 5. JAMAIS de seuil chiffré ni de faux bouton d’activation
  const textes = [libelleStatut(tiktok, false), AIDE_TIKTOK_ENCODEUR, NOTE_TIKTOK_LIVE_STUDIO, guide].join(' ');
  assert.ok(!/1\s?000|1,000|1000 abonn/i.test(textes), 'aucun seuil d’abonnés codé en dur');
  for (const faux of ['Demander l’accès', 'Activer l’accès', 'Activer maintenant']) assert.ok(!textes.includes(faux), `aucun faux bouton « ${faux} »`);
  assert.ok(!/Acc[èe]s RTMP TikTok non activ[ée]/.test(textes), 'ancien message vague retiré');
  // Instagram : inchangé
  assert.equal(libelleStatut({ platform: 'instagram', status: 'not_configured', selected: false, kind: 'manual' }, false), 'Non configuré');
  assert.deepEqual(actionPour({ platform: 'instagram', status: 'not_configured', selected: false, kind: 'manual' }), { kind: 'configure', libelle: 'Configurer' });
  // Une vraie clé enregistrée → Configuré, Modifier, cochable (formulaire inchangé)
  assert.deepEqual(actionPour({ ...tiktok, status: 'configured', keyHint: 'ab12' }), { kind: 'configured', libelle: 'Modifier' });
  assert.equal(libelleStatut({ ...tiktok, status: 'configured', keyHint: 'ab12' }, false), 'Configuré — clé enregistrée (…ab12)');
  // Tiroir : bloc d’aide + guide + note, et bouton secondaire câblés
  assert.ok(DRAWER.includes("action.kind === 'aide_encodeur'"), 'bloc d’aide rendu');
  assert.ok(DRAWER.includes('data-testid={`broadcast-aide-${d.platform}`}'));
  assert.ok(DRAWER.includes('data-testid={`broadcast-aide-guide-${d.platform}`}'), 'guide numéroté rendu');
  assert.ok(DRAWER.includes('GUIDE_TIKTOK_ENCODEUR.map'), 'les étapes viennent du helper pur');
  assert.ok(DRAWER.includes('NOTE_TIKTOK_LIVE_STUDIO'), 'note LIVE Studio rendue');
  assert.ok(DRAWER.includes("secondaire?.kind === 'configure'"), 'bouton secondaire → formulaire');
  assert.ok(DRAWER.includes('data-testid={`broadcast-configure-secondaire-${d.platform}`}'));
});

test('état serveur : manual_ok / oauth_ok remontent jusqu’au tiroir (jamais un secret de plus)', async () => {
  const { comptesDepuisServeur, broadcastReducer, BROADCAST_INITIAL } = await import('./.build/broadcastLogic.mjs');
  const c = comptesDepuisServeur({ destinations: [
    { platform: 'facebook', status: 'config_required', kind: 'oauth', missing: ['FACEBOOK_APP_ID'], manual_ok: true, oauth_ok: false },
    { platform: 'youtube', status: 'connected', kind: 'oauth', manual_ok: true, oauth_ok: true },
    { platform: 'tiktok', status: 'not_configured', kind: 'manual' },
  ] });
  assert.equal(c.facebook.manual_ok, true); assert.equal(c.facebook.oauth_ok, false);
  assert.equal(c.tiktok.manual_ok, false, 'absent → false (jamais deviné)');
  const e = broadcastReducer(BROADCAST_INITIAL, { type: 'comptes', comptes: c });
  const fb = e.destinations.find((d) => d.platform === 'facebook');
  assert.equal(fb.manualOk, true); assert.equal(fb.oauthOk, false);
  assert.ok(!JSON.stringify(e).includes('stream_key'));
});
