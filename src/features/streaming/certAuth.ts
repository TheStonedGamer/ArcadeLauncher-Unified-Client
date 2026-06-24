// Brokered zero-PIN auto-pair (cert pre-authorization, fix A).
//
// GameStream pairing is bidirectional: the host must trust the client's cert (normally PIN-gated)
// AND the client must pin the host's server cert. We broker both halves through the account so a PC
// signed into the same account streams a "My PCs" game with no PIN handshake:
//
//   • Host side (when hosting turns on):
//       1. seedAccountClientCerts — pull every account-registered client cert and seed each into
//          this PC's Sunshine trust store BEFORE Sunshine starts, so they load into `named_devices`.
//       2. publishHostServerCert — after Sunshine is up (its cert.pem now exists), publish this
//          PC's server cert to the account so clients can pin it.
//   • Client side:
//       • publishOwnClientCert — once on sign-in, publish this device's client cert so every host on
//         the account can pre-authorize it.
//       • pinHostBeforePlay — before streaming, pin the target host's published server cert.
//
// Everything here is best-effort: a host that hasn't published its server cert yet (empty
// serverCertPem), or a client this host hasn't trusted yet, falls back to the inline PIN prompt in
// MyPcsView (fix B). These helpers therefore never throw — they return a bool/void and swallow
// transport errors so a failed pre-auth degrades to the PIN path rather than breaking Play/hosting.

import {
  clientCertList,
  clientCertRegister,
  engineHostDeviceInfo,
  engineHostTrustClient,
  engineIdentity,
  engineTrustHost,
  myPcsRegister,
  type MyPc,
} from "./api";

/** Seed every account-registered client cert into this PC's Sunshine trust store so those devices
 *  stream without a PIN. Call BEFORE host.enable so the certs load into `named_devices` at start.
 *  Returns true if any newly-seeded cert needs a Sunshine restart to take effect (i.e. it was added
 *  while Sunshine was already running) — the caller should cycle hosting to apply it. */
export async function seedAccountClientCerts(host: string, token: string): Promise<boolean> {
  try {
    const certs = await clientCertList(host, token);
    let restartNeeded = false;
    for (const c of certs) {
      if (!c.certPem) continue;
      try {
        const res = await engineHostTrustClient(c.name || c.deviceId, c.certPem);
        if (res.restartRequired) restartNeeded = true;
      } catch {
        /* one bad cert shouldn't block the rest; that device falls back to PIN pairing */
      }
    }
    return restartNeeded;
  } catch {
    return false; // can't reach the registry → clients fall back to PIN pairing
  }
}

/** Publish this PC's Sunshine server cert to the account so clients can pin it (zero-PIN auto-pair).
 *  Call AFTER host.enable, once Sunshine has created its cert.pem. Returns the published cert PEM on
 *  success (so the caller can remember it), or null if it isn't readable yet (Sunshine still
 *  starting) or the push failed. Clients fall back to PIN pairing until it lands.
 *
 *  `lastPublished` lets the heartbeat call this every beat cheaply: when the current cert still
 *  matches what we last pushed, we skip the POST and just echo it back. Crucially this means a
 *  mid-session cert.pem **regeneration** (Sunshine re-mints its cert) propagates to the registry on
 *  the next beat instead of being latched forever — the stale-pin cause of "serverinfo over HTTPS
 *  failed — the pairing may be stale" on every client. */
export async function publishHostServerCert(
  host: string,
  token: string,
  lastPublished = "",
): Promise<string | null> {
  try {
    const info = await engineHostDeviceInfo();
    if (!info.serverCertPem) return null; // Sunshine hasn't minted its cert yet — retry next beat
    if (info.serverCertPem === lastPublished) return lastPublished; // unchanged → no redundant POST
    await myPcsRegister(host, token, info.serverCertPem);
    return info.serverCertPem;
  } catch {
    return null; // best-effort; the host is still reachable via PIN pairing
  }
}

/** Publish this device's client cert to the account once, so every host can pre-authorize it.
 *  Idempotent server-side; safe to call on each sign-in. */
export async function publishOwnClientCert(host: string, token: string): Promise<void> {
  try {
    const id = await engineIdentity();
    if (!id.clientCertPem) return; // engine without OpenSSL identity → fall back to PIN pairing
    await clientCertRegister(host, token, id.clientCertPem);
  } catch {
    /* best-effort; streaming still works via the PIN prompt */
  }
}

/** Pin a host's published server cert before streaming so `client.start` doesn't fail `not_paired`.
 *  No-op when the host hasn't published a cert yet (empty serverCertPem) — Play then surfaces the
 *  inline PIN prompt (fix B). Never throws: a failed pin shouldn't block the Play attempt itself. */
export async function pinHostBeforePlay(address: string, pc: MyPc): Promise<void> {
  if (!pc.serverCertPem) return;
  try {
    await engineTrustHost(address, pc.name, pc.serverCertPem);
  } catch {
    /* best-effort; if pinning fails the stream attempt still runs and B catches not_paired */
  }
}
