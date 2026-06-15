// Top-level app shell: header, update banner, and the active feature view.
// As features grow (social, settings, downloads) they slot in here behind
// navigation; for T0 the catalog is the whole app.

import { UpdateBanner } from "../features/updater/UpdateBanner";
import { CatalogView } from "../features/catalog/CatalogView";

export function AppShell() {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">ArcadeLauncher</h1>
        <span className="app__tag">Unified Client</span>
      </header>
      <UpdateBanner />
      <main className="app__main">
        <CatalogView />
      </main>
    </div>
  );
}
