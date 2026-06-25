import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Heart, Send, Trash2, MessageCircle } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CommentRow {
  id: string | number;
  session_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

interface SessionSocialProps {
  sessionId: string;
}

// Avatar rond (image ou initiales)
const SocialAvatar: React.FC<{ url?: string | null; name?: string | null }> = ({ url, name }) => (
  <div className="w-7 h-7 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
    {url ? (
      <img src={url} alt="" className="w-full h-full object-cover" />
    ) : (
      <span className="text-white/50 text-[10px]">{(name || '?').slice(0, 2).toUpperCase()}</span>
    )}
  </div>
);

export const SessionSocial: React.FC<SessionSocialProps> = ({ sessionId }) => {
  const { user, profile, isAuthenticated } = useAuth();
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, { name: string; avatar: string | null }>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const authorsRef = useRef(authors);
  authorsRef.current = authors;

  // Récupère les noms/avatars des auteurs manquants
  const fetchAuthors = useCallback(async (userIds: string[]) => {
    if (!supabase) return;
    const missing = userIds.filter((id) => id && !authorsRef.current[id]);
    if (missing.length === 0) return;
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', missing);
      if (data) {
        setAuthors((prev) => {
          const next = { ...prev };
          (data as { id: string; full_name: string | null; avatar_url: string | null }[]).forEach((p) => {
            next[p.id] = { name: p.full_name || 'Invité', avatar: p.avatar_url };
          });
          return next;
        });
      }
    } catch { /* profils non lisibles → fallback initiales */ }
  }, []);

  // Chargement initial likes + commentaires
  const loadLikes = useCallback(async () => {
    if (!supabase) return;
    const { count } = await supabase
      .from('session_likes')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);
    setLikeCount(count || 0);
    if (user?.id) {
      const { data } = await supabase
        .from('session_likes')
        .select('user_id')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();
      setLiked(!!data);
    }
  }, [sessionId, user?.id]);

  const loadComments = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('session_comments')
      .select('id, session_id, user_id, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    const rows = (data || []) as CommentRow[];
    setComments(rows);
    fetchAuthors(rows.map((r) => r.user_id));
  }, [sessionId, fetchAuthors]);

  useEffect(() => {
    if (!supabase || !sessionId) return;
    loadLikes();
    loadComments();

    const channel = supabase
      .channel(`social:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_likes', filter: `session_id=eq.${sessionId}` }, () => loadLikes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_comments', filter: `session_id=eq.${sessionId}` }, () => loadComments())
      .subscribe();

    return () => { if (supabase) supabase.removeChannel(channel); };
  }, [sessionId, loadLikes, loadComments]);

  const toggleLike = useCallback(async () => {
    if (!supabase || !user?.id) return;
    // Optimiste
    setLiked((v) => !v);
    setLikeCount((c) => (liked ? Math.max(0, c - 1) : c + 1));
    if (liked) {
      await supabase.from('session_likes').delete().eq('session_id', sessionId).eq('user_id', user.id);
    } else {
      await supabase.from('session_likes').insert({ session_id: sessionId, user_id: user.id });
    }
  }, [liked, sessionId, user?.id]);

  const addComment = useCallback(async () => {
    const content = draft.trim().slice(0, 500);
    if (!content || !supabase || !user?.id) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('session_comments').insert({ session_id: sessionId, user_id: user.id, content });
      if (!error) setDraft('');
    } finally {
      setBusy(false);
    }
  }, [draft, sessionId, user?.id]);

  const deleteComment = useCallback(async (id: string | number) => {
    if (!supabase || !user?.id) return;
    await supabase.from('session_comments').delete().eq('id', id).eq('user_id', user.id);
  }, [user?.id]);

  const authorFor = (uid: string) => {
    if (user?.id === uid) {
      return { name: profile?.full_name || 'Vous', avatar: profile?.avatar_url || null };
    }
    return authors[uid] || { name: 'Invité', avatar: null };
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3" data-testid="session-social">
      {/* Like */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleLike}
          disabled={!isAuthenticated}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
            liked ? 'bg-pink-500/20 text-pink-400' : 'bg-white/10 text-white/70 hover:bg-white/20'
          } ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
          data-testid="like-btn"
          title={isAuthenticated ? '' : 'Connectez-vous pour aimer'}
        >
          <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} />
          <span className="text-sm font-medium">{likeCount}</span>
        </button>
        <span className="flex items-center gap-1.5 text-white/50 text-sm">
          <MessageCircle className="w-4 h-4" /> {comments.length}
        </span>
      </div>

      {/* Commentaires */}
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="text-white/30 text-xs text-center py-2">Aucun commentaire pour le moment.</p>
        ) : (
          comments.map((c) => {
            const a = authorFor(c.user_id);
            return (
              <div key={c.id} className="flex items-start gap-2">
                <SocialAvatar url={a.avatar} name={a.name} />
                <div className="flex-1 min-w-0 rounded-lg bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/80 text-xs font-medium truncate">{a.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-white/30 text-[10px]">{new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {user?.id === c.user_id && (
                        <button onClick={() => deleteComment(c.id)} className="text-white/30 hover:text-red-400" title="Supprimer" data-testid="delete-comment">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-white/70 text-sm break-words whitespace-pre-wrap">{c.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Ajout */}
      {isAuthenticated ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); } }}
            placeholder="Ajouter un commentaire…"
            maxLength={500}
            className="flex-1 min-w-0 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
          />
          <Button onClick={addComment} disabled={busy || !draft.trim()} className="text-white border-none flex-shrink-0" style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <p className="text-white/40 text-xs text-center">Connectez-vous pour aimer et commenter.</p>
      )}
    </div>
  );
};

export default SessionSocial;
