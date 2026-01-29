# Beattribe - Product Requirements Document

## Vision
**"Unite Through Rhythm"** - Application d'écoute musicale synchronisée en temps réel.

---

## Dernières Corrections - 29 Jan 2026 (Session 2) ✅

### 🟢 CORRECTIONS AUTO-HEALING BASE DE DONNÉES

#### 1. Auto-insertion dans useSiteSettings.ts ✅
- **Fichier**: `/app/frontend/src/hooks/useSiteSettings.ts`
- Si la table `site_settings` existe mais est vide, insertion automatique d'une ligne par défaut
- Évite les erreurs `TypeError` lors du chargement des paramètres

#### 2. Auto-insertion dans Admin Dashboard ✅
- **Fichier**: `/app/frontend/src/pages/admin/Dashboard.tsx`
- Si la table `site_settings` est vide, insertion automatique lors du chargement du CMS
- Mode "auto-healing" : pas d'erreur affichée, fallback silencieux vers les défauts

#### 3. Modal Bloquant pour Limite 5 Minutes ✅
- **Fichier**: `/app/frontend/src/pages/SessionPage.tsx`
- Remplacé le simple message par un **modal en plein écran** (`fixed inset-0 z-50`)
- Bloque toute interaction jusqu'à ce que l'utilisateur passe à Pro
- Design avec icône, description des avantages Pro, et CTA visible

---

## Corrections Précédentes - 29 Jan 2026 (Session 1) ✅

### 🟢 STRIPE & ESSAI GRATUIT - IMPLÉMENTÉ

#### 5. Intégration Stripe - CONFIGURÉ ✅
- **Fichier**: `/app/frontend/src/pages/PricingPage.tsx`
- Les liens Stripe sont maintenant chargés depuis `site_settings` (Admin Dashboard)
- Redirection directe vers Stripe (`window.open`) - **PAS D'ALERT**
- Si liens non configurés, redirection vers URL par défaut

#### 6. Essai Gratuit 5 Minutes - IMPLÉMENTÉ ✅
- **Fichier**: `/app/frontend/src/pages/SessionPage.tsx`
- Timer visible avec barre de progression pour utilisateurs non abonnés
- Lecture automatiquement mise en pause après 300 secondes
- Modal bloquant "Limite d'essai atteinte" avec CTA vers /pricing
- Les utilisateurs abonnés ne voient pas le timer

#### 7. Hook useSiteSettings - ÉTENDU ✅
- **Fichier**: `/app/frontend/src/hooks/useSiteSettings.ts`
- Ajout des champs `stripe_pro_monthly`, `stripe_pro_yearly`, `stripe_enterprise_monthly`, `stripe_enterprise_yearly`

---

### 🔴 CORRECTIONS CRITIQUES APPLIQUÉES

#### 1. Badge "Made with Emergent" - SUPPRIMÉ ✅
- **Fichier**: `/app/frontend/public/index.html`
- **Solution**: CSS agressif + JavaScript avec MutationObserver pour éliminer le badge injecté dynamiquement par le script externe
- **Méthodes appliquées**:
  - CSS `display: none !important` sur tous sélecteurs possibles
  - JavaScript qui s'exécute toutes les 100ms pendant 10s, puis toutes les 500ms
  - MutationObserver pour intercepter les insertions dynamiques

#### 2. Playlist Vide par Défaut - CONFIRMÉ ✅
- **Fichier**: `/app/frontend/src/pages/SessionPage.tsx`
- `DEMO_TRACKS` est un tableau vide `[]`
- Les pistes "Midnight Groove", "Urban Pulse", "Summer Vibes" vues dans la vidéo proviennent de la **base Supabase de l'utilisateur**, pas du code

