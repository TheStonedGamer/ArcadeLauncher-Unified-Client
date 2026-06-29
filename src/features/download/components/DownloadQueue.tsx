// The downloads panel: one row per install with a progress bar, status line,
// and the controls valid for its state (pause/resume/cancel while in flight;
// dismiss once finished/failed). Presentational — all state comes from
// useDownloads via the DownloadApi prop.

import type { DownloadApi } from "../useDownloads";
import { formatBytes, formatSpeed, percent } from "../selectors";
import type { DownloadItem, DownloadStatus } from "../types";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: "Queued",
  downloading: "Downloading",
  verifying: "Verifying",
  extracting: "Extracting",
  done: "Installed",
  failed: "Failed",
  paused: "Paused",
};

function Controls({ item, api }: { item: DownloadItem; api: DownloadApi }) {
  switch (item.status) {
    case "downloading":
    case "verifying":
    case "extracting":
    case "queued":
      return (
        <div className="dl__controls">
          {item.status === "downloading" && (
            <button className="dl__btn" onClick={() => api.pause(item.gameId)}>
              Pause
            </button>
          )}
          <button className="dl__btn dl__btn--danger" onClick={() => api.cancel(item.gameId)}>
            Cancel
          </button>
        </div>
      );
    case "paused":
      return (
        <div className="dl__controls">
          <button className="dl__btn" onClick={() => api.resume(item.gameId)}>
            Resume
          </button>
          <button className="dl__btn dl__btn--danger" onClick={() => api.cancel(item.gameId)}>
            Cancel
          </button>
        </div>
      );
    case "done":
    case "failed":
      return (
        <div className="dl__controls">
          <button className="dl__btn" onClick={() => api.dismiss(item.gameId)}>
            Dismiss
          </button>
        </div>
      );
  }
}

function Row({ item, api, title }: { item: DownloadItem; api: DownloadApi; title: string }) {
  const pct = percent(item);
  const speed = formatSpeed(item.speedBps);
  const sub =
    item.status === "failed"
      ? item.error ?? "Failed"
      : item.status === "downloading"
        ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}${speed ? ` · ${speed}` : ""}`
        : item.status === "done"
          ? formatBytes(item.totalBytes)
          : STATUS_LABEL[item.status];

  return (
    <li className={`dl__row dl__row--${item.status}`}>
      <div className="dl__head">
        <span className="dl__name">{title}</span>
        <span className="dl__status">{STATUS_LABEL[item.status]}</span>
      </div>
      <div className="dl__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`dl__fill dl__fill--${item.status}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="dl__foot">
        <span className="dl__sub">{sub}</span>
        <Controls item={item} api={api} />
      </div>
    </li>
  );
}

export function DownloadQueue({
  api,
  titles,
}: {
  api: DownloadApi;
  /** Map of game id → clean catalog title, so the queue shows readable names
   *  instead of the raw game id. Falls back to the id when a title is missing
   *  (e.g. the catalog hasn't been cached yet). */
  titles?: Record<string, string>;
}) {
  const hasDone = api.items.some((i) => i.status === "done");
  return (
    <section className="dl">
      <div className="dl__bar-head">
        <h2 className="dl__title">Downloads</h2>
        {hasDone && (
          <button className="dl__btn" onClick={api.clearDone}>
            Clear completed
          </button>
        )}
      </div>
      {api.items.length === 0 ? (
        <p className="dl__empty">No downloads. Install a game from its detail page to see it here.</p>
      ) : (
        <ul className="dl__list">
          {api.items.map((it) => (
            <Row key={it.gameId} item={it} api={api} title={titles?.[it.gameId] ?? it.gameId} />
          ))}
        </ul>
      )}
    </section>
  );
}
