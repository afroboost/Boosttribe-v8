/**
 * 🧠 Connaissances de l'assistant BoostTribe — SOURCE UNIQUE (utilisée par AssistantChat).
 * Moteur à mots-clés, réponses fixes ; prix Coach et essai lus dans la configuration.
 */
import type { CreditsConfig } from '@/lib/paymentApi';

// 🧠 Connaissances de l'assistant BoostTribe — système de CRÉDITS (1 crédit = 1 accès à un live).
// Les textes "crédits/tarifs" sont enrichis dynamiquement depuis la config admin (getCreditsConfig).
export const BOT_RESPONSES: Record<string, string[]> = {
  default: [
    "Bonjour ! Je suis l'assistant BoostTribe 👋 Je peux vous parler des sessions synchronisées, du Live Visio, du chat en direct, du micro, de l'enregistrement + transcription IA, des modes de session (ouverte / payante / privée), de l'Espace Coach et des crédits.",
    "BoostTribe permet d'animer des lives où tout le monde écoute/regarde la même chose, parfaitement synchronisé, avec visio, chat et transcription IA. Posez-moi votre question !",
  ],
  session: [
    "Pour créer une session : cliquez sur « Créer ma session ». Vous partagez ensuite un lien ou un QR code, et vos participants rejoignent en un clic — audio ET vidéo restent synchronisés pour tout le monde.",
    "Dans une session, l'hôte contrôle la lecture pour tous : musique, vidéo uploadée ou lien YouTube/Vimeo, tout est synchronisé au même instant. Trois modes d'accès : Ouverte (crédits), Payante (billet CHF) ou Privée (lien/QR).",
  ],
  modes: [
    "Trois modes d'accès au choix de l'hôte : 🟢 Ouverte — le public dépense 1 crédit pour rejoindre ; 💳 Payante — billet en CHF (réservée aux coachs en mode commission) ; 🔒 Privée — accès gratuit sur invitation via lien/QR, avec salle d'attente.",
  ],
  video: [
    "BoostTribe synchronise aussi la VIDÉO : partagez une vidéo uploadée ou un lien YouTube/Vimeo, et tous les participants la voient au même instant (l'hôte pilote play/pause/seek).",
  ],
  visio: [
    "Le Live Visio, c'est la visio façon Zoom DANS la session : activez votre caméra et voyez les autres en direct, tout en gardant la vidéo partagée. Scène jusqu'à 10 intervenants, « lever la main » pour demander à monter, spotlight pour épingler une caméra, et partage d'écran. Le lecteur est même déplaçable. 🎥",
  ],
  voice: [
    "Côté voix : prenez le micro pour guider votre audience, parlez à tout le groupe ou en privé à un ou plusieurs participants choisis. Chaque participant peut aussi régler le volume des autres.",
  ],
  record: [
    "L'ENREGISTREMENT pendant le Live est un outil de l'ESPACE COACH : seul l'hôte d'un Live hébergé par un Espace Coach peut le lancer. Il enregistre la vidéo de la scène diffusée avec le son du programme (fichier à télécharger en fin de séance). En option, l'enregistrement de toutes les voix + la musique donne une TRANSCRIPTION IA en français et un résumé / notes de cours, téléchargeables dans l'Espace Coach ; un avis de consentement prévient les participants. Cette option coûte quelques crédits (réglable par l'admin), sauf en accès illimité.",
  ],
  prompteur: [
    "Le PROMPTEUR est un outil de l'ESPACE COACH : l'hôte d'un Live Coach affiche son texte directement pendant le Live et le fait défiler pendant qu'il présente (vitesse réglable, sur mobile comme sur ordinateur), sans quitter son écran de diffusion. L'assistant peut l'aider à rédiger ou retoucher ce texte. Un participant, ou l'hôte d'un Live qui n'est pas Coach, n'a pas le Prompteur : il faut un Espace Coach (page Tarifs → « Devenir Coach »).",
  ],
  chat: [
    "Un CHAT en direct accompagne chaque session : messages au groupe, échanges privés et assistant intégré. Likes, commentaires, photos de profil et partage de vidéo/image/lien complètent l'expérience de groupe. 💬",
  ],
  // `coach` : construit par buildCoachText (prix et essai lus dans la configuration, jamais en dur).
  private: [
    "Les sessions privées ont une SALLE D'ATTENTE : même si le lien fuite, l'hôte admet (ou refuse) chaque participant manuellement. Parfait pour réserver tes lives à tes invités.",
  ],
  lang: [
    "L'application est multilingue : Français, Anglais et Allemand (bouton globe 🌐). Le français est la langue par défaut.",
  ],
  access: [
    "Rejoindre une session est ultra simple : un lien ou un QR code, aucune application à installer, compatible tous appareils (et installable en PWA).",
  ],
  // 01/10 — PROMOTIONS DES PARTICIPANTS (règles réelles, appliquées par le serveur).
  promo: [
    "PROMOTIONS DES PARTICIPANTS : dans un Live hébergé par un Espace Coach, l'hôte peut autoriser les promotions et créer des offres (durée + Gratuit ou Payant). En tant que PARTICIPANT, tu ouvres le menu ⋮ → « Faire ma promo », tu choisis une offre, tu remplis ta promo et tu l'envoies. L'hôte accepte ou refuse, puis c'est lui qui choisit quand la diffuser (« Diffuser maintenant ») ; il peut aussi la déplacer et la redimensionner pendant le Live. Tu n'as PAS besoin d'être coach pour proposer ta promo : cela dépend du Live — il faut que l'hôte ait activé les promotions.",
  ],
  promoGratuite: [
    "Oui, une promo peut être GRATUITE si l'hôte a créé une offre « Gratuit » : tu envoies ta demande, l'hôte l'accepte, et elle est directement prête — aucun paiement, aucune étape Stripe. L'hôte choisit ensuite quand la diffuser.",
  ],
  promoPayante: [
    "Pour une promo PAYANTE, tu ne paies JAMAIS à l'envoi : tu envoies d'abord ta demande, l'hôte l'accepte, et seulement ensuite le bouton « Payer » apparaît (paiement sécurisé). Une fois le paiement confirmé, la promo est prête et l'hôte choisit quand la diffuser. Si l'hôte refuse, tu ne paies rien.",
  ],
  promoCoach: [
    "Oui : même si tu as ton propre Espace Coach, tu peux faire ta promo dans le Live d'un AUTRE coach — dans ce Live, tu es participant. Il faut simplement que l'hôte ait activé les promotions des participants. Ton Espace Coach ne te donne aucun droit de gestion sur son Live (ni ses tarifs, ni ses demandes, ni ses paiements) ; si ta promo est payante, l'argent va à l'hôte du Live.",
  ],
  help: [
    "Je peux vous expliquer : les crédits (1er cours offert), les sessions synchronisées, le Live Visio (scène jusqu'à 10, lever la main, spotlight, partage d'écran), le chat en direct, le micro & la voix privée, le Prompteur, l'enregistrement + transcription IA, les promotions des participants (gratuites ou payantes), les modes de session (ouverte/payante/privée), l'Espace Coach et les langues. Que voulez-vous savoir ?",
  ],
};

