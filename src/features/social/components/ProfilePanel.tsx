// Profile overlay (ROADMAP T9d): banner, avatar initial, username, a level badge
// with an XP progress bar, and the bio. When viewing my own profile, the banner
// and bio become editable with a Save button. Composition + local edit state
// only; the level math (profile.ts) is unit-tested and the IPC lives in
// useProfile.

import { useEffect, useState, type CSSProperties } from "react";
import { levelProgress, type Profile } from "../profile";
import type { ProfilePanelApi } from "../useProfile";

/** A banner string may be a CSS color/gradient or an image URL; render either. */
function bannerStyle(banner: string): CSSProperties {
  const b = banner.trim();
  if (!b) return {};
  if (/^https?:\/\//i.test(b)) return { backgroundImage: `url("${b}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: b };
}

function ProfileBody({ profile, panel }: { profile: Profile; panel: ProfilePanelApi }) {
  const [banner, setBanner] = useState(profile.banner);
  const [bio, setBio] = useState(profile.bio);
  // Re-seed the edit fields whenever a fresh profile arrives (e.g. after save).
  useEffect(() => {
    setBanner(profile.banner);
    setBio(profile.bio);
  }, [profile.banner, profile.bio]);

  const prog = levelProgress(profile.xp);
  const initial = (profile.username[0] ?? "?").toUpperCase();
  const dirty = banner !== profile.banner || bio !== profile.bio;

  return (
    <>
      <div className="profile__banner" style={bannerStyle(profile.banner)} />
      <div className="profile__head">
        <div className="profile__avatar" aria-hidden>{initial}</div>
        <div className="profile__id">
          <div className="profile__name">{profile.username}</div>
          <div className="profile__level">Level {profile.level} · {profile.xp} XP</div>
        </div>
      </div>

      <div className="profile__xp">
        <div className="profile__xp-bar">
          <div className="profile__xp-fill" style={{ width: `${prog.pct}%` }} />
        </div>
        <div className="profile__xp-text">
          {prog.into} / {prog.span} XP to level {prog.level + 1}
        </div>
      </div>

      {panel.editable ? (
        <div className="profile__edit">
          <label className="profile__field">
            <span>Banner (color, gradient, or image URL)</span>
            <input value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="#3a7bd5 or https://…" />
          </label>
          <label className="profile__field">
            <span>Bio</span>
            <textarea value={bio} maxLength={1024} rows={4} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself" />
          </label>
          <button
            className="profile__save"
            disabled={panel.saving || !dirty}
            onClick={() => panel.save(banner, bio)}
          >
            {panel.saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      ) : (
        <p className="profile__bio">{profile.bio || "No bio yet."}</p>
      )}
    </>
  );
}

export function ProfilePanel({ panel }: { panel: ProfilePanelApi }) {
  if (panel.openId == null) return null;
  return (
    <div className="profile__overlay" onClick={panel.close}>
      <div className="profile" onClick={(e) => e.stopPropagation()}>
        <button className="profile__close" onClick={panel.close} aria-label="Close profile">✕</button>
        {panel.error ? (
          <p className="profile__error">{panel.error}</p>
        ) : !panel.profile ? (
          <p className="profile__loading">{panel.loading ? "Loading…" : ""}</p>
        ) : (
          <ProfileBody profile={panel.profile} panel={panel} />
        )}
      </div>
    </div>
  );
}
