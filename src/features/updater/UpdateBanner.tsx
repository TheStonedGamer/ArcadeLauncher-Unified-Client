// Small banner that surfaces update state. Only renders something when an
// update is available, installing, or errored — silent otherwise.

import { useUpdater } from "./useUpdater";

export function UpdateBanner() {
  const { status, install } = useUpdater();

  if (status.kind === "available") {
    return (
      <div className="update-banner">
        Update {status.version} available.
        <button className="update-banner__btn" onClick={install}>
          Install &amp; restart
        </button>
      </div>
    );
  }
  if (status.kind === "installing") {
    return <div className="update-banner">Installing update…</div>;
  }
  if (status.kind === "error") {
    return <div className="update-banner update-banner--error">Update check failed: {status.message}</div>;
  }
  return null;
}
