import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "./app/AppShell";
import { SessionProvider } from "./features/session/SessionContext";
import { ControllerConfigProvider } from "./features/gamepad/ControllerConfigContext";
import { applyStoredTheme } from "./features/theme/useTheme";
import "./styles/global.css";

// Apply the saved theme before first paint so there's no flash of the default
// palette.
applyStoredTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SessionProvider>
      <ControllerConfigProvider>
        <AppShell />
      </ControllerConfigProvider>
    </SessionProvider>
  </React.StrictMode>,
);
