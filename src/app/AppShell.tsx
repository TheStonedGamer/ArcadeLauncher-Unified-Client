// Top-level app shell: header with view tabs, update banner, and the active
// feature view. As features grow (social, downloads) they add a tab here.

import { useState } from "react";
import { UpdateBanner } from "../features/updater/UpdateBanner";
import { CatalogView } from "../features/catalog/CatalogView";
import { SettingsView } from "../features/settings/SettingsView";
import { SocialView } from "../features/social/SocialView";
import { DownloadQueue } from "../features/download/components/DownloadQueue";
import { useDownloads } from "../features/download/useDownloads";

type View = "library" | "friends" | "downloads" | "settings";

export function AppShell() {
  const [view, setView] = useState<View>("library");
  const downloads = useDownloads();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">ArcadeLauncher</h1>
        <span className="app__tag">Unified Client</span>
        <nav className="app__nav">
          <button
            className={`app__navbtn${view === "library" ? " app__navbtn--active" : ""}`}
            onClick={() => setView("library")}
          >
            Library
          </button>
          <button
            className={`app__navbtn${view === "friends" ? " app__navbtn--active" : ""}`}
            onClick={() => setView("friends")}
          >
            Friends
          </button>
          <button
            className={`app__navbtn${view === "downloads" ? " app__navbtn--active" : ""}`}
            onClick={() => setView("downloads")}
          >
            Downloads
            {downloads.activeCount > 0 && <span className="app__badge">{downloads.activeCount}</span>}
          </button>
          <button
            className={`app__navbtn${view === "settings" ? " app__navbtn--active" : ""}`}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </nav>
      </header>
      <UpdateBanner />
      <main className="app__main">
        {view === "library" && <CatalogView />}
        {view === "friends" && <SocialView />}
        {view === "downloads" && <DownloadQueue api={downloads} />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
