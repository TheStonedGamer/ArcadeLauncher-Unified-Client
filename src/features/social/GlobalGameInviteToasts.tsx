// App-shell mount for game-invite toasts (ROADMAP T12d). Reads the single social
// instance from context so invites surface on every tab, and owns the launch
// handoff: accepting an invite resolves the gameId against the cached catalog and
// launches it. Kept separate from AppShell so the launch/catalog concern stays
// out of the shell layout.

import { useSocialContext } from "./SocialContext";
import { loadCatalog, launchGame } from "../catalog/api";
import { GameInviteToasts } from "./components/GameInviteToasts";

export function GlobalGameInviteToasts() {
  const social = useSocialContext();

  return (
    <GameInviteToasts
      invites={social.gameInvites}
      nameOf={(fromId) =>
        social.friends.find((f) => f.accountId === fromId)?.username ?? `User ${fromId}`
      }
      onJoin={(inviteId) => {
        // Tell the host we accepted (drops the toast) and get the target gameId,
        // then launch it from the cached catalog. Best-effort: an uninstalled or
        // unknown game just no-ops the launch (the accept still reaches the host).
        const gameId = social.acceptGameInvite(inviteId);
        if (!gameId) return;
        void (async () => {
          try {
            const games = await loadCatalog();
            const game = games.find((g) => g.id === gameId);
            if (game) await launchGame(game);
          } catch (e) {
            console.error("join-invite launch failed", e);
          }
        })();
      }}
      onDismiss={social.declineGameInvite}
    />
  );
}
