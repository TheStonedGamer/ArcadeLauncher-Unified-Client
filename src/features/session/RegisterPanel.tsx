// Self-registration modal. Collects host, username, email and password and calls
// the Rust `session_register` command, which POSTs to the server's
// /api/auth/register. The account is created in a PENDING state: an administrator
// receives an email with Approve/Deny links and must approve before sign-in works.
// The password lives only in this component's local state for the request — it is
// never stored; the Rust command sends it over TLS to the register endpoint.

import { useState, type FormEvent } from "react";
import { useSession } from "./SessionContext";
import { sessionRegister } from "./api";

export function RegisterPanel({ onBack, onClose }: { onBack?: () => void; onClose?: () => void }) {
  const { lastHost } = useSession();
  const [host, setHost] = useState(lastHost || "arcade.orlandoaio.net");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 10;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await sessionRegister(host.trim(), username.trim(), email.trim(), password);
      setPassword("");
      setConfirm("");
      setDone(r.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // After a successful submit, show the pending-approval confirmation instead of
  // the form — there is nothing more for the user to do until an admin approves.
  if (done) {
    return (
      <div className="detail-backdrop" onClick={onClose}>
        <div className="login" onClick={(e) => e.stopPropagation()}>
          <h2 className="login__title">Request submitted</h2>
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
        <h2 className="login__title">Create an account</h2>
        <p className="login__hint">
          New accounts require administrator approval before you can sign in.
        </p>
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
            placeholder="3–32 chars, letters/numbers/_-."
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">Email</span>
          <input
            className="settings__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
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
            autoComplete="new-password"
            placeholder="at least 10 characters"
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">Confirm password</span>
          <input
            className="settings__input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {tooShort && <p className="catalog__error">Password must be at least 10 characters.</p>}
        {mismatch && <p className="catalog__error">Passwords do not match.</p>}
        {error && <p className="catalog__error">{error}</p>}
        <div className="settings__actions">
          <button
            className="settings__save"
            type="submit"
            disabled={
              busy ||
              !host.trim() ||
              !username.trim() ||
              !email.trim() ||
              password.length < 10 ||
              password !== confirm
            }
          >
            {busy ? "Submitting…" : "Request account"}
          </button>
          <button type="button" className="login__cancel" onClick={onBack ?? onClose}>
            Back to sign in
          </button>
        </div>
      </form>
    </div>
  );
}
