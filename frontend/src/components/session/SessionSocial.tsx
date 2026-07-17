import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { Heart, Send, Trash2, MessageCircle, X, LogIn } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProfilePhoto } from '@/components/session/ProfilePhoto';
import { useToast } from '@/components/ui/Toast';

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

export const SessionSocial: React.FC<SessionSocialProps> = ({ sessionId }) => {
  const { user, profile, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  // POINT A : ouvrir la page de connexion et revenir à la session après login
  const goLogin = useCallback(() => {
    navigate('/login', { state: { from: location.pathname + location.search } });
  }, [navigate, location.pathname, location.search]);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, { name: string; avatar: string | null }>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false); // modale style Instagram
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
    if (!supabase) return;
    if (!user?.id) { showToast('Connectez-vous pour aimer cette session', 'warning'); return; }
    const wasLiked = liked;
    // Optimiste
    setLiked(!wasLiked);
    setLikeCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
    const { error } = wasLiked
      ? await supabase.from('session_likes').delete().eq('session_id', sessionId).eq('user_id', user.id)
      : await supabase.from('session_likes').insert({ session_id: sessionId, user_id: user.id });
    if (error) {
      // rollback + message clair (souvent un RLS manquant sur session_likes)
      setLiked(wasLiked);
      setLikeCount((c) => (wasLiked ? c + 1 : Math.max(0, c - 1)));
      console.error('[LIKE] error', error);
      showToast(`Like impossible : ${error.message}`, 'error');
    }
  }, [liked, sessionId, user?.id, showToast]);

  const addComment = useCallback(async () => {
    const content = draft.trim().slice(0, 500);
    if (!content || !supabase) return;
    if (!user?.id) { showToast('Connectez-vous pour commenter', 'warning'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('session_comments').insert({ session_id: sessionId, user_id: user.id, content });
      if (error) {
        console.error('[COMMENT] error', error);
        showToast(`Commentaire impossible : ${error.message}`, 'error');
      } else {
        setDraft('');
      }
    } finally {
      setBusy(false);
    }
  }, [draft, sessionId, user?.id, showToast]);

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

  // Champ d'ajout (réutilisé dans la modale)
  const composer = isAuthenticated ? (
    <div className="flex gap-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); } }}
        placeholder="Ajouter un commentaire…"
        maxLength={500}
        className="flex-1 min-w-0 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
      />
      <Button onClick={addComment} disabled={busy || !draft.trim()} className="text-white border-none flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
        <Send className="w-4 h-4" />
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 text-center py-1">
      <p className="text-white/60 text-xs">Connecte-toi pour aimer et commenter</p>
      <button
        onClick={goLogin}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
        data-testid="social-login-btn"
      >
        <LogIn className="w-3.5 h-3.5" /> Se connecter / Créer un compte
      </button>
    </div>
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2.5" data-testid="session-social">
      {/* Vue compacte : Like + bouton Commentaires (ouvre la modale) */}
      <div className="flex items-center gap-3">
        <button
          onClick={isAuthenticated ? toggleLike : goLogin}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
            liked ? 'bg-[rgb(var(--bt-accent-2-rgb)/0.2)] text-[var(--bt-accent-2)]' : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          data-testid="like-btn"
          title={isAuthenticated ? '' : 'Connecte-toi pour aimer'}
        >
          <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} />
          <span className="text-sm font-medium">{likeCount}</span>
        </button>

        <button
          onClick={() => setCommentsOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          data-testid="comments-open-btn"
          title="Voir les commentaires"
        >
          <MessageCircle className="w-4 h-4" />
          <span className="text-sm font-medium">{comments.length}</span>
        </button>
      </div>

      {/* POINT A : invite de connexion claire (utilisateur non connecté) */}
      {!isAuthenticated && composer}

      {/* Modale commentaires (style Instagram) — par-dessus la page, via portail */}
      {commentsOpen && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setCommentsOpen(false)}
          data-testid="comments-modal"
        >
          <div
            className="w-full sm:max-w-md max-h-[85vh] sm:max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#14141A] shadow-2xl shadow-[rgb(var(--bt-accent-rgb)/0.1)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-[var(--bt-accent)]" />
                Commentaires
                <span className="text-white/40 text-sm font-normal">({comments.length})</span>
              </h3>
              <button onClick={() => setCommentsOpen(false)} className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10" title="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {comments.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-8">Aucun commentaire pour le moment.<br />Soyez le premier à écrire ✍️</p>
              ) : (
                comments.map((c) => {
                  const a = authorFor(c.user_id);
                  return (
                    <div key={c.id} className="flex items-start gap-2.5">
                      <ProfilePhoto url={a.avatar} name={a.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white text-sm font-semibold truncate">{a.name}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-white/30 text-[10px]">{new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {user?.id === c.user_id && (
                              <button onClick={() => deleteComment(c.id)} className="text-white/30 hover:text-red-400" title="Supprimer" data-testid="delete-comment">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-white/75 text-sm break-words whitespace-pre-wrap mt-0.5">{c.content}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Composer (collé en bas) */}
            <div className="px-4 py-3 border-t border-white/10">
              {composer}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default SessionSocial;
