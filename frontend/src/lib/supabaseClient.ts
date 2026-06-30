import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';

// Environment variables
const supabaseUrl = import.meta.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.REACT_APP_SUPABASE_ANON_KEY;
const storageBucket = import.meta.env.REACT_APP_SUPABASE_BUCKET || 'audio-tracks';

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'https://your-project.supabase.co'
);

// Create Supabase client (or null if not configured)
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

// Storage bucket name
export const AUDIO_BUCKET = storageBucket;

// Log RLS configuration instructions to console
export function logBucketConfigInstructions() {
  console.log('%c═══════════════════════════════════════════════════════════════════', 'color: #8A2EFF; font-weight: bold');
  console.log('%c   SUPABASE STORAGE - Configuration RLS requise', 'color: #FF2FB3; font-weight: bold; font-size: 14px');
  console.log('%c═══════════════════════════════════════════════════════════════════', 'color: #8A2EFF; font-weight: bold');
  console.log('');
  console.log('%c📋 Copiez ces commandes SQL dans Supabase > SQL Editor:', 'color: #22c55e; font-weight: bold');
  console.log('');
  console.log(`-- 1. Policy INSERT (permettre les uploads)
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'audio-tracks');`);
  console.log('');
  console.log(`-- 2. Policy SELECT (permettre la lecture)
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'audio-tracks');`);
  console.log('');
  console.log('%c═══════════════════════════════════════════════════════════════════', 'color: #8A2EFF; font-weight: bold');
  console.log('%c🔗 Dashboard: https://supabase.com/dashboard/project/tfghpbgbtpgrjlhomlvz/sql', 'color: #3b82f6');
  console.log('%c═══════════════════════════════════════════════════════════════════', 'color: #8A2EFF; font-weight: bold');
}

// ============================================
// STORAGE FUNCTIONS
// ============================================

export interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}

/**
 * Upload an audio file to Supabase Storage
 * Uses direct fetch API to avoid SDK stream issues
 */
export async function uploadAudioFile(
  file: File,
  sessionId: string,
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  // Check Supabase configuration
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[SUPABASE] ❌ Client non initialisé');
    return { 
      success: false, 
      error: 'Supabase non configuré. Vérifiez vos variables d\'environnement.' 
    };
  }

  // Validate file type
  if (!file.type.includes('audio/') && !file.name.toLowerCase().endsWith('.mp3')) {
    return { success: false, error: 'Seuls les fichiers audio sont acceptés' };
  }

  // Validate file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return { success: false, error: 'Le fichier ne doit pas dépasser 50 Mo' };
  }

  // Generate unique filename
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filePath = `${sessionId}/${timestamp}_${sanitizedName}`;
  const contentType = file.type || 'audio/mpeg';

  console.log('[SUPABASE STORAGE] 📤 Upload:', filePath);

  try {
    // Use direct fetch API to avoid SDK stream issues
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${AUDIO_BUCKET}/${filePath}`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: file,
    });

    // Check response status (NOT reading body)
    if (!response.ok) {
      const statusText = response.statusText || 'Upload failed';
      console.error('[SUPABASE STORAGE] ❌ HTTP Error:', response.status, statusText);
      
      if (response.status === 404) {
        logBucketConfigInstructions();
        return { success: false, error: 'Bucket introuvable. Vérifiez Supabase Dashboard.' };
      }
      
      if (response.status === 403 || response.status === 401) {
        logBucketConfigInstructions();
        return { success: false, error: 'Permission refusée. Vérifiez les policies RLS.' };
      }
      
      return { success: false, error: `Erreur ${response.status}: ${statusText}` };
    }

    // Success - construct public URL without reading response body
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${AUDIO_BUCKET}/${filePath}`;
    
    console.log('[SUPABASE STORAGE] ✅ Upload réussi:', publicUrl);

    return {
      success: true,
      url: publicUrl,
      path: filePath,
    };
    
  } catch (err) {
    console.error('[SUPABASE STORAGE] Exception:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Erreur lors de l\'upload' 
    };
  }
}

