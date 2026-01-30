import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Music, Play, Trash2, Check } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface Track {
  id: number;
  title: string;
  artist: string;
  src: string;
  coverArt?: string;
}

interface SortableTrackItemProps {
  track: Track;
  isSelected: boolean;
  onSelect: (track: Track) => void;
  isHost: boolean;
  isEditMode: boolean;
  isChecked: boolean;
  onToggleCheck: (trackId: number) => void;
  onDeleteSingle: (track: Track) => void;
}

const SortableTrackItem: React.FC<SortableTrackItemProps> = ({
  track,
  isSelected,
  onSelect,
  isHost,
  isEditMode,
  isChecked,
  onToggleCheck,
  onDeleteSingle,
}) => {
  // 🔒 PARTICIPANT: Désactive complètement le drag-and-drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: !isHost || isEditMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 rounded-lg transition-all group
        ${isSelected 
          ? 'bg-white/10 border border-[#8A2EFF]/50' 
          : 'bg-[var(--bt-surface-alpha)] border border-white/10 hover:bg-white/5'
        }
        ${isDragging ? 'shadow-lg shadow-[#8A2EFF]/20 z-50' : ''}
      `}
      data-testid={`track-item-${track.id}`}
    >
      {/* 🔒 Edit Mode: Checkbox - HOST ONLY */}
      {isEditMode && isHost && (
        <button
          onClick={() => onToggleCheck(track.id)}
          className={`
            w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all
            ${isChecked 
              ? 'bg-[#8A2EFF] border-[#8A2EFF]' 
              : 'border-white/30 hover:border-white/50'
            }
          `}
          data-testid={`checkbox-track-${track.id}`}
        >
          {isChecked && <Check size={12} strokeWidth={3} className="text-white" />}
        </button>
      )}

      {/* 🔒 Drag Handle - HOST ONLY, SUPPRIMÉ DU DOM pour participants */}
      {isHost && !isEditMode && (
        <button
          {...attributes}
          {...listeners}
          className="p-1 text-white/30 hover:text-white/60 cursor-grab active:cursor-grabbing touch-none"
          data-testid={`drag-handle-${track.id}`}
        >
          <GripVertical size={16} strokeWidth={1.5} />
        </button>
      )}

      {/* Track Info - Cliquable pour l'hôte seulement */}
      <div
        onClick={() => isHost && !isEditMode && onSelect(track)}
        className={`flex-1 flex items-center gap-3 text-left ${isHost && !isEditMode ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Cover Art */}
        <div 
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
        >
          {isSelected ? (
            <Play size={18} strokeWidth={1.5} className="text-white ml-0.5" fill="currentColor" />
          ) : (
            <Music size={18} strokeWidth={1.5} className="text-white/80" />
          )}
        </div>

        {/* Title & Artist */}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate text-sm">{track.title}</p>
          <p className="text-white/50 text-xs truncate">{track.artist}</p>
        </div>
      </div>

      {/* 🔒 Delete Button - HOST ONLY, SUPPRIMÉ DU DOM pour participants */}
      {isHost && !isEditMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSingle(track);
          }}
          className="bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white p-2 rounded-lg transition-all flex-shrink-0 visible"
          style={{ color: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.2)' }}
          title="Supprimer cette piste"
          data-testid={`delete-track-${track.id}`}
          aria-label={`Supprimer ${track.title}`}
        >
          <Trash2 size={18} strokeWidth={2} />
        </button>
      )}

      {/* Selected Indicator - hidden in edit mode */}
      {isSelected && !isEditMode && (
        <div 
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: '#8A2EFF' }}
        />
      )}
    </div>
  );
};

interface PlaylistDnDProps {
  tracks: Track[];
  selectedTrack: Track | null;
  onTrackSelect: (track: Track) => void;
  onReorder: (tracks: Track[]) => void;
  onDeleteTracks: (tracks: Track[]) => void;
  isHost: boolean;
  maxTracks?: number;
}

export const PlaylistDnD: React.FC<PlaylistDnDProps> = ({
  tracks,
  selectedTrack,
  onTrackSelect,
  onReorder,
  onDeleteTracks,
  isHost,
  maxTracks = 10,
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tracks.findIndex((t) => t.id === active.id);
      const newIndex = tracks.findIndex((t) => t.id === over.id);
      const newTracks = arrayMove(tracks, oldIndex, newIndex);
      onReorder(newTracks);
    }
  };

  const handleToggleCheck = useCallback((trackId: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  const handleDeleteSingle = useCallback((track: Track) => {
    if (window.confirm(`Supprimer "${track.title}" ?`)) {
      onDeleteTracks([track]);
    }
  }, [onDeleteTracks]);

  const handleDeleteSelected = useCallback(() => {
    const selectedTracks = tracks.filter(t => checkedIds.has(t.id));
    if (selectedTracks.length === 0) return;

    const message = selectedTracks.length === 1
      ? `Supprimer "${selectedTracks[0].title}" ?`
      : `Supprimer ${selectedTracks.length} titres ?`;

    if (window.confirm(message)) {
      onDeleteTracks(selectedTracks);
      setCheckedIds(new Set());
      setIsEditMode(false);
    }
  }, [tracks, checkedIds, onDeleteTracks]);

  const handleExitEditMode = useCallback(() => {
    setIsEditMode(false);
    setCheckedIds(new Set());
  }, []);

  // Limit tracks display
  const displayTracks = tracks.slice(0, maxTracks);
  const hasChecked = checkedIds.size > 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-white/50 text-xs">
          {displayTracks.length} / {maxTracks} titres
          {/* 🔒 Indicateur pour les participants */}
          {!isHost && displayTracks.length > 0 && (
            <span className="ml-2 text-purple-400">(lecture seule)</span>
          )}
        </p>
        
        {/* 🔒 Edit Mode Controls - HOST ONLY, SUPPRIMÉ DU DOM pour participants */}
        {isHost && displayTracks.length > 0 && (
          <div className="flex items-center gap-2">
            {isEditMode ? (
              <>
                {/* Delete Selected Button - Only when items checked */}
                {hasChecked && (
                  <button
                    onClick={handleDeleteSelected}
                    className="text-xs px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md transition-colors"
                    data-testid="delete-selected-btn"
                  >
                    Supprimer ({checkedIds.size})
                  </button>
                )}
                <button
                  onClick={handleExitEditMode}
                  className="text-xs px-3 py-1.5 text-white/50 hover:text-white/70 hover:bg-white/10 rounded-md transition-colors"
                  data-testid="cancel-edit-btn"
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditMode(true)}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow-lg text-xs transition-all"
                style={{ backgroundColor: '#8A2EFF', color: 'white', fontWeight: 'bold' }}
                data-testid="edit-mode-btn"
              >
                Modifier
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Playlist */}
      <ScrollArea className="h-[400px] pr-2 playlist-scroll">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayTracks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {displayTracks.map((track) => (
                <SortableTrackItem
                  key={track.id}
                  track={track}
                  isSelected={selectedTrack?.id === track.id}
                  onSelect={onTrackSelect}
                  isHost={isHost}
                  isEditMode={isEditMode}
                  isChecked={checkedIds.has(track.id)}
                  onToggleCheck={handleToggleCheck}
                  onDeleteSingle={handleDeleteSingle}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </ScrollArea>
    </div>
  );
};

export default PlaylistDnD;
