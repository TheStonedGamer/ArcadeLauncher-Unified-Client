// Pure presence/status helpers (ROADMAP T9f). The server accepts a `presence`
// frame with a state (online|away|busy|invisible|offline), an optional custom
// `statusText` (≤128 chars), and a `dnd` alias that forces `busy`. These helpers
// model the user-selectable options and build the outbound frame fields, kept
// IO-free so they're unit-tested in statusMenu.test.ts. The actual send happens
// in useSocial; the wire builder is outbound.presence in protocol.ts.

/** A presence state the user can pick for themselves (no "ingame" — that's
 *  set automatically while a game runs). */
export type SelfStatus = "online" | "away" | "busy" | "invisible";

export interface StatusOption {
  value: SelfStatus;
  label: string;
  /** Short hint shown under the label. */
  hint: string;
}

/** The ordered menu of self-selectable statuses. "busy" is presented as
 *  "Do Not Disturb" since the server treats dnd as an alias for busy. */
export const STATUS_OPTIONS: StatusOption[] = [
  { value: "online", label: "Online", hint: "Visible and reachable" },
  { value: "away", label: "Away", hint: "Idle / stepped out" },
  { value: "busy", label: "Do Not Disturb", hint: "Suppress interruptions" },
  { value: "invisible", label: "Invisible", hint: "Appear offline to friends" },
];

/** The max custom-status length the server stores (chars). */
export const MAX_STATUS_TEXT = 128;

/** Clamp a custom status string to the server's limit, trimming edges. */
export function clampStatusText(text: string): string {
  return text.trim().slice(0, MAX_STATUS_TEXT);
}

/** Look up a status option's label (falls back to the raw value). */
export function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** The fields for an outbound presence frame given a chosen status + custom
 *  text. `dnd` is set true only for "busy" so the server's alias path is a
 *  no-op vs. the explicit state (both yield busy), keeping intent explicit. */
export interface PresenceFrameInput {
  state: SelfStatus;
  statusText: string;
  dnd: boolean;
}

export function presenceFrameInput(status: SelfStatus, statusText: string): PresenceFrameInput {
  return {
    state: status,
    statusText: clampStatusText(statusText),
    dnd: status === "busy",
  };
}