/**
 * Delete an audio file from Supabase Storage
 */
export async function deleteAudioFile(filePath: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('[SUPABASE] Delete error:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[SUPABASE] Delete exception:', err);
    return false;
  }
}

/**
 * Delete multiple tracks from storage
 * Extracts file path from URL and removes from storage
 */
export async function deleteTracks(trackUrls: string[]): Promise<{ success: boolean; deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  if (!supabase || !supabaseUrl) {
    console.warn('[SUPABASE] Not configured, tracks not deleted from storage');
    return { success: false, deleted: 0, errors: ['Supabase non configuré'] };
  }

  for (const url of trackUrls) {
    try {
      // Extract file path from URL
      // URL format: https://xxx.supabase.co/storage/v1/object/public/audio-tracks/SESSION_ID/timestamp_filename.mp3
      const publicPrefix = `/storage/v1/object/public/${AUDIO_BUCKET}/`;
      const urlObj = new URL(url);
      const pathIndex = urlObj.pathname.indexOf(publicPrefix);
      
      if (pathIndex === -1) {
        console.warn('[SUPABASE] Invalid track URL format:', url);
        errors.push(`Format URL invalide: ${url}`);
        continue;
      }

      const filePath = urlObj.pathname.substring(pathIndex + publicPrefix.length);
      console.log('[SUPABASE STORAGE] 🗑️ Deleting:', filePath);

      const { error } = await supabase.storage
        .from(AUDIO_BUCKET)
        .remove([filePath]);

      if (error) {
        console.error('[SUPABASE] Delete error for', filePath, ':', error);
        errors.push(`Erreur suppression: ${filePath}`);
      } else {
        deleted++;
        console.log('[SUPABASE STORAGE] ✅ Deleted:', filePath);
      }
    } catch (err) {
      console.error('[SUPABASE] Delete exception:', err);
      errors.push(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  return {
    success: errors.length === 0,
    deleted,
    errors,
  };
}

/**
 * List all audio files in a session folder
 */
export async function listSessionFiles(sessionId: string): Promise<string[]> {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .list(sessionId);

    if (error) {
      console.error('[SUPABASE] List error:', error);
      return [];
    }

    return data.map(file => `${sessionId}/${file.name}`);
  } catch (err) {
    console.error('[SUPABASE] List exception:', err);
    return [];
  }
}

// ============================================
// REALTIME CHANNEL FUNCTIONS
// ============================================

export type RealtimeEventType = 
  | 'CMD_MUTE_USER'
  | 'CMD_UNMUTE_USER'
  | 'CMD_EJECT_USER'
  | 'CMD_VOLUME_CHANGE'
  | 'SYNC_PLAYLIST'
  | 'SYNC_PLAYBACK'
  | 'USER_JOINED'
  | 'USER_LEFT';

export interface RealtimePayload {
  type: RealtimeEventType;
  senderId: string;
  targetUserId?: string;
  data?: unknown;
  timestamp: number;
}

// Métadonnées de présence trackées par chaque client sur le canal de session
export interface PresenceMeta {
  userId: string;
  nickname: string;
  isHost: boolean;
  avatar?: string; // URL (compte) ou data URL (anonyme)
}

export interface SessionPresence {
  meta: PresenceMeta;
  onSync: (users: PresenceMeta[]) => void;
}

/**
 * Create a Supabase Realtime channel for a session
 * Si `presence` est fourni : track la présence du client et notifie la liste à jour.
 */
export function createSessionChannel(
  sessionId: string,
  onMessage: (payload: RealtimePayload) => void,
  presence?: SessionPresence
): RealtimeChannel | null {
  if (!supabase) {
    console.warn('[SUPABASE] Not configured, using fallback');
    return null;
  }

  const channelName = `session:${sessionId}`;

  const channel = supabase.channel(channelName, {
    config: {
      broadcast: { self: false }, // Don't receive own messages
      presence: { key: presence?.meta.userId || '' },
    },
  });

  // Listen for broadcast messages
  channel.on('broadcast', { event: 'session_event' }, ({ payload }) => {
    onMessage(payload as RealtimePayload);
  });

  // Présence : agréger l'état et notifier sur sync/join/leave
  if (presence) {
    const emitPresence = () => {
      const stateMap = channel.presenceState<PresenceMeta>();
      const users: PresenceMeta[] = [];
      Object.values(stateMap).forEach((entries) => {
        entries.forEach((entry) => {
          users.push({
            userId: entry.userId,
            nickname: entry.nickname,
            isHost: entry.isHost,
            avatar: entry.avatar,
          });
        });
      });
      presence.onSync(users);
    };

    channel.on('presence', { event: 'sync' }, emitPresence);
    channel.on('presence', { event: 'join' }, emitPresence);
    channel.on('presence', { event: 'leave' }, emitPresence);
  }

  // Subscribe to channel, puis track la présence une fois connecté
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && presence) {
      channel.track(presence.meta);
    }
  });

  return channel;
}

