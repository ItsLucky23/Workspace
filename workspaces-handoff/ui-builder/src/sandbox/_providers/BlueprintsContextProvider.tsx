import { createContext, useContext, useState, ReactNode, SetStateAction, Dispatch, useEffect, useCallback, useRef } from 'react';
import { blueprints, file, note } from '../types/blueprints';

// =============================================================================
// CHANGE TYPES - Operations that can be undone/redone
// =============================================================================
export type GridChange =
  | { type: 'create'; itemType: 'file'; item: file }
  | { type: 'create'; itemType: 'note'; item: note }
  | { type: 'delete'; itemType: 'file'; item: file }
  | { type: 'delete'; itemType: 'note'; item: note };
// Future: | { type: 'move'; itemType: 'file' | 'note'; id: string; from: Position; to: Position }

// =============================================================================
// SYNC EVENT CALLBACKS - Hooks for future coop integration
// =============================================================================
export type SyncEventCallbacks = {
  // Called when local user deletes an item via undo
  // Return false to cancel the delete (e.g., if another user is editing)
  onBeforeDelete?: (change: GridChange) => boolean | Promise<boolean>;

  // Called after a change is applied locally (for socket emission)
  onChangeApplied?: (change: GridChange, direction: 'do' | 'undo' | 'redo') => void;

  // Called when ownership transfer is needed
  // e.g., client1 deletes but client2 is editing -> client2 keeps it
  onOwnershipTransfer?: (itemId: string, newOwnerId: string) => void;
};

type BlueprintsContextType = {
  // Current state (merged: local + remote in future)
  blueprints: blueprints;
  setBlueprints: Dispatch<SetStateAction<blueprints>>;

  // Local state (for initial data and user's own items)
  localBlueprints: blueprints;
  setLocalBlueprints: Dispatch<SetStateAction<blueprints>>;

  // Remote state from other coop users (for future sync)
  remoteBlueprints: blueprints;
  setRemoteBlueprints: Dispatch<SetStateAction<blueprints>>;

  instances: blueprints[];
  setInstances: Dispatch<SetStateAction<blueprints[]>>;

  highlightInstances: boolean;
  setHighlightInstances: Dispatch<SetStateAction<boolean>>;

  // Change-based history
  localChanges: GridChange[];
  changeIndex: number;

  // Actions
  applyChange: (change: GridChange) => void;
  undoChange: () => Promise<void>;
  redoChange: () => void;

  // Sync callbacks registration
  setSyncCallbacks: (callbacks: SyncEventCallbacks) => void;

  // Helpers
  canUndo: boolean;
  canRedo: boolean;
};

const BlueprintsContext = createContext<BlueprintsContextType | undefined>(undefined);

// =============================================================================
// HELPER: Apply a change to blueprints
// =============================================================================
const applyChangeToBlueprints = (bp: blueprints, change: GridChange): blueprints => {
  if (change.type === 'create') {
    if (change.itemType === 'file') {
      return { ...bp, files: [...bp.files, change.item] };
    } else {
      return { ...bp, notes: [...bp.notes, change.item as note] };
    }
  } else if (change.type === 'delete') {
    if (change.itemType === 'file') {
      return { ...bp, files: bp.files.filter(f => f.id !== change.item.id) };
    } else {
      return { ...bp, notes: bp.notes.filter(n => n.id !== (change.item as note).id) };
    }
  }
  return bp;
};

// =============================================================================
// HELPER: Get inverse of a change (for undo)
// =============================================================================
const getInverseChange = (change: GridChange): GridChange => {
  if (change.type === 'create') {
    return { ...change, type: 'delete' };
  } else {
    return { ...change, type: 'create' };
  }
};

