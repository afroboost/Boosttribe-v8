# Beattribe - Product Requirements Document

## Vision
**"Unite Through Rhythm"** - Application d'écoute musicale synchronisée en temps réel.

## Stack Technique
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Build**: Create React App (CRA) avec CRACO
- **UI Components**: Shadcn/UI + Radix UI
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **Real-time**: Supabase Realtime Channels (mode local si non configuré)
- **Storage**: Supabase Storage (bucket: audio-tracks)
- **Routing**: react-router-dom v6
- **Persistence**: LocalStorage (thème, pseudo), SessionStorage (userId)

## Fonctionnalités Implémentées

### ✅ Phase 1 - Core (Complété)
- [x] Design System Beattribe (couleurs, fonts, CSS variables)
- [x] Page d'accueil avec Hero Section
- [x] Formulaire "Créer/Rejoindre session"
- [x] Dashboard Admin protégé (/admin) - MDP: `BEATTRIBE2026`
- [x] Système de thème dynamique avec LocalStorage
- [x] Lecteur audio avec distinction Host/Participant
- [x] Modal de saisie de pseudo avec persistance
- [x] Routes dynamiques (/session/:sessionId)

### ✅ Phase 2 - Playlist & Modération (Complété)
- [x] **Playlist Drag & Drop** (10 titres max)
- [x] **Panel de Modération Participants**
- [x] **Contrôle Micro Hôte**
- [x] **Design minimaliste** (lucide-react, bordures fines)

### ✅ Phase 3 - Real-Time (Complété - 27 Jan 2026)
- [x] **SocketProvider** avec Supabase Realtime
- [x] **Modération temps réel**:
  - CMD_MUTE_USER → Force mute côté participant
  - CMD_UNMUTE_USER → Réactive le son
  - CMD_EJECT_USER → Redirection vers / avec toast
  - CMD_VOLUME_CHANGE → Ajustement volume distant
- [x] **Sync Playlist** → Réorganisation synchronisée pour tous
- [x] **Mode Local** → Message d'avertissement si Supabase non configuré
- [x] **Logs console** pour debug ([REALTIME IN/OUT])

### ✅ Phase 4 - Supabase Integration (Complété - 27 Jan 2026)
- [x] **supabaseClient.ts** - Configuration client avec détection auto
- [x] **TrackUploader.tsx** - Composant upload MP3
- [x] **SocketContext.tsx** - Refactoring pour Supabase Realtime uniquement
- [x] **.env.example** - Documentation complète de configuration
- [x] **Indicateur de connexion** - Badge Supabase/Local dans l'UI
- [x] **Message "Mode Local"** - Avertissement visible si backend non connecté

## Architecture Supabase

```
supabaseClient.ts
├── Configuration
│   ├── REACT_APP_SUPABASE_URL
│   ├── REACT_APP_SUPABASE_ANON_KEY
│   └── REACT_APP_SUPABASE_BUCKET (default: audio-tracks)
│
├── Storage Functions
│   ├── uploadAudioFile(file, sessionId) → UploadResult
│   ├── deleteAudioFile(filePath) → boolean
│   └── listSessionFiles(sessionId) → string[]
│
├── Realtime Functions
│   ├── createSessionChannel(sessionId, onMessage) → RealtimeChannel
│   ├── broadcastToSession(channel, payload) → boolean
│   └── unsubscribeChannel(channel) → void
│
└── Database Functions
    ├── savePlaylist(playlist) → boolean
    └── loadPlaylist(sessionId) → PlaylistRecord | null
```

## Events Temps Réel

| Event | Direction | Description |
|-------|-----------|-------------|
| CMD_MUTE_USER | Host → Participant | Force mute audio |
| CMD_UNMUTE_USER | Host → Participant | Réactive audio |
| CMD_EJECT_USER | Host → Participant | Éjecte de la session |
| CMD_VOLUME_CHANGE | Host → Participant | Change volume distant |
| SYNC_PLAYLIST | Host → All | Synchronise ordre playlist |
| SYNC_PLAYBACK | Host → All | Synchronise lecture |
| USER_JOINED | Any → All | Annonce arrivée |
| USER_LEFT | Any → All | Annonce départ |

## Configuration Supabase Requise

### 1. Storage Bucket
```sql
-- Créer bucket "audio-tracks" avec:
- Public: OUI
- Allowed MIME types: audio/mpeg, audio/mp3
- Max file size: 50MB
```

### 2. Policies
```sql
-- Public read
CREATE POLICY "Allow public read" ON storage.objects
FOR SELECT USING (bucket_id = 'audio-tracks');

-- Authenticated upload
CREATE POLICY "Allow upload" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'audio-tracks');
```

### 3. Table Playlists (optionnel)
```sql
CREATE TABLE playlists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  tracks JSONB NOT NULL DEFAULT '[]',
  selected_track_id INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON playlists FOR ALL USING (true) WITH CHECK (true);
```

## Files de Référence

| File | Description |
|------|-------------|
| `/frontend/src/lib/supabaseClient.ts` | Client Supabase + fonctions Storage/Realtime |
| `/frontend/src/context/SocketContext.tsx` | Provider temps réel |
| `/frontend/src/components/audio/TrackUploader.tsx` | Composant upload MP3 |
| `/frontend/src/pages/SessionPage.tsx` | Page session principale |
| `/frontend/.env.example` | Documentation configuration |

## Tâches à Venir

### P1 - Priorité Haute
- [ ] Convertir composants `.jsx` → `.tsx` restants
- [ ] Refactoring SessionPage.tsx (trop volumineux)

### P2 - Priorité Moyenne  
- [ ] Nickname Host "Coach" par défaut éditable
- [ ] Persister thème dans Supabase
- [ ] Authentification réelle (remplacer MDP hardcodé)

### P3 - Backlog
- [ ] Equalizer visuel avancé
- [ ] Chat texte temps réel
- [ ] Historique des sessions

## Credentials Test
- **Admin URL**: `/admin`
- **Password**: `BEATTRIBE2026`
- **Supabase**: Nécessite `.env` avec `REACT_APP_SUPABASE_URL` et `REACT_APP_SUPABASE_ANON_KEY`

## Notes Importantes

⚠️ **Mode Local Active** : Sans configuration Supabase, l'application fonctionne en mode local. Les fonctionnalités temps réel multi-appareils ne sont pas disponibles. L'upload utilise un mock avec `URL.createObjectURL()`.

✅ **Build Status**: `npm run build` réussit sans erreurs ni warnings.

✅ **Prêt pour Déploiement**: Le code est prêt pour Emergent et Vercel. Il suffit de configurer les variables d'environnement Supabase.
