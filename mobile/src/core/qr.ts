import { normalizeHost } from "./session";

export interface QrSigninChallenge {
  server: string;
  challengeId: string;
  scanSecret: string;
}

/** Parse only Arcade Launcher's versioned sign-in URI. No network request is
 * made here; the screen separately requires this host to match its session. */
export function parseQrSignin(raw: string): QrSigninChallenge | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "arcadelauncher:" || url.hostname !== "signin") return null;
    const server = url.searchParams.get("server") ?? "";
    const challengeId = url.searchParams.get("id") ?? "";
    const scanSecret = url.searchParams.get("secret") ?? "";
    if (!server || !challengeId || !scanSecret) return null;
    const parsedServer = new URL(server);
    if (parsedServer.protocol !== "https:" || parsedServer.pathname.replace(/\/+$/, "")) return null;
    return { server: parsedServer.origin, challengeId, scanSecret };
  } catch {
    return null;
  }
}

/** The phone's bearer credential may only ever be sent back to the same server
 * where it was issued, never to an arbitrary host supplied by a QR code. */
export function qrMatchesSessionServer(challenge: QrSigninChallenge, sessionHost: string): boolean {
  return normalizeHost(challenge.server).toLowerCase() === normalizeHost(sessionHost).toLowerCase();
}

export interface QrSigninDetails {
  challengeId: string;
  target: "launcher" | "store";
  deviceName: string;
  ip: string;
  expiresIn: number;
}

export function parseQrSigninDetails(body: unknown): QrSigninDetails | null {
  if (!body || typeof body !== "object") return null;
  const v = body as Record<string, unknown>;
  if (
    typeof v.challengeId !== "string" ||
    (v.target !== "launcher" && v.target !== "store") ||
    typeof v.deviceName !== "string" ||
    typeof v.ip !== "string" ||
    typeof v.expiresIn !== "number"
  ) {
    return null;
  }
  return {
    challengeId: v.challengeId,
    target: v.target,
    deviceName: v.deviceName,
    ip: v.ip,
    expiresIn: v.expiresIn,
  };
}
