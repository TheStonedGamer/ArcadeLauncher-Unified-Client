// What this PC does when the owner's phone asks it to install a game.
//
// Pure on purpose: the interesting part is the refusals, and every one of them
// can be decided without touching the disk or the network. `useRemoteInstall`
// is the glue that turns a decision into an `installGame` call and a result
// frame back to the phone.
//
// The authorisation question is already settled before we get here: the server
// only relays between sockets authenticated as the same account, so a request
// that arrives is by construction the owner's own. What is left is whether this
// machine can actually honour it.

/** What the launcher should do about one request. */
export type RemoteInstallDecision =
  | { action: "install"; gameId: string; title: string }
  | { action: "refuse"; status: string; message: string };

export interface RemoteInstallContext {
  /** Is a session signed in? Without one there is no token to fetch a manifest. */
  signedIn: boolean;
  /** Game ids this PC knows about, from the catalog it has already loaded. */
  knownGameIds: readonly string[];
  /** Game ids already installed here. */
  installedGameIds: readonly string[];
  /** Game ids currently downloading. */
  activeGameIds: readonly string[];
}

/** Decide, and phrase the answer for a phone screen rather than for a log. */
export function decideRemoteInstall(
  gameId: string,
  title: string,
  ctx: RemoteInstallContext,
): RemoteInstallDecision {
  const id = gameId.trim();
  const name = title.trim() || id;

  if (!id) {
    return { action: "refuse", status: "failed", message: "That request did not name a game." };
  }
  if (!ctx.signedIn) {
    // Refusing beats queueing: a queue would fire at an unpredictable later
    // moment, long after the person holding the phone stopped watching.
    return { action: "refuse", status: "failed", message: "That PC is not signed in." };
  }
  if (ctx.activeGameIds.includes(id)) {
    return { action: "refuse", status: "downloading", message: `${name} is already downloading.` };
  }
  if (ctx.installedGameIds.includes(id)) {
    return { action: "refuse", status: "installed", message: `${name} is already installed.` };
  }
  if (ctx.knownGameIds.length > 0 && !ctx.knownGameIds.includes(id)) {
    // Only checked when a catalog has actually loaded: an empty catalog means
    // "we do not know yet", not "that game does not exist", and refusing on a
    // cold start would be wrong.
    return { action: "refuse", status: "failed", message: `${name} is not in this PC's library.` };
  }
  return { action: "install", gameId: id, title: name };
}

/** The message the phone shows while the download runs. */
export function startedMessage(title: string): string {
  return `Started downloading ${title}.`;
}

/** The message the phone shows when the install could not even be started —
 *  a manifest fetch failure, a full disk, a missing library folder. */
export function failedMessage(title: string, detail: string): string {
  const trimmed = detail.trim();
  return trimmed ? `Could not install ${title}: ${trimmed}` : `Could not install ${title}.`;
}