// Texte « crédits » par défaut (si la config admin n'est pas encore chargée).
const CREDITS_FALLBACK =
  "BoostTribe fonctionne avec des CRÉDITS (en CHF), sans abonnement : 1 crédit = 1 accès à un live. " +
  "Vous dépensez 1 crédit pour rejoindre un live, et l'animateur dépense 1 crédit pour l'héberger. " +
  "Votre 1er cours est offert à l'inscription, et les crédits achetés sont valables 12 mois. " +
  "Achetez des packs depuis la page Tarifs.";

// Espace Coach — prix (configuration billetterie, comme /pricing) et essai (configuration crédits).
export function buildCoachText(prixCoach: number | null, essaiJours: number | null | undefined): string {
  const prix = prixCoach && prixCoach > 0 ? `${prixCoach.toFixed(2)} CHF/mois` : 'voir la page Tarifs';
  const essai = essaiJours && essaiJours > 0 ? ` Essai de ${essaiJours} jours, sans engagement.` : '';
  return `Espace Coach : deviens coach pour animer tes propres Lives avec les outils avancés — Prompteur, Enregistrement du Live + transcription IA, Promotions des participants (gratuites ou payantes), Live Visio avancé et diffusion vers les réseaux sociaux. L'Abonnement Illimité (${prix}) te donne des crédits illimités et 0% de commission — tu encaisses tes élèves toi-même via ton lien/QR privé.${essai} Sur demande, l'admin peut te passer en mode commission (billets payants en CHF encaissés via la plateforme, virements par IBAN). Rends-toi sur la page Tarifs → « Devenir Coach ».`;
}