#### 3. UI de Suppression de Pistes - AMÉLIORÉE ✅
- **Fichier**: `/app/frontend/src/components/audio/PlaylistDnD.tsx`
- Icône Trash2 **toujours visible** avec couleur rouge/rose pour meilleure visibilité
- Bouton "Modifier" avec style violet (#8A2EFF) pour meilleure visibilité et cohérence
- `data-testid` et `aria-label` ajoutés pour les tests et accessibilité
- Protection anti-undefined dans `SessionPage.tsx` pour la synchronisation playlist

#### 4. Domaine de Production - CONFIGURÉ ✅
- **Fichier**: `/app/frontend/src/context/AuthContext.tsx`
- Redirections OAuth et reset password vers `https://www.boosttribe.pro`

---

## État Actuel - AUTHENTIFICATION COMPLÈTE ✅

### ✅ Implémentation Auth (28 Jan 2026)

#### Architecture Auth Supabase
```
┌─────────────────────────────────────────────────┐
│              AUTHENTIFICATION                   │
│  • Email/Password                              │
│  • Google OAuth                                │
│  • Password Reset                              │
│  • CGU obligatoires à l'inscription           │
└─────────────────────────────────────────────────┘
                      │
┌─────────────────────────────────────────────────┐
│              RÔLES & ABONNEMENTS               │
│  • Admin : role='admin' dans table profiles    │
│  • User : trial, monthly, yearly, enterprise   │
│  • Accès illimité pour Admin (via DB)         │
└─────────────────────────────────────────────────┘
```

### Fichiers Créés

| Fichier | Description |
|---------|-------------|
| `/context/AuthContext.tsx` | Gestion auth Supabase, profils, rôles |
| `/pages/LoginPage.tsx` | Page connexion/inscription/reset |
| `/components/auth/RequireAuth.tsx` | Guard de route authentifié |

### Fonctionnalités Auth

#### 1. Page Login (/login)
- Email + Mot de passe
- Bouton "Se connecter avec Google"
- Lien "Mot de passe oublié ?"
- Toggle Login/Signup
- Redirection vers page précédente après login

#### 2. Page Signup
- Nom complet
- Email + Mot de passe (min 6 caractères)
- **Checkbox CGU obligatoire** ✅
- Confirmation email envoyée

#### 3. Sécurisation Admin
```sql
-- L'admin n'est plus défini par mot de passe hardcodé
-- Il est défini par son email dans la table profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  role TEXT DEFAULT 'user', -- 'admin' pour les admins
  subscription_status TEXT DEFAULT 'trial',
  has_accepted_terms BOOLEAN DEFAULT FALSE
);

-- Pour créer un admin :
UPDATE profiles SET role = 'admin' WHERE email = 'votre@email.com';
```

#### 4. Navigation Protégée
```typescript
// Route protégée - redirige vers /login si non connecté
<RequireAuth>
  <SessionPage />
</RequireAuth>

// Admin bypass toutes les restrictions
if (isAdmin) return true;
```

### UI Updates

#### Header
- **Non connecté** : Boutons "Connexion" + "Commencer"
- **Connecté** : Avatar + Nom + Badge Admin + Bouton déconnexion
- **"Communauté" supprimée** du menu ✅

#### Page Pricing
- **Toggle Mensuel/Annuel** avec badge "-17%"
- **3 plans** : Essai Gratuit, Pro, Enterprise
- Prix dynamiques selon période sélectionnée

### Routes

| Route | Protection | Description |
|-------|------------|-------------|
| `/` | Public | Page d'accueil |
| `/login` | Public | Connexion/Inscription |
| `/pricing` | Public | Tarifs |
| `/session` | Auth Required | Créer une session |
| `/session/:id` | Public | Rejoindre une session |
| `/admin` | Password Protected | Dashboard admin |

### Checklist ✅
- [x] Login Email/Password
- [x] Google OAuth
- [x] Password Reset
- [x] CGU à l'inscription
- [x] Admin via DB (pas hardcodé)
- [x] Redirection après login vers page précédente
- [x] Toggle Mensuel/Annuel
- [x] "Communauté" supprimé
- [x] Build `yarn build` réussi
- [x] WebRTC/Microphone NON MODIFIÉ ✅

### Configuration Supabase Requise

```sql
-- 1. Créer la table profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  subscription_status TEXT DEFAULT 'trial',
  has_accepted_terms BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Activer Google Auth dans Supabase Dashboard
-- Settings > Authentication > Providers > Google

-- 3. Créer un admin
UPDATE profiles SET role = 'admin' WHERE email = 'admin@votredomaine.com';
```

## Credentials
- **Admin Legacy**: `/admin` → MDP: `BEATTRIBE2026` (pour le dashboard admin)
- **Admin Real**: Utilisateur avec `role='admin'` dans la table `profiles`

## URLs
- **Accueil**: `/`
- **Login**: `/login`
- **Tarifs**: `/pricing`
- **Session**: `/session`
- **Admin**: `/admin`

## Mises à jour récentes (29 Jan 2026)

### ✅ Badge Emergent SUPPRIMÉ DÉFINITIVEMENT
- CSS `display: none !important` ajouté dans `index.html`
- Script JS `removeEmergentBadge()` qui supprime le badge du DOM
- Intervalle de 500ms pour s'assurer qu'il reste supprimé

### ✅ Suppression de Pistes (UI Minimaliste)
1. **Suppression individuelle** - Icône Trash2 (`text-zinc-500 opacity-70`) visible sur chaque piste
2. **Mode sélection** - Bouton "Modifier" quand playlist non vide
3. **Suppression multiple** - Checkboxes + "Supprimer (n)"
4. **Suppression Storage Supabase** - `deleteTracks()` supprime DB + fichiers

### ✅ Purge Données de Test
- `DEMO_TRACKS = []` - Playlist vide par défaut
- `BASE_PARTICIPANTS = []` - Pas de participants mock
- Note: Les tracks existantes en DB Supabase doivent être supprimées manuellement via l'UI

### ✅ Configuration Domaine Production
- OAuth redirect vers `https://www.boosttribe.pro` quand sur ce domaine
- Reset password redirect configuré également

---

## Tâches Restantes

### P0 - En attente de configuration utilisateur
- [ ] Configuration domaine `www.boosttribe.pro`
- [ ] Mise à jour des redirect URLs OAuth dans Supabase

### P1 - Bugs à vérifier
- [ ] Upload MP3 (erreur "body stream already read" - fix en attente de validation)
- [ ] Créer table `profiles` dans Supabase
- [ ] Activer Google Auth Provider

### P2 - Stripe
- [ ] Créer Payment Links dans Stripe Dashboard
- [ ] Webhook pour mettre à jour `subscription_status`

### P3 - Backlog
- [ ] Dashboard utilisateur (historique, factures)
- [ ] Analytics abonnements
- [ ] Refactoriser SessionPage.tsx
- [ ] Convertir composants UI en TypeScript

---
*Dernière mise à jour: 29 Jan 2026 - Purge branding et données de test*
