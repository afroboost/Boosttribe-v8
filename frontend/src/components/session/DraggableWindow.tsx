import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Move, Minus, Maximize2 } from 'lucide-react';

interface DraggableWindowProps {
  title: string;
  storageKey?: string;       // mémorise la dernière position
  defaultWidth?: number;
  children: React.ReactNode;
}

// 🪟 Fenêtre flottante déplaçable (doigt + souris) contrainte dans le viewport,
// avec poignée de déplacement et bouton réduire/agrandir. Utilisée sur mobile pour le Live Visio.
export const DraggableWindow: React.FC<DraggableWindowProps> = ({
  title, storageKey, defaultWidth = 280, children,
}) => {
  const winRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved;
      } catch { /* ignore */ }
    }
    // par défaut : en haut à droite
    const x = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - defaultWidth - 12) : 12;
    return { x, y: 80 };
  });
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const el = winRef.current;
    const w = el?.offsetWidth ?? defaultWidth;
    const h = el?.offsetHeight ?? 200;
    const maxX = Math.max(0, window.innerWidth - w - 4);
    const maxY = Math.max(0, window.innerHeight - h - 4);
    return { x: Math.min(Math.max(4, x), maxX), y: Math.min(Math.max(4, y), maxY) };
  }, [defaultWidth]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = winRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const next = clamp(e.clientX - dragRef.current.dx, e.clientY - dragRef.current.dy);
    setPos(next);
  }, [clamp]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch { /* ignore */ } }
  }, [pos, storageKey]);

  // Garder la fenêtre dans l'écran au resize/rotation
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  return (
    <div
      ref={winRef}
      className="fixed z-[80] rounded-2xl border border-[#8A2EFF]/40 bg-[rgba(15,15,20,0.97)] shadow-2xl shadow-[#8A2EFF]/20 backdrop-blur-sm overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: defaultWidth, maxWidth: 'calc(100vw - 16px)' }}
      data-testid="draggable-window"
    >
      {/* Poignée de déplacement */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center justify-between gap-2 px-3 py-2 cursor-move touch-none select-none border-b border-white/10"
        style={{ background: 'linear-gradient(135deg, rgba(138,46,255,0.25) 0%, rgba(255,47,179,0.18) 100%)' }}
        data-testid="drag-handle"
      >
        <span className="flex items-center gap-1.5 text-white text-xs font-semibold truncate">
          <Move className="w-3.5 h-3.5 flex-shrink-0" /> {title}
        </span>
        <button
          onClick={() => setMinimized((m) => !m)}
          className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 flex-shrink-0"
          title={minimized ? 'Agrandir' : 'Réduire'}
          data-testid="window-toggle-size"
        >
          {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!minimized && (
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      )}
    </div>
  );
};

export default DraggableWindow;
