// App-wide social state (ROADMAP T12d follow-up). `useSocial` owns the single
// live gateway connection; mounting it once at the app root (instead of inside
// SocialView) means the connection — and therefore presence, chat, and game
// invites — stays alive on every tab, not just the Friends screen. SocialView
// and the global game-invite toasts both read from this one instance via
// useSocialContext(), so there is exactly one gateway socket.

import { createContext, useContext, type ReactNode } from "react";
import { useSocial, type SocialApi } from "./useSocial";
import { useSession } from "../session/SessionContext";

const SocialContext = createContext<SocialApi | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const auth = session ? { host: session.host, token: session.token } : null;
  const social = useSocial(auth);
  return <SocialContext.Provider value={social}>{children}</SocialContext.Provider>;
}

export function useSocialContext(): SocialApi {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error("useSocialContext must be used within a SocialProvider");
  return ctx;
}
