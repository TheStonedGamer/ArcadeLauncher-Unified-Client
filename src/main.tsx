import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "./app/AppShell";
import { SessionProvider } from "./features/session/SessionContext";
import { ControllerConfigProvider } from "./features/gamepad/ControllerConfigContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SessionProvider>
      <ControllerConfigProvider>
        <AppShell />
      </ControllerConfigProvider>
    </SessionProvider>
  </React.StrictMode>,
);