// =============================================================================
// PROVIDER
// =============================================================================
export const BlueprintsProvider = ({ children }: { children: ReactNode }) => {
  // Local blueprints (items created/owned by this user)
  const [localBlueprints, setLocalBlueprints] = useState<blueprints>({
    files: [],
    notes: [],
    drawings: [],
  });

  // Remote blueprints from coop users (for future sync)
  const [remoteBlueprints, setRemoteBlueprints] = useState<blueprints>({
    files: [],
    notes: [],
    drawings: [],
  });

  // Merged state for rendering
  const [blueprints, setBlueprints] = useState<blueprints>({
    files: [],
    notes: [],
    drawings: [],
  });

  // Merge local + remote whenever either changes
  useEffect(() => {
    setBlueprints({
      files: [...localBlueprints.files, ...remoteBlueprints.files],
      notes: [...localBlueprints.notes, ...remoteBlueprints.notes],
      drawings: [...localBlueprints.drawings, ...remoteBlueprints.drawings],
    });
  }, [localBlueprints, remoteBlueprints]);

  const [instances, setInstances] = useState<blueprints[]>([]);
  const [highlightInstances, setHighlightInstances] = useState(true);

  // Change-based history (only YOUR changes, not remote)
  const [localChanges, setLocalChanges] = useState<GridChange[]>([]);
  const [changeIndex, setChangeIndex] = useState<number>(-1); // -1 = no changes yet

  // Sync callbacks (registered by sync system)
  const syncCallbacksRef = useRef<SyncEventCallbacks>({});
  const setSyncCallbacks = useCallback((callbacks: SyncEventCallbacks) => {
    syncCallbacksRef.current = callbacks;
  }, []);

  // Apply a new change (create/delete)
  const applyChange = useCallback((change: GridChange) => {
    // Truncate any redo history
    setLocalChanges(prev => [...prev.slice(0, changeIndex + 1), change]);
    setChangeIndex(prev => prev + 1);

    // Apply to local blueprints
    setLocalBlueprints(prev => applyChangeToBlueprints(prev, change));

    // Notify sync system
    syncCallbacksRef.current.onChangeApplied?.(change, 'do');
  }, [changeIndex]);

  // Undo last change
  const undoChange = useCallback(async () => {
    if (changeIndex < 0) return;

    const changeToUndo = localChanges[changeIndex];
    const inverseChange = getInverseChange(changeToUndo);

    // If this is a delete operation (undoing a create), check with sync system
    // This is where ownership transfer logic can happen
    if (inverseChange.type === 'delete') {
      const shouldProceed = await syncCallbacksRef.current.onBeforeDelete?.(inverseChange);
      if (shouldProceed === false) {
        // Sync system blocked the delete (e.g., another user is editing)
        // The item should be transferred to remote ownership
        const itemId = inverseChange.item.id;

        // Move item from local to remote
        if (inverseChange.itemType === 'file') {
          const item = localBlueprints.files.find(f => f.id === itemId);
          if (item) {
            setLocalBlueprints(prev => ({
              ...prev,
              files: prev.files.filter(f => f.id !== itemId)
            }));
            setRemoteBlueprints(prev => ({
              ...prev,
              files: [...prev.files, item]
            }));
          }
        } else {
          const item = localBlueprints.notes.find(n => n.id === itemId);
          if (item) {
            setLocalBlueprints(prev => ({
              ...prev,
              notes: prev.notes.filter(n => n.id !== itemId)
            }));
            setRemoteBlueprints(prev => ({
              ...prev,
              notes: [...prev.notes, item]
            }));
          }
        }

        // Remove this change from history (it's now owned by remote)
        setLocalChanges(prev => prev.filter((_, i) => i !== changeIndex));
        setChangeIndex(prev => prev - 1);
        return;
      }
    }

    // Apply inverse change
    setLocalBlueprints(prev => applyChangeToBlueprints(prev, inverseChange));
    setChangeIndex(prev => prev - 1);

    // Notify sync system
    syncCallbacksRef.current.onChangeApplied?.(inverseChange, 'undo');
  }, [changeIndex, localChanges, localBlueprints]);

  // Redo change
  const redoChange = useCallback(() => {
    if (changeIndex >= localChanges.length - 1) return;

    const changeToRedo = localChanges[changeIndex + 1];

    setLocalBlueprints(prev => applyChangeToBlueprints(prev, changeToRedo));
    setChangeIndex(prev => prev + 1);

    // Notify sync system
    syncCallbacksRef.current.onChangeApplied?.(changeToRedo, 'redo');
  }, [changeIndex, localChanges]);

  const canUndo = changeIndex >= 0;
  const canRedo = changeIndex < localChanges.length - 1;

  return (
    <BlueprintsContext.Provider value={{
      blueprints,
      setBlueprints,

      localBlueprints,
      setLocalBlueprints,

      remoteBlueprints,
      setRemoteBlueprints,

      instances,
      setInstances,

      highlightInstances,
      setHighlightInstances,

      localChanges,
      changeIndex,

      applyChange,
      undoChange,
      redoChange,

      setSyncCallbacks,

      canUndo,
      canRedo,
    }}>
      {children}
    </BlueprintsContext.Provider>
  );
};

export const useBlueprints = () => {
  const context = useContext(BlueprintsContext);
  if (!context) {
    throw new Error('useBlueprints must be used within a BlueprintsProvider');
  }
  return context;
};
