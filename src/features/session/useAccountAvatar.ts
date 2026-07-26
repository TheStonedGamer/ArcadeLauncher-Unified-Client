import { useEffect, useState } from "react";
import { sessionAvatar } from "./api";
import type { Session } from "./types";

/** Fetch the signed-in account's avatar once per session. */
export function useAccountAvatar(session: Session | null): string {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    setSrc("");
    if (!session) return () => {
      active = false;
    };
    sessionAvatar(session.host, session.token)
      .then((avatar) => {
        if (active) setSrc(avatar ?? "");
      })
      .catch(() => {
        // Missing/unreachable avatar is cosmetic; the initial remains visible.
      });
    return () => {
      active = false;
    };
  }, [session?.host, session?.token]);

  return src;
}
