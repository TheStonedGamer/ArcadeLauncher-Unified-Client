// The green Steam-style ownership action: "＋ Add to Library" when not owned,
// "✓ In Library" when owned (click to remove). Disabled + hinting to sign in
// when there's no session. `stop` prevents the click from bubbling to a parent
// capsule/card link.

interface Props {
  owned: boolean;
  canModify: boolean;
  onToggle: () => void;
  /** Size variant: "sm" for capsule footers, "lg" for the featured/detail CTA. */
  size?: "sm" | "lg";
  /** Swallow the click so it doesn't open the card behind the button. */
  stop?: boolean;
}

export function LibraryToggle({ owned, canModify, onToggle, size = "sm", stop = true }: Props) {
  const cls = `lib-toggle lib-toggle--${size}${owned ? " lib-toggle--owned" : ""}`;
  return (
    <button
      className={cls}
      disabled={!canModify}
      title={!canModify ? "Sign in to manage your library" : owned ? "Remove from library" : "Add to your library"}
      onClick={(e) => {
        if (stop) e.stopPropagation();
        onToggle();
      }}
    >
      {owned ? "✓ In Library" : "＋ Add to Library"}
    </button>
  );
}
