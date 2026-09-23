/**
 * 🤖 LE SOUFFLEUR — ce qui part, quand ça part, et ce qui ne part JAMAIS.
 *
 * Trois garanties tenues ici, plus une quatrième vérifiée dans les sources :
 * l'assistant PROPOSE, il n'envoie rien ; il ne coûte pas un appel par frappe ; il ne
 * transmet que le prénom affiché et la phrase ; et son panneau vit hors de la zone
 * caméra, donc hors du MP4 et des flux sociaux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  messagesPourIA, modeAutomatique, empreinteContexte, doitAppeler,
  DELAI_MIN_MS, MESSAGES_CONTEXTE,
} from './.build/assistantHote.mjs';
import { lire, codeSeul } from './lireSource.mjs';

/* ═══════════ 1. CE QUI PART : une liste BLANCHE ═══════════ */

test('seuls le prénom affiché et le texte sortent — jamais l’identifiant, l’avatar ou l’heure', () => {
  const sortie = messagesPourIA([{
    id: 'm1', name: 'Julie', text: 'Je débute, c’est pour moi ?',
    userId: 'user_1758_abc', avatarUrl: 'https://cdn/photo.jpg', ts: 1758000000, email: 'julie@example.com',
  }]);
  assert.deepEqual(sortie, [{ nom: 'Julie', texte: 'Je débute, c’est pour moi ?' }]);
  const brut = JSON.stringify(sortie);
  for (const fuite of ['user_1758_abc', 'photo.jpg', '1758000000', 'julie@example.com']) {
    assert.ok(!brut.includes(fuite), `${fuite} ne doit pas sortir`);
  }
});

test('un champ AJOUTÉ un jour au chat ne partira pas tout seul', () => {
  const sortie = messagesPourIA([{ name: 'Sam', text: 'salut', numeroDeCarte: '4111111111111111' }]);
  assert.ok(!JSON.stringify(sortie).includes('4111'), 'liste blanche, pas liste noire');
});

test('la fenêtre reste courte et les messages vides disparaissent', () => {
  const beaucoup = Array.from({ length: 40 }, (_, i) => ({ name: 'P', text: `m${i}` }));
  assert.equal(messagesPourIA(beaucoup).length, MESSAGES_CONTEXTE);
  assert.equal(messagesPourIA(beaucoup)[MESSAGES_CONTEXTE - 1].texte, 'm39', 'les DERNIERS');
  assert.deepEqual(messagesPourIA([{ name: 'P', text: '   ' }, { name: 'P' }]), []);
  assert.deepEqual(messagesPourIA(null), []);
  assert.equal(messagesPourIA([{ text: 'sans nom' }])[0].nom, 'Participant');
});

/* ═══════════ 2. DE QUOI ON PARLE ═══════════ */

test('personne à l’écran → mode chat ; quelqu’un à l’écran → mode visio', () => {
  assert.equal(modeAutomatique(null), 'chat');
  assert.equal(modeAutomatique(''), 'chat');
  assert.equal(modeAutomatique('Julie'), 'visio');
});

/* ═══════════ 3. QUAND ÇA PART : le compteur ne s’emballe pas ═══════════ */

const ETAT0 = { dernierAppelMs: 0, derniereEmpreinte: '' };
const base = (o = {}) => ({ etat: ETAT0, empreinte: 'e1', maintenant: 1_000_000, actif: true, ...o });

test('éteint, sans contexte ou déjà en vol : aucun appel', () => {
  assert.equal(doitAppeler(base({ actif: false })), false);
  assert.equal(doitAppeler(base({ actif: false, forcer: true })), false, 'éteint = éteint, même forcé');
  assert.equal(doitAppeler(base({ empreinte: '' })), false);
  assert.equal(doitAppeler(base({ enCours: true })), false);
});

test('un contexte INCHANGÉ ne déclenche pas un second appel', () => {
  const etat = { dernierAppelMs: 0, derniereEmpreinte: 'e1' };
  assert.equal(doitAppeler(base({ etat })), false);
});

test('un contexte qui change attend quand même le délai minimum', () => {
  const etat = { dernierAppelMs: 1_000_000, derniereEmpreinte: 'ancienne' };
  assert.equal(doitAppeler(base({ etat, maintenant: 1_000_000 + DELAI_MIN_MS - 1 })), false);
  assert.equal(doitAppeler(base({ etat, maintenant: 1_000_000 + DELAI_MIN_MS })), true);
});

