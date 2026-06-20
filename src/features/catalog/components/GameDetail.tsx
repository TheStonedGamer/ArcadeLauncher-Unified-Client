// Detail panel for a variant group: cover + metadata of the representative
// dump, a summary, and (when the group has multiple dumps) a version picker.
// Launching uses the currently selected dump. Esc / backdrop click closes.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { checkRunnable, type ArtCandidate, type TargetStatus } from "../api";
import type { Game } from "../types";
import type { ConflictPolicy, SyncReport } from "../../saves/api";
import { yearOf, collectionsOf } from "../query";
import { variantLabel, type VariantGroup } from "../variants";
import { StreamFromHost } from "../../streaming/StreamFromHost";

interface Props {
  group: VariantGroup;
  onLaunch: (game: Game) => void;
  onClose: () => void;
  onToggleFavorite?: (game: Game) => void;
  onToggleHidden?: (game: Game) => void;
  onAddCollection?: (game: Game, name: string) => void;
  onRemoveCollection?: (game: Game, name: string) => void;
  /** Start installing the game from the server. Absent for non-server games. */
  onInstall?: (game: Game) => Promise<void>;
  /** Apply an available update (re-pull only changed files). Absent for
   *  non-server games. */
  onUpdate?: (game: Game) => Promise<void>;
  /** Whether a session is available to authorize the install. */
  canInstall?: boolean;
  /** Sync this game's cloud saves with the chosen conflict policy. Absent for
   *  non-server games. Resolves to a report of what was transferred. */
  onSyncSaves?: (game: Game, policy: ConflictPolicy) => Promise<SyncReport>;
  /** Whether a session is available to authorize a save sync. */
  canSync?: boolean;
  /** Persist the game's local save-folder override (blank clears it). */
  onSetSavePath?: (game: Game, path: string) => void;
  /** The currently-configured save folder for a game (blank = managed folder). */
  savePathFor?: (game: Game) => string;
  /** Search SteamGridDB for cover candidates for a game. Absent when no API key
   *  is configured. */
  onFindArtwork?: (game: Game) => Promise<ArtCandidate[]>;
  /** Apply a chosen cover URL; resolves to the saved local cover path. */
  onPickArtwork?: (game: Game, url: string) => Promise<string>;
}

function playtimeStr(seconds: number): string {
  if (!seconds) return "Never played";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="detail__row">
      <span className="detail__key">{label}</span>
      <span className="detail__val">{value}</span>
    </div>
  );
}

