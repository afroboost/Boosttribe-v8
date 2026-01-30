# Boosttribe - Product Requirements Document

## Original Problem Statement
Build "Boosttribe," a web application for synchronized music listening sessions where hosts can share playlists with participants in real-time.

## Core Features Implemented

### ✅ Session Management
- Create/join sessions via unique IDs
- Role-based access (Host vs Participant)
- Real-time playlist synchronization via Supabase Realtime

### ✅ Role-Based UI (Implemented 2025-01-30)
**Host Mode:**
- Full control: upload, delete, reorder tracks
- Play/Pause/Seek controls active
- "Go Live" toggle
- Share link button

**Participant Mode:**
- Read-only playlist view
- Disabled playback controls (greyed out)
- No upload/delete/drag buttons (removed from DOM)
- Banner: "🎧 Mode écoute seule - Synchronisé avec l'hôte"
- Instant playlist sync (<1s on join)

### ✅ Audio Features
- MP3 upload to Supabase Storage
- Drag-and-drop playlist reordering
- Repeat modes (none, one, all)
- Free trial limit (5 minutes)

### ✅ Admin CMS
- Site settings management at `/admin`
- Dynamic pricing display
- Supabase upsert for settings persistence

### ✅ UI/UX
- Global language selector (FR/EN/DE)
- Dark theme with purple gradient accents
- Responsive design
- Toast notifications

## Technical Architecture

```
/app/frontend/src/
├── pages/
│   ├── SessionPage.tsx      # Main session with role logic
│   ├── PricingPage.tsx      # Dynamic pricing
│   └── admin/Dashboard.tsx  # Admin CMS
├── components/audio/
│   ├── AudioPlayer.tsx      # Player with host/participant modes
│   ├── PlaylistDnD.tsx      # Drag-drop with role restrictions
│   └── TrackUploader.tsx    # Upload component
├── context/
│   ├── AuthContext.tsx      # Auth & subscription logic
│   └── useSiteSettings.ts   # Settings with auto-refresh
└── lib/
    └── supabaseClient.ts    # Supabase configuration
```

## Database Schema (Supabase)

**playlists:**
- `id`: UUID
- `session_id`: TEXT (unique)
- `tracks`: JSONB (array of track objects)
- `created_at`: TIMESTAMP

**site_settings:**
- `id`: 1 (singleton)
- `site_name`: TEXT
- `plan_pro_price_monthly`: TEXT
- ... (other settings)

**profiles:**
- `id`: UUID (user ID)
- `subscription_status`: TEXT
- `role`: TEXT

## Changelog

### 2025-01-30 (SRE Optimization)
- [PERF] Fetch initial et connexion Realtime en parallèle (490-636ms)
- [UX] Message "Synchronisation en cours..." remplacé par "En attente de l'hôte"
- [VERIFY] Prix dynamiques confirmés sur PricingPage (9.99€/29.99€)
- [VERIFY] CSS badge Emergent déjà optimal en haut du <head>

### 2025-01-30
- [FIX] Implemented strict role-based UI for participants
- [FIX] Disabled playback controls for non-hosts
- [FIX] Removed edit buttons from DOM for participants
- [FIX] Added immediate playlist fetch on participant join
- [FIX] Fixed AuthContext bug: non-logged users incorrectly marked as subscribed
- [FIX] Added separate Realtime listeners for INSERT/UPDATE/DELETE

## Pending Verification (P0)
1. Admin CMS: Test settings save at `/admin`
2. Dynamic pricing: Verify auto-update after save
3. Realtime session: Test host-to-participant sync
4. Participant UI lock: Verify controls are disabled

## Roadmap

### P1 - Short Term
- Convert UI components to TypeScript

### P2 - Medium Term
- Host nickname management
- "Request to Speak" feature
- Theme persistence via Supabase

### P3 - Long Term
- Refactor SessionPage.tsx (component extraction)
- Add og:image for social sharing
- Analytics dashboard

## Credentials
- Admin: `contact.artboost@gmail.com` (Google Auth)
- Production URL: `https://boosttribe.pro`
