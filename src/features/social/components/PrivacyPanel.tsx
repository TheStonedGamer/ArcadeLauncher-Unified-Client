// Privacy settings overlay (ROADMAP T9f): choose who can send friend requests
// and who can DM you. Options + labels come from privacy.ts (unit-tested); state
// from usePrivacy. Composition only.

import { FRIEND_POLICY_OPTIONS, DM_POLICY_OPTIONS } from "../privacy";
import type { PrivacyApi } from "../usePrivacy";

export function PrivacyPanel({ privacy }: { privacy: PrivacyApi }) {
  if (!privacy.open) return null;
  return (
    <div className="privacy__overlay" onClick={() => privacy.setOpen(false)}>
      <div className="privacy" onClick={(e) => e.stopPropagation()}>
        <button className="privacy__close" onClick={() => privacy.setOpen(false)} aria-label="Close privacy settings">
          ✕
        </button>
        <h3 className="privacy__title">Privacy</h3>
        {privacy.error && <p className="privacy__error">{privacy.error}</p>}

        <fieldset className="privacy__group">
          <legend>Who can send me friend requests</legend>
          {FRIEND_POLICY_OPTIONS.map((o) => (
            <label key={o.value} className="privacy__opt">
              <input
                type="radio"
                name="friendPolicy"
                checked={privacy.privacy.friendPolicy === o.value}
                onChange={() => privacy.setFriendPolicy(o.value)}
              />
              <span className="privacy__opt-label">{o.label}</span>
              <span className="privacy__opt-hint">{o.hint}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="privacy__group">
          <legend>Who can direct-message me</legend>
          {DM_POLICY_OPTIONS.map((o) => (
            <label key={o.value} className="privacy__opt">
              <input
                type="radio"
                name="dmPolicy"
                checked={privacy.privacy.dmPolicy === o.value}
                onChange={() => privacy.setDmPolicy(o.value)}
              />
              <span className="privacy__opt-label">{o.label}</span>
              <span className="privacy__opt-hint">{o.hint}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
