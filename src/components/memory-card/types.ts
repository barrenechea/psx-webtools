export type MemoryCardToolbarCaps = {
  canUndo: boolean;
  canRedo: boolean;
  canHistory: boolean;
  canCopy: boolean;
  canMove: boolean;
  canPaste: boolean;
  canDelete: boolean;
  canExport: boolean;
  canImport: boolean;
  canSave: boolean;
  deleteLabel: string;
  history: string[];
  historyIndex: number;
};

export type FamilyToolbarCaps = Pick<
  MemoryCardToolbarCaps,
  | "canCopy"
  | "canMove"
  | "canPaste"
  | "canDelete"
  | "canExport"
  | "canImport"
  | "canSave"
  | "deleteLabel"
>;

export const EMPTY_FAMILY_CAPS: FamilyToolbarCaps = {
  canCopy: false,
  canMove: false,
  canPaste: false,
  canDelete: false,
  canExport: false,
  canImport: false,
  canSave: false,
  deleteLabel: "Delete save",
};

export type FamilyToolbarHandlers = {
  copy: () => void;
  move: () => void;
  paste: () => void;
  deleteSave: () => void;
  importSave: () => void;
  saveCard: () => void;
  exportSave: () => void;
};

export const NOOP_FAMILY_HANDLERS: FamilyToolbarHandlers = {
  copy: () => {},
  move: () => {},
  paste: () => {},
  deleteSave: () => {},
  importSave: () => {},
  saveCard: () => {},
  exportSave: () => {},
};
