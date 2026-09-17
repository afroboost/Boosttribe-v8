import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

/**
 * ⋮ Menu des actions SECONDAIRES du live (hôte).
 *
 * Pourquoi : la barre du bas alignait 6-7 boutons texte sur deux rangées (« Sources »,
 * « Prompteur », « Plein écran », « Interval training », « Quitter le live »…). L'écran
 * principal doit montrer la vidéo et 2-3 commandes essentielles ; tout le reste se range ici.
 *
 * Contrat :
 * - `items` dans l'ordre d'affichage ; un item `danger` (Quitter) est séparé et rouge.
 * - ancré en `fixed` (calculé depuis le bouton) : `LiveVisioPanel` est `overflow-hidden`,
 *   un menu `absolute` y serait rogné.
 * - fermeture : clic dehors, Échap, ou après un item ; `aria-expanded` / `role="menu"`.
 * - aucun état métier ici : 100 % piloté par les rappels du parent.
 */
export interface MenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Bascule (ex. prompteur) : l'état actif est rendu en accent + `aria-checked`. */
  active?: boolean;
  /** Action destructive (Quitter) : séparateur au-dessus, rouge, toujours en dernier. */
  danger?: boolean;
  /** Identifiant de test conservé des anciens boutons (bancs structurels). */
  testId?: string;
  /** Rendu libre à la place du libellé (ex. réglage « Embellir » avec ses niveaux). */
  node?: React.ReactNode;
  /** Un item à `node` reste ouvert par défaut (réglage en place) ; `fermeApres` force la fermeture. */
  fermeApres?: boolean;
}

interface MenuActionsProps {
  items: MenuAction[];
  /** Classes du bouton rond — on réutilise ROUND/DARK du parent pour rester homogène. */
  buttonClassName: string;
  label?: string;
}

export const MenuActions: React.FC<MenuActionsProps> = ({ items, buttonClassName, label = 'Plus d’actions' }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ bottom: number; right: number }>({ bottom: 0, right: 0 });

  // Position : au-dessus du bouton, aligné à droite, en coordonnées fenêtre (fixed), bornée
  // dans la fenêtre. Suivie tant que le menu est ouvert : la tuile vidéo change encore de
  // hauteur quand le flux démarre, une mesure unique à l'ouverture laissait le menu décalé.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    let raf = 0;
    const placer = () => {
      const btn = btnRef.current; if (!btn) return;
      const r = btn.getBoundingClientRect();
      const largeur = menuRef.current?.offsetWidth ?? 220;
      const bottom = Math.max(8, Math.round(window.innerHeight - r.top + 8));
      const right = Math.min(Math.max(8, Math.round(window.innerWidth - r.right)), Math.max(8, window.innerWidth - largeur - 8));
      setPos((p) => (p.bottom === bottom && p.right === right ? p : { bottom, right }));
    };
    placer();
    raf = requestAnimationFrame(placer);
    window.addEventListener('resize', placer);
    window.addEventListener('scroll', placer, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placer) : null;
    ro?.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', placer);
      window.removeEventListener('scroll', placer, true);
      ro?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const normaux = items.filter((i) => !i.danger);
  const dangers = items.filter((i) => i.danger);

  const rendre = (it: MenuAction) => (
    <button
      key={it.id}
      type="button"
      role={it.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={it.active === undefined ? undefined : it.active}
      onClick={() => { it.onSelect(); if (!it.node || it.fermeApres) setOpen(false); }}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left rounded-lg transition-colors ${
        it.danger
          ? 'text-red-300 hover:bg-red-500/15'
          : it.active
            ? 'bg-[rgb(var(--bt-accent-rgb)/0.18)] text-[var(--bt-accent)]'
            : 'text-white/85 hover:bg-white/10'
      }`}
      data-testid={it.testId}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0">{it.icon}</span>
      {it.node ?? <span className="flex-1">{it.label}</span>}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="visio-menu"
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="fixed z-[140] min-w-[220px] max-w-[calc(100vw-1rem)] p-1.5 rounded-2xl border border-white/10 bg-[#0b0b10]/95 backdrop-blur-md shadow-2xl shadow-black/50"
          style={{ bottom: pos.bottom, right: pos.right }}
          data-testid="visio-menu-liste"
        >
          {normaux.map(rendre)}
          {dangers.length > 0 && normaux.length > 0 && <div className="my-1 h-px bg-white/10" role="separator" />}
          {dangers.map(rendre)}
        </div>
      )}
    </>
  );
};

export default MenuActions;
