// Glue for "install this on my PC" (0.14). The decision is made by the pure
// `decideRemoteInstall`; this hook only supplies the context, calls the same
// `installGame` the Library button calls, and reports what happened back to the
// phone that asked.
//
// It is mounted once in the app shell rather than inside a view, so a request
// is honored whichever tab happens to be open — the whole point of the feature
// is that nobody is sitting at the PC.

import { useEffect, useRef } from "react";
import { installGame, loadInstallRecords } from "../download/api";
import type { DownloadItem } from "./../download/types";
import { useSession } from "../session/SessionContext";
import { useSocialContext } from "./SocialContext";
import { decideRemoteInstall, failedMessage, startedMessage } from "./remoteInstall";

/** Statuses that mean a download is live, so a second request should be told
 *  about it instead of starting the same game again. "failed" is deliberately
 *  not here: retrying a failed install from the phone is reasonable. */
const ACTIVE: ReadonlySet<string> = new Set(["queued", "downloading", "verifying", "extracting", "paused"]);

export function useRemoteInstall(items: readonly DownloadItem[], knownGameIds: readonly string[]) {
  const { session } = useSession();
  const { setRemoteInstallHandler, remoteInstallResult } = useSocialContext();

  // Read through refs so the handler is registered once and still sees current
  // state: re-registering on every progress tick would be a lot of churn for a
  // callback that fires a few times a week.
  const deps = useRef({ session, items, knownGameIds });
  deps.current = { session, items, knownGameIds };

  useEffect(() => {
    setRemoteInstallHandler((gameId, gameTitle, fromDeviceId) => {
      void (async () => {
        const { session: s, items: current, knownGameIds: known } = deps.current;

        // Installed state is read fresh rather than held: it changes behind the
        // UI's back whenever an install finishes.
        let installedGameIds: string[] = [];
        try {
          installedGameIds = Object.keys(await loadInstallRecords());
        } catch {
          // No records yet (first run) reads as "nothing installed", which is
          // the safe way round: at worst the engine finds the files present.
        }

        const decision = decideRemoteInstall(gameId, gameTitle, {
          signedIn: !!s,
          knownGameIds: known,
          installedGameIds,
          activeGameIds: current.filter((i) => ACTIVE.has(i.status)).map((i) => i.gameId),
        });

        if (decision.action === "refuse") {
          remoteInstallResult(fromDeviceId, gameId, decision.status, decision.message);
          return;
        }

        try {
          await installGame(s!.host, s!.token, decision.gameId);
          remoteInstallResult(fromDeviceId, decision.gameId, "started", startedMessage(decision.title));
        } catch (err) {
          remoteInstallResult(
            fromDeviceId,
            decision.gameId,
            "failed",
            failedMessage(decision.title, err instanceof Error ? err.message : ""),
          );
        }
      })();
    });
    return () => setRemoteInstallHandler(() => {});
  }, [setRemoteInstallHandler, remoteInstallResult]);
}
