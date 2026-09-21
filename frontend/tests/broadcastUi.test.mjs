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
  assert.ok(DRAWER.includes("import { libelleStatut, selectionnable, nbSelectionnes, formatDuree, actionPour, diagnosticConfig, EXPLICATION_ACCES_RESERVE } from '@/lib/broadcastUi';"), 'helpers purs importés');
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
  assert.ok(DRAWER.includes("import { libelleStatut, selectionnable, nbSelectionnes, formatDuree, actionPour, diagnosticConfig, EXPLICATION_ACCES_RESERVE } from '@/lib/broadcastUi';"));
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
