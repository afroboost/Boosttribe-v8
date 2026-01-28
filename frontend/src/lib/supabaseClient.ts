import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

// Environment variables
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const storageBucket = process.env.REACT_APP_SUPABASE_BUCKET || 'audio-tracks';

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
 * Uses raw File object directly - SDK handles everything
 */
export async function uploadAudioFile(
  file: File,
  sessionId: string,
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  // Check Supabase client
  if (!supabase) {
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

  console.log('[SUPABASE STORAGE] 📤 Upload:', filePath);

  try {
    // SIMPLE SDK CALL - Let Supabase handle the file directly
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(filePath, file);

    // Handle error
    if (error) {
      console.error('[SUPABASE STORAGE] ❌ Erreur:', error.message);
      
      const errMsg = error.message.toLowerCase();
      
      if (errMsg.includes('not found') || errMsg.includes('bucket')) {
        logBucketConfigInstructions();
        return { success: false, error: 'Bucket introuvable. Vérifiez Supabase Dashboard.' };
      }
      
      if (errMsg.includes('policy') || errMsg.includes('permission') || errMsg.includes('403')) {
        logBucketConfigInstructions();
        return { success: false, error: 'Permission refusée. Vérifiez les policies RLS.' };
      }
      
      if (errMsg.includes('duplicate') || errMsg.includes('already exists')) {
        return { success: false, error: 'Fichier déjà existant.' };
      }
      
      return { success: false, error: error.message };
    }

    // Success - get public URL
    if (data?.path) {
      const { data: urlData } = supabase.storage
        .from(AUDIO_BUCKET)
        .getPublicUrl(data.path);

      console.log('[SUPABASE STORAGE] ✅ Upload réussi:', urlData.publicUrl);

      return {
        success: true,
        url: urlData.publicUrl,
        path: data.path,
      };
    }

    return { success: false, error: 'Réponse inattendue du serveur.' };
    
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

/**
 * Create a Supabase Realtime channel for a session
 */
export function createSessionChannel(
  sessionId: string,
  onMessage: (payload: RealtimePayload) => void
): RealtimeChannel | null {
  if (!supabase) {
    console.warn('[SUPABASE] Not configured, using fallback');
    return null;
  }

  const channelName = `session:${sessionId}`;
  
  const channel = supabase.channel(channelName, {
    config: {
      broadcast: { self: false }, // Don't receive own messages
    },
  });

  // Listen for broadcast messages
  channel.on('broadcast', { event: 'session_event' }, ({ payload }) => {
    console.log('[SUPABASE REALTIME] Received:', payload);
    onMessage(payload as RealtimePayload);
  });

  // Subscribe to channel
  channel.subscribe((status) => {
    console.log('[SUPABASE REALTIME] Channel status:', status);
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
  created_at?: string;
  updated_at?: string;
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
    const { error } = await supabase
      .from('playlists')
      .upsert({
        session_id: playlist.session_id,
        tracks: playlist.tracks,
        selected_track_id: playlist.selected_track_id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id',
      });

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
