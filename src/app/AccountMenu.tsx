import { useEffect, useRef, useState } from "react";

interface Props {
  username: string;
  host: string;
  isAdmin: boolean;
  avatarSrc?: string;
  onAccountSettings: () => void;
  onSettings: () => void;
  onSwitchAccount: () => void;
  onLogout: () => void;
}

export function accountInitial(username: string): string {
  return (username.trim()[0] ?? "?").toUpperCase();
}

export function AccountMenu({
  username,
  host,
  isAdmin,
  avatarSrc = "",
  onAccountSettings,
  onSettings,
  onSwitchAccount,
  onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className={`account-menu__trigger${open ? " account-menu__trigger--open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="account-menu__avatar" aria-hidden>
          {avatarSrc ? <img src={avatarSrc} alt="" /> : accountInitial(username)}
        </span>
        <span className="account-menu__username">{username}</span>
        <span className="account-menu__chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="account-menu__dropdown" role="menu">
          <div className="account-menu__identity">
            <span className="account-menu__avatar account-menu__avatar--large" aria-hidden>
              {avatarSrc ? <img src={avatarSrc} alt="" /> : accountInitial(username)}
            </span>
            <span>
              <strong>{username}</strong>
              <small>{isAdmin ? "Administrator" : "Player"} · {host}</small>
            </span>
          </div>
          <div className="account-menu__separator" />
          <button type="button" role="menuitem" onClick={run(onAccountSettings)}>
            Account Settings
          </button>
          <button type="button" role="menuitem" onClick={run(onSettings)}>
            Settings
          </button>
          <div className="account-menu__separator" />
          <button type="button" role="menuitem" onClick={run(onSwitchAccount)}>
            Switch Account
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu__logout"
            onClick={run(onLogout)}
          >
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