export function GameDetail({
  group,
  onLaunch,
  onClose,
  onToggleFavorite,
  onToggleHidden,
  onAddCollection,
  onRemoveCollection,
  onInstall,
  onUpdate,
  canInstall,
  onSyncSaves,
  canSync,
  onSetSavePath,
  savePathFor,
  onFindArtwork,
  onPickArtwork,
}: Props) {
  const [pick, setPick] = useState<Game>(group.representative);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncConflicts, setSyncConflicts] = useState(0);
  const [savePath, setSavePathState] = useState(savePathFor ? savePathFor(group.representative) : "");
  const game = group.representative;
  // A cover chosen via the artwork picker this session wins immediately, so the
  // modal reflects the new art without waiting for a catalog re-derive on close.
  const [pickedCover, setPickedCover] = useState("");
  const [artResults, setArtResults] = useState<ArtCandidate[]>([]);
  const [artLoading, setArtLoading] = useState(false);
  const [artMsg, setArtMsg] = useState("");
  const cover = pickedCover
    ? convertFileSrc(pickedCover)
    : game.coverArtPath
      ? convertFileSrc(game.coverArtPath)
      : game.coverArtUrl;

  const findArtwork = async () => {
    if (!onFindArtwork) return;
    setArtLoading(true);
    setArtMsg("");
    setArtResults([]);
    try {
      const results = await onFindArtwork(game);
      setArtResults(results);
      if (results.length === 0) setArtMsg("No cover art found for this title.");
    } catch (e) {
      setArtMsg(`Couldn't search artwork: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArtLoading(false);
    }
  };

  const pickArtwork = async (url: string) => {
    if (!onPickArtwork) return;
    setArtMsg("Applying…");
    try {
      const localPath = await onPickArtwork(game, url);
      setPickedCover(localPath);
      setArtResults([]);
      setArtMsg("Cover updated ✓");
    } catch (e) {
      setArtMsg(`Couldn't apply cover: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Local mirrors of the overridable bits so toggles reflect immediately in the
  // open modal (the grid re-derives from prefs on close).
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(game.hidden);
  const [collections, setCollections] = useState<string[]>(collectionsOf(game));
  const [newCollection, setNewCollection] = useState("");

  const toggleFavorite = () => {
    onToggleFavorite?.(game);
    setFavorite((v) => !v);
  };
  const toggleHidden = () => {
    onToggleHidden?.(game);
    setHidden((v) => !v);
  };
  const addCollection = () => {
    const name = newCollection.trim();
    if (!name || collections.includes(name)) return;
    onAddCollection?.(game, name);
    setCollections((c) => [...c, name]);
    setNewCollection("");
  };
  const removeCollection = (name: string) => {
    onRemoveCollection?.(game, name);
    setCollections((c) => c.filter((x) => x !== name));
  };

  const install = async () => {
    if (!onInstall) return;
    setInstalling(true);
    setInstallMsg("");
    try {
      await onInstall(pick);
      setInstallMsg("Install started — see the Downloads tab.");
    } catch (e) {
      setInstallMsg(`Couldn't start install: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling(false);
    }
  };

  const update = async () => {
    if (!onUpdate) return;
    setInstalling(true);
    setInstallMsg("");
    try {
      await onUpdate(pick);
      setInstallMsg("Update started — only changed files are downloaded. See the Downloads tab.");
    } catch (e) {
      setInstallMsg(`Couldn't start update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling(false);
    }
  };

  const syncSaves = async (policy: ConflictPolicy) => {
    if (!onSyncSaves) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await onSyncSaves(game, policy);
      setSyncConflicts(r.conflicts.length);
      const parts: string[] = [];
      if (r.uploaded) parts.push(`${r.uploaded} uploaded`);
      if (r.downloaded) parts.push(`${r.downloaded} downloaded`);
      if (r.conflicts.length) parts.push(`${r.conflicts.length} conflict${r.conflicts.length > 1 ? "s" : ""}`);
      if (r.errors.length) parts.push(`${r.errors.length} failed`);
      setSyncMsg(parts.length ? `Saves synced — ${parts.join(", ")}.` : "Saves already up to date ✓");
    } catch (e) {
      setSyncMsg(`Couldn't sync saves: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const rating = game.igdbRating >= 1 ? `${Math.round(game.igdbRating)}/100` : "";
  const hasVariants = group.members.length > 1;
  // The live install state (overlaid from records + download events upstream).
  const state = pick.installState;
  const installed = state === "installed" || state === "updateAvailable";
  const inProgress = state === "installing";
  // Offer Install for server-backed games that aren't already installed.
  const installable = !!onInstall && pick.serverBacked && !installed;
  // Offer Update for installed server games the server advertises a newer build for.
  const updatable = !!onUpdate && pick.serverBacked && state === "updateAvailable";

  // Diagnose the selected dump's launch readiness so we can show a specific
  // reason ("file moved", "emulator not installed", …) instead of letting the
  // user click Launch only to hit a generic failure. Only relevant once we're
  // past the Install button (installable games show Install, not Launch).
  const [runStatus, setRunStatus] = useState<TargetStatus | null>(null);
  useEffect(() => {
    if (installable) {
      setRunStatus(null);
      return;
    }
    let live = true;
    setRunStatus(null);
    checkRunnable(pick)
      .then((s) => live && setRunStatus(s))
      .catch(() => live && setRunStatus(null));
    return () => {
      live = false;
    };
  }, [pick, installable]);
  // Offer cloud-save sync for any server-backed game.
  const syncable = !!onSyncSaves && pick.serverBacked;

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail" onClick={(e) => e.stopPropagation()}>
        <button className="detail__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="detail__cover">
          {cover ? <img src={cover} alt={game.title} /> : <span>{game.title}</span>}
        </div>
        <div className="detail__body">
          <h2 className="detail__title">{game.title}</h2>

          {(onToggleFavorite || onToggleHidden) && (
            <div className="detail__actions">
              {onToggleFavorite && (
                <button
                  className={`detail__toggle${favorite ? " detail__toggle--on" : ""}`}
                  onClick={toggleFavorite}
                >
                  {favorite ? "★ Favorited" : "☆ Favorite"}
                </button>
              )}
              {onToggleHidden && (
                <button className="detail__toggle" onClick={toggleHidden}>
                  {hidden ? "🙈 Hidden" : "Hide"}
                </button>
              )}
            </div>
          )}

          <div className="detail__meta">
            <Row label="Platform" value={game.platform} />
            <Row label="Developer" value={game.developer} />
            <Row label="Publisher" value={game.publisher} />
            <Row label="Franchise" value={game.franchise} />
            <Row label="Genres" value={game.genres} />
            <Row label="Year" value={yearOf(game.releaseDate)} />
            <Row label="Rating" value={rating} />
            <Row label="Playtime" value={playtimeStr(game.playtimeSeconds)} />
          </div>
          {game.summary && <p className="detail__summary">{game.summary}</p>}

          {onFindArtwork && (
            <div className="detail__artwork">
              <button className="detail__fetch" onClick={findArtwork} disabled={artLoading}>
                {artLoading ? "Searching…" : "🎨 Find cover art"}
              </button>
              {artResults.length > 0 && (
                <div className="detail__artgrid">
                  {artResults.slice(0, 12).map((a) => (
                    <button
                      key={a.url}
                      className="detail__artthumb"
                      onClick={() => pickArtwork(a.url)}
                      title="Use this cover"
                    >
                      <img src={a.thumb} alt="cover candidate" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {artMsg && <span className="detail__fetchmsg">{artMsg}</span>}
            </div>
          )}

          {onAddCollection && (
            <div className="detail__collections">
              <span className="settings__label">Collections</span>
              <div className="detail__chips">
                {collections.map((c) => (
                  <span key={c} className="detail__chip">
                    {c}
                    <button
                      className="detail__chip-x"
                      onClick={() => removeCollection(c)}
                      aria-label={`Remove from ${c}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {collections.length === 0 && <span className="detail__fetchmsg">None yet</span>}
              </div>
              <div className="detail__collection-add">
                <input
                  className="settings__input"
                  value={newCollection}
                  onChange={(e) => setNewCollection(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCollection()}
                  placeholder="Add to collection…"
                  spellCheck={false}
                />
                <button className="detail__fetch" onClick={addCollection} disabled={!newCollection.trim()}>
                  Add
                </button>
              </div>
            </div>
          )}

          {hasVariants && (
            <div className="detail__variants">
              <span className="settings__label">Version</span>
              <div className="detail__variant-list">
                {group.members.map((m, i) => {
                  const lbl = variantLabel(m) || "Base";
                  return (
                    <button
                      key={m.id || i}
                      className={`detail__variant${m === pick ? " detail__variant--active" : ""}`}
                      onClick={() => setPick(m)}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {syncable && (
            <div className="detail__saves">
              {onSetSavePath && (
                <div className="detail__saves-folder">
                  <span className="settings__label">Save folder</span>
                  <input
                    className="settings__input"
                    value={savePath}
                    onChange={(e) => setSavePathState(e.target.value)}
                    onBlur={() => onSetSavePath(game, savePath)}
                    placeholder="Leave blank to use the managed folder"
                    spellCheck={false}
                  />
                </div>
              )}
              <button
                className="detail__fetch"
                onClick={() => syncSaves("skip")}
                disabled={syncing || !canSync}
                title={canSync ? "" : "Sign in to sync saves"}
              >
                {syncing ? "Syncing…" : canSync ? "☁ Sync saves" : "☁ Sign in to sync saves"}
              </button>
              {syncConflicts > 0 && !syncing && (
                <div className="detail__saves-resolve">
                  <span className="detail__fetchmsg">Conflict — pick a side:</span>
                  <button className="detail__fetch" onClick={() => syncSaves("preferLocal")} disabled={syncing}>
                    Keep my saves
                  </button>
                  <button className="detail__fetch" onClick={() => syncSaves("preferRemote")} disabled={syncing}>
                    Keep server saves
                  </button>
                </div>
              )}
              {syncMsg && <span className="detail__fetchmsg">{syncMsg}</span>}
            </div>
          )}

          {/* Steam-style single primary action: Install while a server game
              isn't on disk yet (or is mid-install), Launch once it is. Local,
              non-server games are always launchable. */}
          {installable ? (
            <div className="detail__install">
              <button
                className="detail__launch detail__install-btn"
                onClick={install}
                disabled={installing || inProgress || !canInstall}
                title={canInstall ? "" : "Sign in to install"}
              >
                {inProgress
                  ? "⬇ Installing…"
                  : installing
                    ? "Starting…"
                    : canInstall
                      ? state === "failed"
                        ? "⬇ Retry install"
                        : "⬇ Install"
                      : "⬇ Sign in to install"}
              </button>
              {installMsg && <span className="detail__fetchmsg">{installMsg}</span>}
            </div>
          ) : (
            <div className="detail__launch-wrap">
              {updatable && (
                <button
                  className="detail__fetch detail__update-btn"
                  onClick={update}
                  disabled={installing || inProgress || !canInstall}
                  title={canInstall ? "" : "Sign in to update"}
                >
                  {inProgress ? "⬆ Updating…" : installing ? "Starting…" : "⬆ Update available"}
                </button>
              )}
              <button
                className="detail__launch"
                onClick={() => onLaunch(pick)}
                disabled={runStatus !== null && !runStatus.runnable}
              >
                ▶ {state === "updateAvailable" ? "Launch (update available)" : "Launch"}
                {hasVariants ? ` — ${variantLabel(pick) || "Base"}` : ""}
              </button>
              {updatable && installMsg && <span className="detail__fetchmsg">{installMsg}</span>}
              {runStatus && !runStatus.runnable && (
                <span className="detail__fetchmsg detail__launch-reason">{runStatus.message}</span>
              )}
              <StreamFromHost title={game.title} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
