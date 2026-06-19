// Pure keyboard-shortcut catalog + the predicate for the "?" help hotkey. The
// modal (ShortcutsHelp) renders these groups; AppShell uses isHelpHotkey to decide
// when a keypress should open it. Kept data-only so it's unit-testable.

export interface Shortcut {
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: "?", description: "Show this shortcuts help" },
      { keys: "Esc", description: "Close a dialog / clear search" },
    ],
  },
  {
    title: "Library",
    shortcuts: [
      { keys: "Type to search", description: "Filter the grid by title, platform, dev, genre, year" },
      { keys: "Enter", description: "Open the focused game" },
      { keys: "Click a Continue Playing cover", description: "Launch instantly" },
    ],
  },
  {
    title: "Controller (Big Picture)",
    shortcuts: [
      { keys: "A", description: "Select / launch" },
      { keys: "B", description: "Back" },
      { keys: "X", description: "Context menu" },
      { keys: "Y", description: "Search" },
      { keys: "LB / RB", description: "Previous / next tab" },
      { keys: "Guide", description: "Toggle Big Picture mode" },
    ],
  },
];

/** Tag names that mean the user is typing — don't hijack their keystrokes. */
export function isEditableTag(tagName: string | undefined): boolean {
  if (!tagName) return false;
  const t = tagName.toLowerCase();
  return t === "input" || t === "textarea" || t === "select";
}

/** True when a keypress should open the shortcuts help: the "?" key, while the
 *  user isn't typing into a field. */
export function isHelpHotkey(key: string, editableTarget: boolean): boolean {
  return !editableTarget && key === "?";
}
