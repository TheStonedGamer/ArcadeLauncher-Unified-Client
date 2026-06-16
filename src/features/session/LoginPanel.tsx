// Sign-in modal. Collects host, username, password and optional 2FA code and
// calls the Rust login command (challenge-response). The password lives only in
// this component's local state for the duration of the request — it is never
// stored or sent anywhere but the login command.

import { useState, type FormEvent } from "react";
import { useSession } from "./SessionContext";

export function LoginPanel({ onClose }: { onClose?: () => void }) {
  const { login, lastHost, lastUsername } = useSession();
  const [host, setHost] = useState(lastHost || "arcade.orlandoaio.net");
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(host.trim(), username.trim(), password, totp.trim());
      setPassword("");
      onClose?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <form className="login" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="login__title">Sign in</h2>
        <label className="settings__field">
          <span className="settings__label">Server</span>
          <input className="settings__input" value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} />
        </label>
        <label className="settings__field">
          <span className="settings__label">Username</span>
          <input
            className="settings__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">Password</span>
          <input
            className="settings__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">2FA code (if enabled)</span>
          <input
            className="settings__input"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            inputMode="numeric"
            placeholder="000000"
            spellCheck={false}
          />
        </label>
        {error && <p className="catalog__error">{error}</p>}
        <div className="settings__actions">
          <button className="settings__save" type="submit" disabled={busy || !host.trim() || !username.trim()}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {onClose && (
            <button type="button" className="login__cancel" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
