// "Add friend" search box (ROADMAP T9e): a username search with a results
// dropdown, each row offering an Add button (hidden for people already on the
// roster). State + IPC come from useUserSearch; this is presentation only.

import { useUserSearch } from "../useUserSearch";
import type { SocialAuth } from "../useSocial";

interface Props {
  auth: SocialAuth;
  /** Account ids already on the roster, to skip the Add button. */
  friendIds: Set<number>;
}

export function AddFriend({ auth, friendIds }: Props) {
  const search = useUserSearch(auth);

  return (
    <div className="addfriend">
      <input
        className="addfriend__input"
        value={search.query}
        placeholder="Add friend by username…"
        onChange={(e) => search.setQuery(e.target.value)}
      />
      {search.status && <p className="addfriend__status">{search.status}</p>}
      {search.query.trim().length >= 2 && (
        <ul className="addfriend__results">
          {search.searching && <li className="addfriend__hint">Searching…</li>}
          {!search.searching && search.results.length === 0 && (
            <li className="addfriend__hint">No matches.</li>
          )}
          {search.results.map((u) => {
            const already = friendIds.has(u.userId);
            return (
              <li key={u.userId} className="addfriend__row">
                <span className="addfriend__name">{u.username}</span>
                {already ? (
                  <span className="addfriend__already">Friend</span>
                ) : (
                  <button
                    className="addfriend__add"
                    disabled={search.pending}
                    onClick={() => search.addFriend(u.username)}
                  >
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
