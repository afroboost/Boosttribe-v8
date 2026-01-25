# Beattribe - Product Requirements Document

## Vision
**"Unite Through Rhythm"** - Application d'écoute musicale synchronisée en temps réel.

## Stack Technique
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Build**: Create React App (CRA) avec CRACO
- **UI Components**: Shadcn/UI + Radix UI
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **Real-time**: BroadcastChannel API (prêt pour Socket.io)
- **Routing**: react-router-dom v6
- **Storage**: LocalStorage (thème, pseudo), SessionStorage (userId)

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

### ✅ Phase 2 - Playlist & Modération (Complété - 25 Jan 2026)
- [x] **Playlist Drag & Drop** (10 titres max)
- [x] **Panel de Modération Participants**
- [x] **Contrôle Micro Hôte**
- [x] **Design minimaliste** (lucide-react, bordures fines)

### ✅ Phase 3 - WebSocket Temps Réel (Complété - 25 Jan 2026)
- [x] **SocketProvider** avec BroadcastChannel API
- [x] **Modération temps réel**:
  - CMD_MUTE_USER → Force mute côté participant
  - CMD_UNMUTE_USER → Réactive le son
  - CMD_EJECT_USER → Redirection vers / avec toast
  - CMD_VOLUME_CHANGE → Ajustement volume distant
- [x] **Sync Playlist** → Réorganisation synchronisée pour tous
- [x] **Logs console** pour debug ([SOCKET IN/OUT])

## Architecture Socket

```
SocketContext.tsx
├── BroadcastChannel API (inter-tabs)
├── Events:
│   ├── CMD_MUTE_USER
│   ├── CMD_UNMUTE_USER
│   ├── CMD_EJECT_USER
│   ├── CMD_VOLUME_CHANGE
│   ├── SYNC_PLAYLIST
│   ├── SYNC_PLAYBACK
│   ├── USER_JOINED
│   └── USER_LEFT
└── Listeners: onMuted, onEjected, onPlaylistSync
```

## Fichiers Clés
```
/app/frontend/src/
├── context/
│   ├── SocketContext.tsx    # Communication temps réel
│   └── ThemeContext.tsx
├── components/audio/
│   ├── AudioPlayer.tsx
│   ├── PlaylistDnD.tsx
│   ├── ParticipantControls.tsx
│   └── HostMicControl.tsx
├── pages/SessionPage.tsx
└── App.tsx (wrappé avec SocketProvider)
```

## Test Inter-Onglets

1. **Onglet 1 (Host)**: Créer session → `/session`
2. **Onglet 2 (Participant)**: Copier URL → rejoindre
3. **Test Mute**: Host clique mute sur Sarah K. → Console montre CMD_MUTE_USER
4. **Test Eject**: Host éjecte un participant → Redirection + toast

## Backlog (P1-P3)

### P0 - Priorité immédiate
- [ ] Remplacer BroadcastChannel par Socket.io (backend Node.js)
- [ ] Sync playback audio (play/pause/seek)

### P1 - Court terme
- [ ] Convertir shadcn/ui .jsx restants en .tsx
- [ ] Persistance session (participants réels via WebSocket)

### P2 - Moyen terme
- [ ] Upload fichiers audio personnalisés
- [ ] Chat en temps réel

### P3 - Long terme
- [ ] Authentification réelle
- [ ] Base de données pour sessions

## Credentials de Test
- **Admin**: /admin → MDP: `BEATTRIBE2026`
- **Session Host**: /session (créer nouvelle)
- **Session Participant**: /session/{id}

## Notes Techniques
- BroadcastChannel = communication inter-onglets (même origine)
- Pour migration Socket.io: modifier uniquement `SocketContext.tsx`
- Hot reload activé
- Build: `npm run build` ✅ (131 kB gzip)
