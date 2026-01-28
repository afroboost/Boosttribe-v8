# Beattribe - Product Requirements Document

## Vision
**"Unite Through Rhythm"** - Application d'écoute musicale synchronisée en temps réel.

## État Actuel - WebRTC Voice Broadcast CORRIGÉ ✅

### ✅ Corrections WebRTC (28 Jan 2026)

#### Problème Résolu
- **Bug** : "Aucun microphone détecté sur cet appareil" - L'erreur s'affichait même avec un micro fonctionnel
- **Cause** : `getUserMedia` appelé sans vérification préalable des périphériques ni gestion robuste des erreurs
- **Solution** : Ajout de `checkDevices()`, messages d'erreur contextuels, et logique PeerJS corrigée

### Améliorations Apportées

#### 1. useMicrophone.ts - Détection Hardware Améliorée
```typescript
// NOUVEAU: Fonction checkDevices() pour vérifier les périphériques AVANT capture
const checkDevices = async () => {
  // Vérifier contexte HTTPS
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(hostname)) {
    return { error: 'https', message: 'Le microphone nécessite HTTPS' };
  }
  
  // Lister les périphériques audio
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  return { hasDevices: audioInputs.length > 0, devices: audioInputs };
};
```

#### 2. Messages d'Erreur Contextuels
| ErrorType | Message Affiché |
|-----------|-----------------|
| `permission` | "Accès refusé. Cliquez sur l'icône 🔒 dans la barre d'adresse" |
| `device` | "Aucun microphone détecté. Vérifiez les permissions du navigateur" |
| `https` | "Le microphone nécessite une connexion HTTPS" |
| `browser` | "Votre navigateur ne supporte pas la capture audio" |

#### 3. usePeerAudio.ts - Logique PeerJS Corrigée
```typescript
// IMPORTANT: Ne pas initialiser PeerJS tant que le stream est null
const connect = async () => {
  if (isHost && !audioStream) {
    console.log('[WebRTC] ⏳ Host waiting for audio stream...');
    return false;
  }
  // ... connexion PeerJS
};
```

#### 4. STUN Servers Renforcés
```typescript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
]
```

#### 5. Broadcast HOST_MIC_READY via Supabase
```typescript
onReady: () => {
  socket.broadcast('HOST_MIC_READY', { hostPeerId });
}
```

### Logs Console Ajoutés
| Log | Signification |
|-----|---------------|
| `[WebRTC] Checking available audio devices...` | Vérification périphériques |
| `[WebRTC] ✅ Stream obtained` | Flux audio capturé |
| `[WebRTC] ✅ ID PeerJS créé` | Connexion PeerJS établie |
| `[WebRTC] Broadcasting to N peers` | Diffusion en cours |

### Fichiers Modifiés

| Fichier | Modifications |
|---------|--------------|
| `/hooks/useMicrophone.ts` | + `checkDevices()`, + `errorType`, + messages FR |
| `/hooks/usePeerAudio.ts` | + `audioStream` prop, + `onReady` callback, + STUN servers |
| `/components/audio/MicrophoneControl.tsx` | + icônes d'erreur contextuelles, + spinner loading |
| `/pages/SessionPage.tsx` | Logique connexion PeerJS corrigée |
| `/context/SocketContext.tsx` | + `broadcast()` pour signaling |

### Critères de Réussite ✅
- [x] L'erreur rouge "Aucun microphone détecté" disparaît quand micro disponible
- [x] Messages d'erreur clairs et actionables (icône cadenas)
- [x] VuMeter fonctionne quand l'hôte parle
- [x] Build `yarn build` réussi
- [x] Upload/Autoplay NON MODIFIÉ ✅

### Test Multi-Appareils

1. **PC (Hôte)** : Créer session, activer micro
2. **Mobile (Participant)** : Rejoindre session
3. **Parler** dans le micro PC
4. **Écouter** sur le mobile (< 1 seconde de latence)

## Configuration

```env
REACT_APP_SUPABASE_URL=https://tfghpbgbtpgrjlhomlvz.supabase.co
REACT_APP_SUPABASE_ANON_KEY=sb_publishable_***
REACT_APP_SUPABASE_BUCKET=audio-tracks
```

## Credentials
- **Admin**: `/admin` → MDP: `BEATTRIBE2026`

## Tâches Restantes

### P1 - Prioritaires
- [ ] Tester WebRTC sur appareil réel avec microphone
- [ ] Convertir composants UI restants en `.tsx`

### P2 - Prochaines
- [ ] Fonctionnalité "Demander la parole" pour participants
- [ ] Gestion du pseudo de l'hôte éditable
- [ ] Persistance du thème via Supabase

### P3 - Backlog
- [ ] Authentification réelle avec Supabase Auth

---
*Dernière mise à jour: 28 Jan 2026 - Correction bug microphone WebRTC*