test('« Actualiser » est un geste humain : il passe devant le délai, jamais devant l’interrupteur', () => {
  const etat = { dernierAppelMs: 1_000_000, derniereEmpreinte: 'e1' };
  assert.equal(doitAppeler(base({ etat, maintenant: 1_000_001, forcer: true })), true);
  assert.equal(doitAppeler(base({ etat, maintenant: 1_000_001, forcer: true, enCours: true })), false);
});

test('l’empreinte suit le dernier message, le mode et la personne à l’écran', () => {
  const m = [{ nom: 'Julie', texte: 'coucou' }];
  assert.notEqual(empreinteContexte('chat', m, null), empreinteContexte('visio', m, null));
  assert.notEqual(empreinteContexte('visio', m, 'Julie'), empreinteContexte('visio', m, 'Sam'));
  assert.notEqual(empreinteContexte('chat', m, null),
                  empreinteContexte('chat', [...m, { nom: 'Sam', texte: 'moi aussi' }], null));
  assert.equal(empreinteContexte('chat', m, null), empreinteContexte('chat', m, null));
});

/* ═══════════ 4. STRUCTUREL : ce que le code ne doit PAS contenir ═══════════ */

test('INSÉRER N’EST PAS ENVOYER : aucun chemin entre une suggestion et un message publié', () => {
  const panneau = codeSeul(lire('components', 'session', 'AssistantHotePanel.tsx'));
  assert.ok(panneau.includes('onInserer'), 'le panneau propose « Insérer »');
  assert.ok(!/onSend|sendMessage|handleSendGroup|broadcast/i.test(panneau),
    'le panneau ne connaît AUCUNE fonction d’envoi');
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  // Le seul effet de « Insérer » : poser un brouillon et ouvrir le chat.
  assert.ok(page.includes('onInserer={(texte) => { setBrouillonChat(texte); setChatOpen(true); setChatTab(\'group\'); }}'));
  const chat = codeSeul(lire('components', 'session', 'ChatPanel.tsx'));
  assert.ok(chat.includes('setValue(brouillon);'), 'le brouillon remplit le champ…');
  assert.ok(!/brouillon[^\n]*send\(\)/.test(chat), '…et ne déclenche jamais l’envoi');
});

test('le panneau est PRIVÉ : rendu hors de la zone caméra, et jamais diffusé', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  // Rendu à la racine de la page, pas dans `camAreaRef` (que composent le MP4 et les flux sociaux).
  const i = page.indexOf('{assistantNode}');
  assert.ok(i > page.indexOf('createPortal(chatPanelNode'), 'rendu au niveau page');
  // Aucun état de l'assistant ne part par Realtime.
  assert.ok(!/broadcast[^\n]*assistant|assistant[^\n]*broadcast/i.test(page),
    'aucune diffusion Realtime de l’assistant');
  const panneau = lire('components', 'session', 'AssistantHotePanel.tsx');
  assert.ok(/position: fixed|fixed right-4|fixed inset-x-0/.test(panneau), 'panneau flottant, hors flux vidéo');
  assert.ok(panneau.includes('partage son ÉCRAN ENTIER'),
    'la seule réserve honnête est écrite, pas cachée');
});

test('réservé à l’hôte des DEUX côtés : bouton gardé, et panneau non rendu pour un spectateur', () => {
  const visio = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
  const i = visio.indexOf('data-testid="visio-assistant"');
  assert.ok(i > 0 && /\{canManageStage && onToggleAssistant && \(/.test(visio.slice(i - 700, i)));
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('const assistantNode: React.ReactNode = canShare ?'),
    'aucun panneau monté chez un spectateur');
  // Et le serveur tranche lui-même (le test backend le prouve) : on vérifie l’appel.
  const api = codeSeul(lire('lib', 'paymentApi.ts'));
  assert.ok(api.includes('/live/assistant/suggestions') && api.includes('Authorization: `Bearer ${token}`'),
    'la route est appelée AVEC le jeton — le serveur vérifie le rôle');
});

test('éteint par défaut : aucune requête tant que le coach ne l’allume pas', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes('const [assistantActif, setAssistantActif] = useState(false)'));
  assert.ok(page.includes('if (!assistantActif || !assistantOuvert) return;'),
    'la relance automatique est gardée deux fois');
});
