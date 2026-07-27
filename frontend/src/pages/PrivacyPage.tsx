import React from "react";
import { Link } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { Footer } from "@/components/layout/Footer";

// 📄 Politique de confidentialité — page publique à URL fixe (/confidentialite).
// Requise par le Play Store (lien obligatoire dans la fiche de l'app).
// Contenu repris à l'identique de POLITIQUE_CONFIDENTIALITE_BoostTribe.md.
// Page statique : aucune donnée chargée, aucun état, accessible sans login.

const LAST_UPDATE = "27 juillet 2026";
const CONTACT_EMAIL = "contact.artboost@gmail.com";

// Section numérotée : titre sobre, numéro en accent (--bt-accent piloté par l'admin).
const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <section className="mt-12 first:mt-0">
    <h2
      className="text-xl sm:text-2xl font-semibold text-white mb-4 flex items-baseline gap-3"
      style={{ fontFamily: "var(--bt-font-heading)" }}
    >
      <span className="text-base sm:text-lg tabular-nums" style={{ color: "var(--bt-accent)" }}>
        {n}.
      </span>
      <span>{title}</span>
    </h2>
    <div className="space-y-4">{children}</div>
  </section>
);

// Paragraphe de prose : contraste doux, interlignage large, longueur de ligne confortable.
const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-white/65 leading-relaxed text-[15px] sm:text-base">{children}</p>
);

// Liste à puces sobre (puce en accent).
const Bullets: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="space-y-2.5">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3 text-white/65 leading-relaxed text-[15px] sm:text-base">
        <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--bt-accent)" }} />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

// Mise en avant inline (reprend les **gras** du document source).
const B: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong className="font-semibold text-white/85">{children}</strong>
);

const Mail: React.FC = () => (
  <a
    href={`mailto:${CONTACT_EMAIL}`}
    className="font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
    style={{ color: "var(--bt-accent)" }}
  >
    {CONTACT_EMAIL}
  </a>
);

