// App-wide session state. Holds the signed-in Session (host + token + user) in
// memory so the social and download features can source host+token from one
// place. The token is kept in memory only (never persisted); the host and
// username are remembered in localStorage so the login form pre-fills.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { sessionLogin } from "./api";
import type { Session } from "./types";

interface SessionContextValue {
  session: Session | null;
  /** Last-used host/username for pre-filling the login form. */
  lastHost: string;
  lastUsername: string;
  login: (host: string, username: string, password: string, totpCode: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const HOST_KEY = "arcade.session.host";
const USER_KEY = "arcade.session.username";

function readLS(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [lastHost, setLastHost] = useState(() => readLS(HOST_KEY));
  const [lastUsername, setLastUsername] = useState(() => readLS(USER_KEY));

  const login = useCallback(
    async (host: string, username: string, password: string, totpCode: string) => {
      const s = await sessionLogin(host, username, password, totpCode);
      setSession(s);
      setLastHost(s.host);
      setLastUsername(s.username);
      try {
        localStorage.setItem(HOST_KEY, s.host);
        localStorage.setItem(USER_KEY, s.username);
      } catch {
        /* non-fatal */
      }
    },
    [],
  );

  const logout = useCallback(() => setSession(null), []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, lastHost, lastUsername, login, logout }),
    [session, lastHost, lastUsername, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