/**
 * Send a broadcast message to all session participants
 */
export async function broadcastToSession(
  channel: RealtimeChannel,
  payload: RealtimePayload
): Promise<boolean> {
  try {
    await channel.send({
      type: 'broadcast',
      event: 'session_event',
      payload,
    });
    console.log('[SUPABASE REALTIME] Broadcast sent:', payload.type);
    return true;
  } catch (err) {
    console.error('[SUPABASE REALTIME] Broadcast error:', err);
    return false;
  }
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribeChannel(channel: RealtimeChannel): Promise<void> {
  if (!supabase) return;
  
  try {
    await supabase.removeChannel(channel);
    console.log('[SUPABASE REALTIME] Channel removed');
  } catch (err) {
    console.error('[SUPABASE REALTIME] Unsubscribe error:', err);
  }
}

// ============================================
// DATABASE FUNCTIONS (for playlist persistence)
// ============================================

export interface SharedMedia {
  type: 'video' | 'image' | 'youtube' | 'vimeo' | 'link';
  url: string;
  title?: string;
  isPlaying?: boolean;
  currentTime?: number;
  updatedAt?: number;
}

export interface PlaylistRecord {
  id?: string;
  session_id: string;
  tracks: Array<{
    id: number;
    title: string;
    artist: string;
    src: string;
    uploaded?: boolean;
  }>;
  selected_track_id: number;
  // 🔒 RLS : doit valoir auth.uid() pour que l'UPDATE passe (policy host_id = auth.uid()). Sans lui, la
  //    ligne est créée avec host_id NULL puis tout UPDATE est REFUSÉ → la playlist ne se sauvegarde plus.
  host_id?: string | null;
  description?: string | null;
  shared_media?: SharedMedia | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Upload d'une photo de profil vers le bucket "avatars" (auth utilisateur requise).
 * Renvoie l'URL publique.
 */
export async function uploadAvatar(file: Blob, userId: string): Promise<{ url?: string; error?: string }> {
  if (!supabase || !supabaseUrl || !supabaseAnonKey) return { error: 'Supabase non configuré' };
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token || supabaseAnonKey;
    const contentType = file.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `${userId}/${Date.now()}.${ext}`;
    const res = await fetch(`${supabaseUrl}/storage/v1/object/avatars/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: file,
    });
    if (!res.ok) {
      return { error: `Upload échoué (${res.status})` };
    }
    return { url: `${supabaseUrl}/storage/v1/object/public/avatars/${path}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur upload avatar' };
  }
}

/**
 * Upload d'une image de session vers le bucket "session-media" (auth utilisateur requise).
 */
export async function uploadSessionImage(file: File, sessionId: string): Promise<{ url?: string; error?: string }> {
  if (!supabase || !supabaseUrl || !supabaseAnonKey) return { error: 'Supabase non configuré' };
  if (!file.type.startsWith('image/')) return { error: 'Image requise' };
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token || supabaseAnonKey;
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${sessionId}/${Date.now()}_${safe}`;
    const res = await fetch(`${supabaseUrl}/storage/v1/object/session-media/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': file.type || 'image/jpeg',
        'x-upsert': 'true',
      },
      body: file,
    });
    if (!res.ok) return { error: `Upload échoué (${res.status})` };
    return { url: `${supabaseUrl}/storage/v1/object/public/session-media/${path}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur upload image' };
  }
}

/**
 * Item 7 : Upload RÉSUMABLE (TUS) d'une vidéo de session vers le bucket "session-media".
 * L'upload standard est plafonné (~50 Mo) côté serveur, ce qui faisait échouer les grosses
 * vidéos (bloqué à "Envoi 0%"). TUS supporte les gros fichiers (bucket réglé à 5 Go) et la
 * vraie progression. Ne transite PAS par le backend. Insère ensuite une ligne session_media
 * (owner_id = auth.uid()) pour la suppression auto 24h.
 */
export interface VideoUploadProgress {
  pct: number;          // 0–100
  sentBytes: number;
  totalBytes: number;
  bytesPerSec: number;  // débit observé
  etaSeconds: number;   // temps restant estimé
}

export async function uploadSessionVideoDirect(
  file: File,
  sessionId: string,
  onProgress?: (p: VideoUploadProgress) => void,
): Promise<{ url?: string; error?: string }> {
  if (!supabase || !supabaseUrl || !supabaseAnonKey) return { error: 'Supabase non configuré' };
  try {
    // Bug 1 : le serveur résumable exige un JWT utilisateur VALIDE (sinon 403 "Invalid Compact JWS").
    // → on récupère une session FRAÎCHE juste avant l'upload.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const userId = session?.user?.id;
    if (!token || token.trim() === '' || !userId) {
      return { error: 'Reconnecte-toi pour partager une vidéo' };
    }

    const safe = (file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)) || 'video.mp4';
    const objectName = `${sessionId}/${userId}/${Date.now()}_${safe}`;
    const startTime = Date.now(); // Item 2 : pour estimer le débit et le temps restant

    const publicUrl = await new Promise<string>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        headers: {
          // JWT utilisateur (PAS la clé anon) → indispensable pour passer l'auth du serveur résumable
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey as string,
          'x-upsert': 'true',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        // Item 2 : gros morceaux (~25 Mo) → moins d'allers-retours → upload plus rapide sur gros fichiers
        chunkSize: 25 * 1024 * 1024,
        metadata: {
          bucketName: 'session-media',
          objectName,
          contentType: file.type || 'video/mp4',
          cacheControl: '3600',
        },
        // Ne PAS réessayer en boucle sur une erreur 4xx (auth/validation) → on échoue vite et clair
        onShouldRetry: (err) => {
          const status = (err as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.() ?? 0;
          if (status === 400 || status === 401 || status === 403) return false;
          return true;
        },
        onError: (err) => {
          // Bug 1 : NE PAS rester à 0% → remonter l'erreur réelle (corps de réponse serveur si dispo)
          console.error('[TUS upload]', err);
          let body = '';
          try { body = (err as { originalResponse?: { getBody?: () => string } })?.originalResponse?.getBody?.() || ''; } catch { /* ignore */ }
          const msg = body || (err instanceof Error ? err.message : String(err)) || 'Échec de l\'envoi de la vidéo';
          reject(new Error(msg));
        },
        onProgress: (sent, total) => {
          if (!total || !onProgress) return;
          const elapsed = (Date.now() - startTime) / 1000;
          const bytesPerSec = elapsed > 0 ? sent / elapsed : 0;
          const etaSeconds = bytesPerSec > 0 ? (total - sent) / bytesPerSec : 0;
          onProgress({ pct: Math.round((sent / total) * 100), sentBytes: sent, totalBytes: total, bytesPerSec, etaSeconds });
        },
        onSuccess: () => {
          resolve(`${supabaseUrl}/storage/v1/object/public/session-media/${objectName}`);
        },
      });
      upload.start();
    });

    // Ligne session_media (RLS : owner_id = auth.uid()) → suppression auto 24h côté backend
    await supabase.from('session_media').insert({
      owner_id: userId,
      session_id: sessionId,
      storage_path: objectName,
      url: publicUrl,
      media_type: 'video',
      created_at: new Date().toISOString(),
    });

    return { url: publicUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur upload vidéo' };
  }
}

/**
 * Met à jour la description courte de la session (playlists.description).
 */
export async function saveSessionDescription(sessionId: string, description: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('playlists')
    .upsert({ session_id: sessionId, description, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
  return !error;
}

/**
 * Met à jour le média partagé de la session (playlists.shared_media, jsonb).
 */
export async function saveSharedMedia(sessionId: string, sharedMedia: SharedMedia | null): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('playlists')
    .upsert({ session_id: sessionId, shared_media: sharedMedia, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
  return !error;
}

/**
 * Salle d'attente : active/désactive le mode "session privée" (playlists.is_private).
 * L'écriture est protégée côté serveur par la policy RLS (hôte/co-hôte uniquement).
 */
export async function saveSessionPrivacy(sessionId: string, isPrivate: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('playlists')
    .upsert({ session_id: sessionId, is_private: isPrivate, updated_at: new Date().toISOString() }, { onConflict: 'session_id' });
  return !error;
}

/**
 * Save playlist to database
 */
export async function savePlaylist(playlist: PlaylistRecord): Promise<boolean> {
  if (!supabase) {
    console.warn('[SUPABASE] Not configured, playlist not saved');
    return false;
  }

  try {
    // 🔒 host_id inclus quand fourni → INSERT/UPDATE conformes à la RLS (host_id = auth.uid()).
    const row: Record<string, unknown> = {
      session_id: playlist.session_id,
      tracks: playlist.tracks,
      selected_track_id: playlist.selected_track_id,
      updated_at: new Date().toISOString(),
    };
    if (playlist.host_id) row.host_id = playlist.host_id;
    const { error } = await supabase
      .from('playlists')
      .upsert(row, { onConflict: 'session_id' });

    if (error) {
      console.error('[SUPABASE] Save playlist error:', error);
      return false;
    }

    console.log('[SUPABASE] Playlist saved');
    return true;
  } catch (err) {
    console.error('[SUPABASE] Save playlist exception:', err);
    return false;
  }
}

/**
 * Vérifie l'EXISTENCE d'une session en base (ligne `playlists` pour ce session_id).
 * Retourne :
 *   - true  → la session existe
 *   - false → la session n'existe pas / plus (supprimée par l'hôte, code invalide)
 *   - null  → impossible de savoir (Supabase non configuré, erreur réseau/RLS) → NE PAS bloquer l'entrée
 */
export async function sessionExists(sessionId: string): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const { count, error } = await supabase
      .from('playlists')
      .select('session_id', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    if (error) return null; // en cas d'erreur on n'empêche pas l'entrée (tolérant)
    return (count ?? 0) > 0;
  } catch {
    return null;
  }
}

/**
 * Load playlist from database
 */
export async function loadPlaylist(sessionId: string): Promise<PlaylistRecord | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('playlists')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') { // Not found is ok
        console.error('[SUPABASE] Load playlist error:', error);
      }
      return null;
    }

    return data as PlaylistRecord;
  } catch (err) {
    console.error('[SUPABASE] Load playlist exception:', err);
    return null;
  }
}

export default supabase;