// Construit la réponse « crédits » à partir de la config admin (dynamique).
export function buildCreditsText(cfg: CreditsConfig | null): string {
  if (!cfg) return CREDITS_FALLBACK;
  const parts: string[] = [];
  parts.push("BoostTribe fonctionne avec des CRÉDITS, sans abonnement : 1 crédit = 1 accès à un live.");
  parts.push(`Rejoindre un live coûte ${cfg.cost_join} crédit(s) ; l'animer coûte ${cfg.cost_host} crédit(s).`);
  if (cfg.signup_free_credits > 0) parts.push(`Votre 1er cours est offert (${cfg.signup_free_credits} crédit(s) à l'inscription).`);
  parts.push(`Les crédits achetés sont valables ${cfg.credit_validity_months} mois.`);
  if (cfg.packs && cfg.packs.length) {
    const list = cfg.packs.slice(0, 4).map((p) => `${p.name} (${p.credits} cr. — ${Number(p.price_chf).toFixed(0)} CHF)`).join(', ');
    parts.push(`Packs disponibles : ${list}.`);
  }
  const activeOffers = Object.values(cfg.offers || {}).filter((o: any) => o && o.enabled).map((o: any) => o.title);
  if (activeOffers.length) parts.push(`Offres en cours : ${activeOffers.join(', ')}.`);
  return parts.join(' ');
}

// Détection par mots-clés (français)
export function getBotResponse(userMessage: string, cfg: CreditsConfig | null, prixCoach: number | null = null): string {
  const msg = userMessage.toLowerCase();
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  // 01/10 — PROMO d'abord : « je suis coach, puis-je faire ma promo ? » parle de PROMO, pas d'abonnement.
  if (msg.includes('promo')) {
    if (msg.includes('coach')) return BOT_RESPONSES.promoCoach[0];
    if (msg.includes('gratuit') || msg.includes('free')) return BOT_RESPONSES.promoGratuite[0];
    if (msg.includes('pai') || msg.includes('pay') || msg.includes('payant') || msg.includes('stripe') || msg.includes('quand')) return BOT_RESPONSES.promoPayante[0];
    return BOT_RESPONSES.promo[0];
  }
  if (msg.includes('prompteur') || msg.includes('téléprompteur') || msg.includes('teleprompteur') || msg.includes('prompter')) return BOT_RESPONSES.prompteur[0];
  if (msg.includes('enregistr') || msg.includes('record') || msg.includes('transcri')) return BOT_RESPONSES.record[0];

  // Coach / abonnement : prioritaire sur « crédits » pour bien orienter vers l'Espace Coach.
  if (msg.includes('coach') || msg.includes('abonn') || msg.includes('illimité') || msg.includes('illimite') ||
      msg.includes('commission') || msg.includes('animateur') || msg.includes('99'))
    return buildCoachText(prixCoach, cfg?.trial_days);
  if (msg.includes('crédit') || msg.includes('credit') || msg.includes('prix') || msg.includes('tarif') ||
      msg.includes('coût') || msg.includes('cout') || msg.includes('payer') || msg.includes('acheter') ||
      msg.includes('pack') || msg.includes('gratuit') || msg.includes('free') ||
      msg.includes('plan') || msg.includes('chf'))
    return buildCreditsText(cfg);
  if (msg.includes('transcri') || msg.includes('enregistr') || msg.includes('record') || msg.includes('résumé') || msg.includes('resume') || msg.includes('télécharg')) return pick(BOT_RESPONSES.record);
  if (msg.includes('visio') || msg.includes('caméra') || msg.includes('camera') || msg.includes('zoom') || msg.includes('webcam') || msg.includes('main') || msg.includes('spotlight') || msg.includes('écran') || msg.includes('ecran') || msg.includes('scène') || msg.includes('scene')) return pick(BOT_RESPONSES.visio);
  if (msg.includes('mode') || msg.includes('ouverte') || msg.includes('accès') || msg.includes('acces')) return pick(BOT_RESPONSES.modes);
  if (msg.includes('privé') || msg.includes('prive') || msg.includes('salle') || msg.includes('attente') || msg.includes('admet') || msg.includes('payant')) return pick(BOT_RESPONSES.private);
  if (msg.includes('chat') || msg.includes('message') || msg.includes('commentaire') || msg.includes('like') || msg.includes('aime') || msg.includes('photo')) return pick(BOT_RESPONSES.chat);
  if (msg.includes('micro') || msg.includes('voix') || msg.includes('parler')) return pick(BOT_RESPONSES.voice);
  if (msg.includes('vidéo') || msg.includes('video') || msg.includes('youtube') || msg.includes('vimeo')) return pick(BOT_RESPONSES.video);
  if (msg.includes('langue') || msg.includes('anglais') || msg.includes('english') || msg.includes('allemand') || msg.includes('traduc')) return pick(BOT_RESPONSES.lang);
  if (msg.includes('rejoindre') || msg.includes('lien') || msg.includes('qr') || msg.includes('installer') || msg.includes('mobile')) return pick(BOT_RESPONSES.access);
  if (msg.includes('session') || msg.includes('créer') || msg.includes('hôte') || msg.includes('synchron')) return pick(BOT_RESPONSES.session);
  if (msg.includes('aide') || msg.includes('help') || msg.includes('comment') || msg.includes('quoi')) return pick(BOT_RESPONSES.help);

  return pick(BOT_RESPONSES.default);
}