const PrivacyPage: React.FC = () => {
  const { theme } = useTheme();
  const { colors, fonts } = theme;

  return (
    <div className="min-h-screen" style={{ background: "#000000" }}>
      {/* Header minimal — retour au site, même charte que les autres pages publiques */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <Link to="/" className="flex items-center gap-2">
              <div
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center"
                style={{ background: colors.gradient.primary }}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
              <span
                className="text-xl sm:text-2xl font-bold"
                style={{
                  fontFamily: fonts.heading,
                  backgroundImage: colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {theme.name}
              </span>
            </Link>

            <Link to="/" className="text-white/60 hover:text-white text-sm transition-colors">
              Retour au site
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-28 sm:pt-36 pb-20 px-5 sm:px-6">
        <div className="max-w-3xl mx-auto">
          {/* Titre */}
          <p className="eyebrow mb-5" style={{ color: colors.primary }}>
            Légal
          </p>
          <h1
            className="text-3xl sm:text-5xl font-bold text-white leading-tight"
            style={{ fontFamily: fonts.heading }}
          >
            Politique de confidentialité
          </h1>
          <p className="mt-4 text-sm text-white/40">
            <B>Dernière mise à jour : {LAST_UPDATE}</B>
          </p>

          {/* Préambule */}
          <div className="mt-10 space-y-4 border-t border-white/10 pt-10">
            <P>
              La présente politique de confidentialité décrit comment l'application et le site <B>BoostTribe</B>{" "}
              (accessibles sur https://boosttribe.pro, ci-après «&nbsp;le Service&nbsp;») collectent, utilisent et
              protègent vos données personnelles.
            </P>
            <P>
              Le Service est édité et exploité par <B>l'association Afroboosteur</B>, Rue de Maillefer 39, 2000
              Neuchâtel, Suisse (IDE CHE-407.097.646), ci-après «&nbsp;nous&nbsp;». Pour toute question&nbsp;:{" "}
              <Mail />.
            </P>
            <P>
              Nous respectons la <B>Loi fédérale suisse sur la protection des données (nLPD)</B> et, lorsqu'il
              s'applique, le <B>Règlement général sur la protection des données (RGPD)</B> de l'Union européenne.
            </P>
          </div>

          <Section n={1} title="Données que nous collectons">
            <P>
              <B>Données de compte</B>&nbsp;: lorsque vous créez un compte ou rejoignez une session, nous collectons
              votre <B>adresse e-mail</B>, votre <B>nom / pseudonyme</B> et, le cas échéant, votre{" "}
              <B>photo de profil</B>.
            </P>
            <P>
              <B>Caméra et microphone</B>&nbsp;: pendant une session en direct (Live Visio, prise de parole),
              l'application accède à votre <B>caméra</B> et à votre <B>micro</B>. Ces flux sont transmis{" "}
              <B>en temps réel</B> aux autres participants via des connexions sécurisées (WebRTC) et{" "}
              <B>ne sont pas conservés</B>, sauf si l'hôte active explicitement l'enregistrement (voir ci-dessous).
              L'accès n'a lieu <B>qu'après votre autorisation</B> et uniquement pendant la session.
            </P>
            <P>
              <B>Enregistrements et transcriptions</B>&nbsp;: si l'hôte active la fonction «&nbsp;Enregistrer +
              IA&nbsp;», l'audio de la session (voix et musique) peut être enregistré, puis{" "}
              <B>transcrit et résumé automatiquement</B>. Ces contenus sont stockés de façon sécurisée et accessibles
              aux personnes autorisées de la session.
            </P>
            <P>
              <B>Contenus de session</B>&nbsp;: titres de playlist, messages de chat, médias partagés (fichiers,
              liens) que vous fournissez pendant une session.
            </P>
            <P>
              <B>Données de paiement</B>&nbsp;: pour les sessions payantes ou les abonnements, les paiements sont
              traités par nos prestataires <B>Stripe</B> (carte bancaire) et <B>PawaPay</B> (mobile money). Nous{" "}
              <B>ne stockons jamais</B> vos numéros de carte ni vos identifiants de paiement&nbsp;; ils sont traités
              directement par ces prestataires.
            </P>
            <P>
              <B>Données techniques et d'usage</B>&nbsp;: adresse IP, type d'appareil et de navigateur, pages
              consultées et interactions, à des fins de sécurité, de bon fonctionnement et de statistiques.
            </P>
          </Section>

          <Section n={2} title="Pourquoi nous utilisons vos données">
            <Bullets
              items={[
                "Fournir et faire fonctionner le Service (sessions synchronisées, visio, chat, paiements).",
                "Créer et gérer votre compte et votre accès aux sessions.",
                "Traiter les paiements et abonnements.",
                "Générer les enregistrements et transcriptions lorsque cette fonction est activée.",
                "Assurer la sécurité, prévenir la fraude et les abus.",
                "Améliorer le Service et établir des statistiques d'usage.",
              ]}
            />
            <P>
              Bases légales (RGPD)&nbsp;: exécution du contrat (fourniture du Service), votre consentement
              (caméra/micro, enregistrement, cookies non essentiels), notre intérêt légitime (sécurité, amélioration)
              et le respect d'obligations légales.
            </P>
          </Section>

          <Section n={3} title="Partage des données">
            <P>Nous ne vendons pas vos données. Nous les partageons uniquement avec&nbsp;:</P>
            <Bullets
              items={[
                <>
                  <B>Les autres participants</B> d'une session (votre nom, votre image/voix en direct si vous les
                  activez).
                </>,
                <>
                  <B>Nos prestataires techniques</B>, qui traitent les données pour notre compte&nbsp;: hébergement
                  et base de données (<B>Supabase</B>, auto-hébergé), transport vidéo temps réel (<B>LiveKit</B>,{" "}
                  <B>PeerJS</B>), paiements (<B>Stripe</B>, <B>PawaPay</B>), statistiques (<B>PostHog</B>).
                </>,
                <>
                  <B>Les autorités</B>, si la loi l'exige.
                </>,
              ]}
            />
            <P>
              Certains prestataires peuvent traiter des données hors de Suisse/UE&nbsp;; dans ce cas, des garanties
              appropriées sont mises en place.
            </P>
          </Section>

          <Section n={4} title="Durée de conservation">
            <P>
              Nous conservons vos données aussi longtemps que votre compte est actif ou que nécessaire pour fournir
              le Service, respecter nos obligations légales et résoudre les litiges. Les enregistrements et
              transcriptions sont conservés tant que la session ou le compte associé existe, puis supprimés. Vous
              pouvez demander la suppression de vos données à tout moment.
            </P>
          </Section>

          <Section n={5} title="Vos droits">
            <P>
              Conformément à la nLPD et au RGPD, vous disposez des droits d'<B>accès</B>, de <B>rectification</B>, de{" "}
              <B>suppression</B>, de <B>limitation</B>, d'<B>opposition</B> et de <B>portabilité</B> de vos données,
              ainsi que du droit de <B>retirer votre consentement</B> à tout moment. Pour exercer ces droits, écrivez
              à <Mail />. Vous pouvez aussi introduire une réclamation auprès de l'autorité de protection des données
              compétente (en Suisse, le PFPDT).
            </P>
          </Section>

          <Section n={6} title="Sécurité">
            <P>
              Nous mettons en œuvre des mesures techniques et organisationnelles appropriées (connexions chiffrées,
              contrôle des accès) pour protéger vos données. Aucune transmission sur Internet n'est toutefois
              totalement sûre à 100&nbsp;%.
            </P>
          </Section>

          <Section n={7} title="Cookies et technologies similaires">
            <P>
              Le Service utilise des cookies et technologies similaires nécessaires à son fonctionnement, ainsi que
              des cookies de mesure d'audience. Vous pouvez gérer vos préférences via votre navigateur.
            </P>
          </Section>

          <Section n={8} title="Mineurs">
            <P>
              Le Service n'est pas destiné aux enfants de moins de 13 ans (ou de l'âge minimum requis dans votre
              pays). Nous ne collectons pas sciemment leurs données.
            </P>
          </Section>

          <Section n={9} title="Modifications">
            <P>
              Nous pouvons mettre à jour cette politique. Toute modification importante sera signalée sur cette page,
              avec une date de mise à jour actualisée.
            </P>
          </Section>

          <Section n={10} title="Contact">
            <P>
              Association Afroboosteur — Rue de Maillefer 39, 2000 Neuchâtel, Suisse — IDE CHE-407.097.646
            </P>
            <P>
              E-mail&nbsp;: <Mail />
            </P>
          </Section>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default PrivacyPage;
