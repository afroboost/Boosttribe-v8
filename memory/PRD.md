# Boosttribe v8 - Product Requirements Document

## Original Problem Statement
Build "Boosttribe," a web application for synchronized music listening sessions where hosts can share playlists with participants in real-time.

---

## ✅ COMPLETED FEATURES (Production Ready)

### ✅ CMS Admin Fix
- **Status**: TERMINÉ
- Supabase `upsert` pour la sauvegarde des paramètres
- Erreur `TypeError: body stream already read` résolue
- Dashboard fonctionnel à `/admin`

### ✅ Realtime Sync
- **Status**: TERMINÉ
- Fetch initial parallèle avec connexion Realtime (<1s)
- Écoute des événements INSERT/UPDATE/DELETE
- Synchronisation instantanée Host → Participants

### ✅ Domain Locking
- **Status**: TERMINÉ
- URL de production verrouillée sur `https://boosttribe.pro`
- Redirection Auth configurée dans `AuthContext.tsx`

### ✅ Role Security (Host vs Participant)
- **Status**: TERMINÉ
- Contrôles Play/Pause/Seek désactivés pour participants
- Boutons suppression/drag supprimés du DOM
- Bandeau "🎧 Mode écoute seule" affiché
- Zone d'upload masquée pour participants

### ✅ UI/UX
- Sélecteur de langue global (FR/EN/DE)
- Badge Emergent masqué (CSS prioritaire)
- Thème sombre avec accents violets
- Toast notifications
- Design responsive

### ✅ Audio Features
- Upload MP3 vers Supabase Storage
- Drag-and-drop réorganisation playlist
- Modes de répétition (none, one, all)
- Limite essai gratuit (5 minutes)

### ✅ Dynamic Pricing
- Prix Pro (9.99€) et Enterprise (29.99€) depuis `site_settings`
- Auto-refresh des composants après sauvegarde admin
- Intégration Stripe prête

---

## Technical Architecture

```
/app/frontend/src/
├── pages/
│   ├── SessionPage.tsx      # Session principale (nettoyé, sans logs debug)
│   ├── PricingPage.tsx      # Tarification dynamique
│   └── admin/Dashboard.tsx  # CMS Admin (VERROUILLÉ)
├── components/audio/
│   ├── AudioPlayer.tsx      # Lecteur avec modes host/participant
│   ├── PlaylistDnD.tsx      # Drag-drop avec restrictions rôle
│   └── TrackUploader.tsx    # Composant upload
├── context/
│   ├── AuthContext.tsx      # Auth & abonnements (VERROUILLÉ)
│   └── useSiteSettings.ts   # Settings avec auto-refresh
└── lib/
    └── supabaseClient.ts    # Configuration Supabase
```

---

## Database Schema (Supabase)

**playlists:**
- `id`: UUID
- `session_id`: TEXT (unique)
- `tracks`: JSONB
- `created_at`: TIMESTAMP

**site_settings:**
- `id`: 1 (singleton)
- `site_name`: TEXT
- `plan_pro_price_monthly`: TEXT
- `plan_enterprise_price_monthly`: TEXT

**profiles:**
- `id`: UUID
- `subscription_status`: TEXT
- `role`: TEXT

---

## Changelog

### 2025-01-30 (Broadcast Sync)
- [FIX] Play/Pause sync via Supabase Broadcast channel (< 500ms latency)
- [FIX] Participant trial limit removed - unlimited listening
- [CLEAN] Removed all auto-ducking references

### 2025-01-30 (Sync & Trial Fix)
- [FIX] Play/Pause sync via Supabase Realtime (is_playing, current_time)
- [FIX] Trial limit removed for participants (isFreeTrial = isHost && !isSubscribed)
- [CLEAN] Removed ducking logic from MicrophoneControl.tsx

### 2025-01-30 (Audio Mixer Feature)
- [FEAT] Created independent audio mixer with 4 GainNodes (Music, Mic, Tribe, Host Voice)
- [FEAT] Added AudioMixerPanel UI component with volume sliders
- [FIX] Disabled aggressive echo cancellation to allow music+voice overlay
- [FIX] Removed "duck" effect - channels now fully independent

### 2025-01-30 (v8 - Production Cleanup)
- [CLEAN] Suppression de tous les logs de debug `📡 [SYSTEM]`, `📡 [DATA]`
- [CLEAN] Code production-ready sans traces de développement
- [ADD] manifest.json avec branding Boosttribe

### 2025-01-30 (SRE Optimization)
- [PERF] Fetch initial et connexion Realtime en parallèle (490-636ms)
- [UX] Message "Synchronisation en cours..." remplacé par "En attente de l'hôte"
- [VERIFY] Prix dynamiques confirmés sur PricingPage (9.99€/29.99€)

### 2025-01-30 (Role Security)
- [FIX] Implemented strict role-based UI for participants
- [FIX] Disabled playback controls for non-hosts
- [FIX] Removed edit buttons from DOM for participants
- [FIX] Added immediate playlist fetch on participant join

---

## Roadmap

### P1 - Short Term (Robustesse)
- [ ] Conversion des composants UI restants en TypeScript
- [ ] Tests E2E automatisés

### P2 - Medium Term (Fonctionnalités)
- [ ] Gestion des pseudonymes par l'hôte
- [ ] Fonctionnalité "Request to Speak"
- [ ] Persistance du thème via Supabase

### P3 - Long Term (Scalabilité)
- [ ] Refactoring SessionPage.tsx (extraction composants)
- [ ] Image og:image pour partage social
- [ ] Dashboard analytics

---

## Files Locked (Ne pas modifier)

| Fichier | Raison |
|---------|--------|
| `Dashboard.tsx` | `handleSave` validé |
| `AuthContext.tsx` | URL boosttribe.pro verrouillée |
| `SessionPage.tsx` (logique isHost) | Rôles validés |
| Logique upload audio | Fonctionnelle |

---

## Credentials
- **Admin**: `contact.artboost@gmail.com` (Google Auth)
- **Production URL**: `https://boosttribe.pro`
