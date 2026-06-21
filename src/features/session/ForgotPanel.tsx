// Forgot-password modal. Collects host + an identifier (username or email) and
// calls the Rust `session_forgot` command, which POSTs to /api/auth/forgot. The
// server emails a single-use reset link (valid 1h) and always replies with a
// generic message, so this never reveals whether the account exists. Choosing the
// new password happens on the server-rendered page the emailed link opens — there
// is nothing more for the client to do here.

import { useState, type FormEvent } from "react";
import { useSession } from "./SessionContext";
import { sessionForgot } from "./api";

export function ForgotPanel({ onBack, onClose }: { onBack?: () => void; onClose?: () => void }) {
  const { lastHost, lastUsername } = useSession();
  const [host, setHost] = useState(lastHost || "arcade.orlandoaio.net");
  const [identifier, setIdentifier] = useState(lastUsername || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await sessionForgot(host.trim(), identifier.trim());
      setDone(r.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // After submit, show the generic confirmation (we never confirm the account
  // exists). The user continues from the link in their email.
  if (done) {
    return (
      <div className="detail-backdrop" onClick={onClose}>
        <div className="login" onClick={(e) => e.stopPropagation()}>
          <h2 className="login__title">Check your email</h2>
          <p className="login__hint">{done}</p>
          <div className="settings__actions">
            <button className="settings__save" type="button" onClick={onBack ?? onClose}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <form className="login" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="login__title">Reset password</h2>
        <p className="login__hint">
          Enter your username or email and we'll send a reset link if an account matches.
        </p>
        <label className="settings__field">
          <span className="settings__label">Server</span>
          <input className="settings__input" value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} />
        </label>
        <label className="settings__field">
          <span className="settings__label">Username or email</span>
          <input
            className="settings__input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        {error && <p className="catalog__error">{error}</p>}
        <div className="settings__actions">
          <button
            className="settings__save"
            type="submit"
            disabled={busy || !host.trim() || !identifier.trim()}
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button type="button" className="login__cancel" onClick={onBack ?? onClose}>
            Back to sign in
          </button>
        </div>
      </form>
    </div>
  );
}
