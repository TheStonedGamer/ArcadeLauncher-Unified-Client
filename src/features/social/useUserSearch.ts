// Hook for the "Add friend" search box (ROADMAP T9e): debounced username search
// against the server, plus sending a friend request by username. Thin React/IPC
// glue over api.ts; needs a live session. `existingIds` lets the UI mark people
// who are already friends so it can hide/disable the Add button.

import { useCallback, useEffect, useState } from "react";
import { searchUsers, sendFriendRequest, type SearchHit } from "./api";
import type { SocialAuth } from "./useSocial";

export interface UserSearchApi {
  query: string;
  setQuery: (q: string) => void;
  results: SearchHit[];
  searching: boolean;
  /** Last action result/error message for the user (cleared on new query). */
  status: string;
  /** Send a friend request to `username`; updates `status`. */
  addFriend: (username: string) => void;
  pending: boolean;
}

export function useUserSearch(auth: SocialAuth | null): UserSearchApi {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  // Debounced search: fire 300ms after the last keystroke.
  useEffect(() => {
    const q = query.trim();
    setStatus("");
    if (!auth || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const t = setTimeout(() => {
      searchUsers(auth.host, auth.token, q)
        .then((r) => live && setResults(r))
        .catch((e) => live && setStatus(String(e)))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [auth, query]);

  const addFriend = useCallback(
    (username: string) => {
      if (!auth || pending) return;
      setPending(true);
      setStatus("");
      sendFriendRequest(auth.host, auth.token, username)
        .then((s) => setStatus(s === "accepted" ? `You and ${username} are now friends.` : `Request sent to ${username}.`))
        .catch((e) => setStatus(String(e)))
        .finally(() => setPending(false));
    },
    [auth, pending],
  );

  return { query, setQuery, results, searching, status, addFriend, pending };
}
