// The phone's half of the /ws/social wire protocol.
//
// Pure and IO-free on purpose: this file is covered by the repo-root vitest run
// on both CI legs, so the frame shapes are checked on Linux and Windows without
// a device, an emulator or a live gateway anywhere in the loop. The socket
// itself (and everything React) lives in ../gateway.ts and ../screens.
//
// Shapes are taken from the server's social_api.rs handlers rather than guessed:
// where the server reads `msgId`, this sends `msgId`.

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface Hello {
  type: "hello";
  selfId: number;
  /** The device identity the server accepted, or null if it rejected ours. */
  deviceId: string | null;
}

export interface ChatFrame {
  type: "chat";
  messageId: number;
  senderId: number;
  receiverId: number;
  text: string;
  attachmentId: number;
  replyTo: number;
  timestamp: number;
}

export interface PresenceFrame {
  type: "presence";
  userId: number;
  state: string;
  gameTitle: string;
}

export interface DeviceEntry {
  id: string;
  name: string;
  kind: string;
  version: string;
}

export interface DevicesFrame {
  type: "devices";
  devices: DeviceEntry[];
}

export interface InstallAckFrame {
  type: "remote_install_ack";
  deviceId: string;
  gameId: string;
  ok: boolean;
  error: string | null;
  message: string;
}

export interface InstallResultFrame {
  type: "remote_install_result";
  deviceId: string | null;
  gameId: string;
  status: string;
  message: string;
}

export interface GuardRequestFrame {
  type: "guard_request";
  requestId: string;
  prompt: string;
  deviceName: string;
  ip: string;
  expiresIn: number;
}

/** Opaque WebRTC signalling relayed between two friends. The server does not
 *  look inside `payload`; core/call.ts narrows it at the far end. */
export interface VoiceSignalFrame {
  type: "voice_signal";
  fromId: number;
  payload: unknown;
}

export interface UnknownFrame {
  type: "unknown";
  raw: string;
}

export type Frame =
  | Hello
  | ChatFrame
  | PresenceFrame
  | DevicesFrame
  | InstallAckFrame
  | InstallResultFrame
  | GuardRequestFrame
  | VoiceSignalFrame
  | UnknownFrame;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;

/** Parse one text frame. Anything unrecognised or malformed becomes an
 *  `unknown` frame rather than throwing: a newer server must be able to add
 *  frames without crashing an older phone. */
export function parseFrame(raw: string): Frame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { type: "unknown", raw };
  }
  if (!value || typeof value !== "object") return { type: "unknown", raw };
  const f = value as Record<string, unknown>;
  switch (f.type) {
    case "hello":
      return {
        type: "hello",
        selfId: num(f.selfId),
        deviceId: typeof f.deviceId === "string" && f.deviceId ? f.deviceId : null,
      };
    case "chat":
      return {
        type: "chat",
        messageId: num(f.messageId),
        senderId: num(f.senderId),
        receiverId: num(f.receiverId),
        text: str(f.text),
        attachmentId: num(f.attachmentId),
        replyTo: num(f.replyTo),
        timestamp: num(f.timestamp),
      };
    case "presence":
      return {
        type: "presence",
        userId: num(f.userId),
        state: str(f.state) || "offline",
        gameTitle: str(f.gameTitle),
      };
    case "devices":
      return {
        type: "devices",
        devices: Array.isArray(f.devices) ? f.devices.map(parseDevice).filter(isDevice) : [],
      };
    case "remote_install_ack":
      return {
        type: "remote_install_ack",
        deviceId: str(f.deviceId),
        gameId: str(f.gameId),
        ok: bool(f.ok),
        error: typeof f.error === "string" ? f.error : null,
        message: str(f.message),
      };
    case "remote_install_result":
      return {
        type: "remote_install_result",
        deviceId: typeof f.deviceId === "string" ? f.deviceId : null,
        gameId: str(f.gameId),
        status: str(f.status) || "unknown",
        message: str(f.message),
      };
    case "voice_signal":
      return { type: "voice_signal", fromId: num(f.fromId), payload: f.payload };
    case "guard_request":
      return {
        type: "guard_request",
        requestId: str(f.requestId),
        prompt: str(f.prompt),
        deviceName: str(f.deviceName),
        ip: str(f.ip),
        expiresIn: num(f.expiresIn),
      };
    default:
      return { type: "unknown", raw };
  }
}

function parseDevice(value: unknown): DeviceEntry | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const id = str(d.id).trim();
  if (!id) return null;
  return { id, name: str(d.name) || id, kind: str(d.kind) || "unknown", version: str(d.version) };
}

function isDevice(d: DeviceEntry | null): d is DeviceEntry {
  return d !== null;
}

/** Devices this phone may send an install to. Mirrors the server's rule so the
 *  picker cannot offer a target the relay will then refuse. */
export function installTargets(devices: DeviceEntry[]): DeviceEntry[] {
  return devices.filter((d) => d.kind === "desktop");
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export const outbound = {
  ping: (): string => JSON.stringify({ type: "ping" }),

  chat: (to: number, text: string, replyTo = 0, attachmentId = 0): string => {
    const frame: Record<string, unknown> = { type: "chat", to, text };
    if (replyTo > 0) frame.replyTo = replyTo;
    if (attachmentId > 0) frame.attachmentId = attachmentId;
    return JSON.stringify(frame);
  },

  typing: (to: number): string => JSON.stringify({ type: "typing", to }),

  read: (to: number): string => JSON.stringify({ type: "read", to }),

  presence: (state: string): string => JSON.stringify({ type: "presence", state }),

  /** Ask for the account's signed-in machines. */
  devices: (): string => JSON.stringify({ type: "devices" }),

  remoteInstall: (deviceId: string, gameId: string, gameTitle: string): string =>
    JSON.stringify({ type: "remote_install", deviceId, gameId, gameTitle }),

  /** Relay one opaque WebRTC signalling payload to a friend. The server gates
   *  the (caller, peer) pair on invite/accept/end, so those kinds must travel
   *  inside the payload alongside offer/answer/ice — see core/call.ts. */
  voiceSignal: (to: number, payload: unknown): string => JSON.stringify({ type: "voice_signal", to, payload }),

  /** Answer a sign-in push. */
  guardDecision: (requestId: string, approve: boolean): string =>
    JSON.stringify({
      type: "guard_decision",
      requestId,
      action: approve ? "approve" : "deny",
    }),
};

/** The gateway URL, with this phone's identity attached so it can be told
 *  apart from the owner's PCs. Empty fields are omitted, matching the desktop
 *  client's `ws_url_with_device`. */
export function gatewayUrl(
  host: string,
  token: string,
  device: { id: string; name: string; version: string },
): string {
  const bare = host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "")
    .replace(/\/+$/, "");
  const params = new URLSearchParams({ token });
  if (device.id.trim()) params.set("deviceId", device.id.trim());
  if (device.name.trim()) params.set("deviceName", device.name.trim());
  params.set("deviceKind", "mobile");
  if (device.version.trim()) params.set("appVersion", device.version.trim());
  return `wss://${bare}/ws/social?${params.toString()}`;
}
