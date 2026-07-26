import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { sessionQrPoll, sessionQrStart, type QrSigninStart } from "./api";
import { useSession } from "./SessionContext";

export function QrLoginPanel({
  initialHost,
  onBack,
  onClose,
}: {
  initialHost: string;
  onBack: () => void;
  onClose?: () => void;
}) {
  const { acceptSession } = useSession();
  const [host, setHost] = useState(initialHost || "arcade.orlandoaio.net");
  const [request, setRequest] = useState<QrSigninStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = useMemo(() => {
    if (!request) return "";
    const origin = host.trim().match(/^https?:\/\//i) ? host.trim() : `https://${host.trim()}`;
    const params = new URLSearchParams({
      server: origin.replace(/\/+$/, ""),
      id: request.challengeId,
      secret: request.scanSecret,
    });
    return `arcadelauncher://signin?${params.toString()}`;
  }, [host, request]);

  useEffect(() => {
    if (!request) return;
    let active = true;
    const timer = window.setInterval(() => {
      void sessionQrPoll(host.trim(), request.challengeId, request.pollToken)
        .then((session) => {
          if (!active || !session) return;
          window.clearInterval(timer);
          acceptSession(session);
          onClose?.();
        })
        .catch((err) => {
          if (!active) return;
          window.clearInterval(timer);
          setRequest(null);
          setError(String(err));
        });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [host, request, acceptSession, onClose]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setRequest(await sessionQrStart(host.trim()));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login" onClick={(e) => e.stopPropagation()}>
      <h2 className="login__title">Sign in with QR</h2>
      <p className="login__hint">Scan this code from the QR Login tab in the Arcade Launcher mobile app.</p>
      {!request ? (
        <>
          <label className="settings__field">
            <span className="settings__label">Server</span>
            <input
              className="settings__input"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              spellCheck={false}
            />
          </label>
          {error && <p className="catalog__error">{error}</p>}
          <div className="settings__actions">
            <button className="settings__save" type="button" onClick={begin} disabled={busy || !host.trim()}>
              {busy ? "Creating QR code..." : "Create QR code"}
            </button>
            <button className="login__cancel" type="button" onClick={onBack}>Back</button>
          </div>
        </>
      ) : (
        <div className="login__qr">
          <div className="login__qr-code">
            <QRCodeSVG value={value} size={220} level="M" marginSize={2} />
          </div>
          <p className="login__hint">Waiting for approval on your phone...</p>
          <button className="login__cancel" type="button" onClick={() => setRequest(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
