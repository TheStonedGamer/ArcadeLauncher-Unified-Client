// A small colored dot conveying a friend's presence state.

import type { Presence } from "../types";

const LABEL: Record<Presence, string> = {
  online: "Online",
  away: "Away",
  busy: "Busy",
  ingame: "In-Game",
  invisible: "Offline",
  offline: "Offline",
};

export function PresenceDot({ presence }: { presence: Presence }) {
  return <span className={`presence-dot presence-dot--${presence}`} title={LABEL[presence]} />;
}

export { LABEL as presenceLabel };
