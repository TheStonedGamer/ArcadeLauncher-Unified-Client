// Hook for the profile panel: which account is open, its fetched profile, and
// (for my own) saving banner/bio. The pure level math lives in profile.ts and is
// unit-tested; this is the thin React/IPC glue. Needs a live session (host+token)
// — without one the panel never opens.

import { useCallback, useState } from "react";
import { fetchProfile, updateProfile } from "./api";
import type { SocialAuth } from "./useSocial";
import type { Profile } from "./profile";

export interface ProfilePanelApi {
  /** The account whose profile is open (null = panel closed). */
  openId: number | null;
  /** The fetched profile (null while loading or on error). */
  profile: Profile | null;
  loading: boolean;
  error: string;
  /** Whether the open profile is mine (banner/bio editable). */
  editable: boolean;
  /** Open + fetch a profile by account id. */
  open: (userId: number) => void;
  /** Close the panel. */
  close: () => void;
  /** Save my banner/bio, then refresh. */
  save: (banner: string, bio: string) => void;
  saving: boolean;
}

export function useProfile(auth: SocialAuth | null, selfId: number): ProfilePanelApi {
  const [openId, setOpenId] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const open = useCallback(
    (userId: number) => {
      if (!auth || !userId) return;
      setOpenId(userId);
      setProfile(null);
      setError("");
      setLoading(true);
      fetchProfile(auth.host, auth.token, userId)
        .then((p) => setProfile(p))
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [auth],
  );

  const close = useCallback(() => {
    setOpenId(null);
    setProfile(null);
    setError("");
  }, []);

  const save = useCallback(
    (banner: string, bio: string) => {
      if (!auth || openId == null) return;
      setSaving(true);
      setError("");
      updateProfile(auth.host, auth.token, banner, bio)
        .then(() => fetchProfile(auth.host, auth.token, openId))
        .then((p) => setProfile(p))
        .catch((e) => setError(String(e)))
        .finally(() => setSaving(false));
    },
    [auth, openId],
  );

  return {
    openId,
    profile,
    loading,
    error,
    editable: openId != null && openId === selfId,
    open,
    close,
    save,
    saving,
  };
}
