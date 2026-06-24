// Typed IPC for remote game streaming. Mirrors the Rust commands in
// src-tauri/src/streaming/commands.rs + engine_session.rs. Pairing/discovery run
// through the stream engine (PIN handshake — no host web credentials); playback
// runs through the bundled engine (`client.start`, with live state events). Only
// the host record + its pinned certificate live on disk (streaming_hosts.json,
// owned by Rust).

import { call } from "../../lib/ipc";
import type { StreamSettings } from "./streaming";

/** A streaming host on record. Mirrors the Rust `StreamHost`. */
export interface StreamHost {
  name: string;
  address: string;
  paired: boolean;
  /** "unknown" | "offline" | "online" */
  state: string;
  /** SHA-256 cert fingerprint pinned on first pair (hex); empty if unknown. */
  fingerprint: string;
}

/** Pair with a host using its 4-digit GameStream PIN, via the stream engine.
 *  Records the host + pins its cert on success. Resolves to whether the engine
 *  reported a successful pair. */
export function hostPair(address: string, pin: string, name: string): Promise<boolean> {
  return call<boolean>("host_pair", { address, pin, name });
}

/** The hosts on record (for the host picker). Read-only. */
export function streamingHosts(): Promise<StreamHost[]> {
  return call<StreamHost[]>("streaming_hosts", {});
}

/** Forget a host (drops its record + pin). Resolves to whether one was removed. */
export function streamingForgetHost(address: string): Promise<boolean> {
  return call<boolean>("streaming_forget_host", { address });
}

// ---- In-engine playback (engine `client.start`) ---------------------------
// The bundled engine streams in its own window and reports live progress as
// Tauri events. Mirrors src-tauri/src/streaming/engine_session.rs.

/** Tauri event carrying a raw engine `stream.state` payload (`{phase, reason?}`). */
export const STREAM_STATE_EVENT = "stream://state";
/** Tauri event carrying a raw engine `stream.stats` payload (fps/bitrate/rtt/…). */
export const STREAM_STATS_EVENT = "stream://stats";

/** Whether the bundled stream engine is installed (so the UI can prefer in-engine
 *  playback over external Moonlight). */
export function engineStreamAvailable(): Promise<boolean> {
  return call<boolean>("engine_stream_available", {});
}

/** Start streaming `app` from `address` through the engine. Resolves once the
 *  stream has started; live progress arrives as STREAM_STATE/STATS events. The
 *  engine's in-band errors (`not_paired`, `host_unreachable`, `app_not_found`, …)
 *  reject this promise. */
export function streamStart(
  address: string,
  app: string,
  settings: StreamSettings,
): Promise<boolean> {
  return call<boolean>("stream_start", { address, app, settings });
}

/** Stop the current engine stream (graceful). Idempotent. */
export function streamStop(): Promise<boolean> {
  return call<boolean>("stream_stop", {});
}

// ---- Stream engine (client + host modes) ----------------------------------
// Thin typed wrappers over the engine IPC (src-tauri/src/streaming/engine_conn.rs).
// The engine returns raw JSON; these shape it. NOTE: a host.* call still surfaces
// honest errors when this PC has no host installed (e.g. `not_installed`), so
// callers must tolerate them and degrade.

/** A host the engine knows about (engine `client.hosts`). */
export interface EngineHost {
  name: string;
  address: string;
  paired: boolean;
  /** "unknown" | "offline" | "online" */
  state: string;
}

/** A streamable app a host advertises (engine `client.apps`). */
export interface EngineApp {
  name: string;
}

/** This machine's hosting status (engine `host.status`). */
export interface HostStatus {
  /** A Sunshine is available to host (bundled/system install, or one already running) — so the
   *  launcher needn't download its sidecar. */
  installed: boolean;
  /** A Sunshine host is active — our own child OR an adopted instance the user already had up. */
  running: boolean;
  /** True only when the engine itself started the running host (so it may stop it). `running &&
   *  !managed` ⇒ the user's own Sunshine, which we adopt but never stop. */
  managed: boolean;
  configured: boolean;
  gpuCapable: boolean;
  appsCount: number;
}

/** A game this host currently exposes (engine `host.listApps`). */
export interface HostApp {
  gameKey: string;
  name: string;
  coverRef: string;
}

/** Result of publishing the library to the host (engine `host.syncApps`). */
export interface SyncResult {
  added: number;
  removed: number;
  updated: number;
}

/** One game to publish to the host (engine `host.syncApps` input). */
export interface HostGame {
  id: string;
  name: string;
  coverPath: string;
  launchCmd: string;
}

/** Discover hosts the engine knows about (engine `client.hosts`). */
export function engineHosts(): Promise<{ hosts: EngineHost[] }> {
  return call<{ hosts: EngineHost[] }>("engine_hosts", {});
}

/** List a host's streamable apps via the engine (engine `client.apps`). */
export function engineApps(host: string): Promise<{ apps: EngineApp[] }> {
  return call<{ apps: EngineApp[] }>("engine_apps", { host });
}

/** Stop the current engine stream (engine `client.stop`). */
export function engineStop(): Promise<unknown> {
  return call("engine_stop", {});
}

// ---- Cert pre-authorization (brokered zero-PIN auto-pair, fix A) -----------
// The host trusts a client by seeding its cert into Sunshine; the client pins the
// host's server cert. Both halves are brokered through the account registry so a
// PC signed into the same account streams a My PCs game with no PIN handshake.

/** This client's stable identity (engine `client.identity`). `clientCertPem` is published to the
 *  account so hosts can pre-authorize this PC. */
export function engineIdentity(): Promise<{ clientCertPem: string; uniqueId: string }> {
  return call<{ clientCertPem: string; uniqueId: string }>("engine_identity", {});
}

/** Pin a host's server cert without the PIN handshake (engine `client.trustHost`). Call before
 *  playing a My PCs game so `client.start` no longer fails `not_paired`. */
export function engineTrustHost(
  host: string,
  name: string,
  serverCertPem: string,
): Promise<unknown> {
  return call("engine_trust_host", { host, name, serverCertPem });
}

/** This host's identity incl. its Sunshine server cert (engine `host.deviceInfo`). */
export function engineHostDeviceInfo(): Promise<{
  deviceId: string;
  lanAddr: string;
  meshAddr: string;
  certFingerprint: string;
  serverCertPem: string;
}> {
  return call("engine_host_device_info", {});
}

/** Authorize a streaming client without a PIN (engine `host.trustClient`) by seeding its cert into
 *  Sunshine's trust store. `restartRequired` ⇒ a newly-seeded cert needs a Sunshine restart. */
export function engineHostTrustClient(
  name: string,
  certPem: string,
): Promise<{ trusted: boolean; alreadyTrusted: boolean; restartRequired: boolean }> {
  return call("engine_host_trust_client", { name, certPem });
}

/** One account-registered streaming-client cert. */
export interface ClientCert {
  deviceId: string;
  name: string;
  certPem: string;
}

/** Publish this device's client cert to the account registry so hosts can pre-authorize it. */
export function clientCertRegister(host: string, token: string, certPem: string): Promise<void> {
  return call<void>("client_cert_register", { host, token, certPem });
}

/** Every client cert registered to the account — hosts seed these into Sunshine when hosting. */
export function clientCertList(host: string, token: string): Promise<ClientCert[]> {
  return call<ClientCert[]>("client_cert_list", { host, token });
}

/** This PC's hosting status (engine `host.status`). */
export function hostStatus(): Promise<HostStatus> {
  return call<HostStatus>("engine_host_status", {});
}

/** Start/stop hosting this PC (engine `host.enable`). */
export function hostEnable(on: boolean): Promise<{ running: boolean }> {
  return call<{ running: boolean }>("engine_host_enable", { on });
}

/** Publish games to the host as streamable apps (engine `host.syncApps`). */
export function hostSyncApps(games: HostGame[]): Promise<SyncResult> {
  return call<SyncResult>("engine_host_sync_apps", { games });
}

/** The games this host currently exposes (engine `host.listApps`). */
export function hostListApps(): Promise<{ apps: HostApp[] }> {
  return call<{ apps: HostApp[] }>("engine_host_list_apps", {});
}

/** Whether the (unbundled) Sunshine host sidecar has been downloaded on this PC. */
export interface HostInstallStatus {
  installed: boolean;
  version: string;
  path: string;
}

/** Is the Sunshine host sidecar present locally? Also wires the engine to it. */
export function hostInstallStatus(): Promise<HostInstallStatus> {
  return call<HostInstallStatus>("host_install_status", {});
}

/** Fetch + unpack the Sunshine host sidecar. No-op if already installed unless
 *  `force` is set, which wipes and re-downloads it (reinstall / repair / update). */
export function hostInstall(force = false): Promise<HostInstallStatus> {
  return call<HostInstallStatus>("host_install", { force });
}

// ---- My PCs: account-brokered device discovery (T12k-7 / T12k-9) -----------
// Every PC signed into the same ArcadeLauncher account auto-appears in My PCs —
// no IP typing. Mirrors src-tauri/src/streaming/mypcs_commands.rs. Discovery is
// push-driven by the server's `stream_host_update` social frame (see useMyPcs).

/** A PC signed into the account (Rust `MyPc`). `online` is server-derived from
 *  last-seen freshness; an offline PC is still listed (greyed) with its
 *  last-known library browsable. Addresses may be empty. */
export interface MyPc {
  deviceId: string;
  name: string;
  lanAddr: string;
  meshAddr: string;
  certFp: string;
  /** The host's Sunshine server cert PEM — pinned (engine `client.trustHost`) before play for
   *  zero-PIN auto-pair. Empty until the host has published it (after its first host-enable). */
  serverCertPem: string;
  online: boolean;
  lastSeen: number;
}

/** One game a PC has published (Rust `MyPcApp`). `coverRef` is a relative art ref. */
export interface MyPcApp {
  gameKey: string;
  name: string;
  coverRef: string;
}

/** This device's identity + advertised connect paths (Rust `SelfDevice`). */
export interface SelfDevice {
  deviceId: string;
  name: string;
  lanAddr: string;
  meshAddr: string;
  certFp: string;
}

/** This device's descriptor (id/name/addresses) — for self-exclusion + announce. */
export function myPcsSelf(): Promise<SelfDevice> {
  return call<SelfDevice>("mypcs_self", {});
}

/** A ready-to-send `stream_host_announce` WS frame (JSON string) to push via the
 *  social socket on a heartbeat, keeping this PC "online" to other devices. */
export function myPcsAnnounceFrame(): Promise<string> {
  return call<string>("mypcs_announce_frame", {});
}

/** Register/upsert this device into the account registry (durable, also notifies
 *  the account's other devices). Call once on sign-in. Pass `serverCertPem` (from the host engine)
 *  only when host mode is on, to publish this PC's Sunshine cert for zero-PIN auto-pair; the server
 *  preserves any stored cert when it is omitted. */
export function myPcsRegister(
  host: string,
  token: string,
  serverCertPem?: string,
): Promise<void> {
  return call<void>("mypcs_register", { host, token, serverCertPem });
}

/** Every *other* PC on the account (this device excluded). */
export function myPcs(host: string, token: string): Promise<MyPc[]> {
  return call<MyPc[]>("mypcs_list", { host, token });
}

/** Forget one of the caller's devices (and its published apps). */
export function forgetPc(host: string, token: string, deviceId: string): Promise<void> {
  return call<void>("mypcs_forget", { host, token, deviceId });
}

/** A PC's last-published library (browsable even while it is offline). */
export function pcApps(host: string, token: string, deviceId: string): Promise<MyPcApp[]> {
  return call<MyPcApp[]>("mypcs_apps", { host, token, deviceId });
}

/** Publish this device's library so its games are browsable from other devices. */
export function publishMyLibrary(
  host: string,
  token: string,
  apps: MyPcApp[],
): Promise<void> {
  return call<void>("mypcs_publish", { host, token, apps });
}

// ---- Play-from-anywhere mesh (T12k-8) -------------------------------------
// When a host PC isn't reachable on the LAN, the launcher's bundled Tailscale
// joins the self-hosted Headscale overlay (a server-minted, single-use pre-auth
// key — no interactive login) so the host's 100.64.x.x mesh IP becomes dialable
// by the existing stream path. Mesh-join cmds mirror the Rust in
// src-tauri/src/streaming/mesh/conn.rs; the pre-auth key comes from the server
// (POST /api/social/mesh/preauth) using the existing session.

/** Local mesh membership (Rust `MeshState`). `phase`: "down"|"connecting"|"up". */
export interface MeshState {
  phase: string;
  selfIp: string | null;
  lastError: string | null;
}

/** Server-minted pre-auth key + the overlay coordinates to join with. Mirrors the
 *  `/api/social/mesh/preauth` JSON. `loginServer` is the Headscale control URL the
 *  bundled tailscaled joins; `user` is informational. */
export interface MeshPreauth {
  key: string;
  loginServer: string;
  user: string;
  ephemeral: boolean;
  expiresAt: string;
}

/** Are the bundled Tailscale binaries present? (False until the installer bundles
 *  them — gate 2 — so the UI keeps remote-play-over-internet inert, not broken.) */
export function meshIsAvailable(): Promise<boolean> {
  return call<boolean>("mesh_is_available", {});
}

/** This node's current mesh state (phase + our mesh IP). */
export function meshStatus(): Promise<MeshState> {
  return call<MeshState>("mesh_status", {});
}

/** Join the overlay with a server-minted pre-auth key. `ephemeral` true for a
 *  stream client (auto-reaped), false for a persistent host. */
export function meshJoin(authKey: string, hostname: string, ephemeral: boolean): Promise<MeshState> {
  return call<MeshState>("mesh_join", { authKey, hostname, ephemeral });
}

/** Resolve a paired host's mesh IP by its node hostname (null if offline/absent). */
export function meshResolveHost(hostname: string): Promise<string | null> {
  return call<string | null>("mesh_resolve_host", { hostname });
}

/** Mint a single-use Headscale pre-auth key for this device via the server
 *  (account-gated by the session token). `ephemeral` true for a stream client. */
export function meshPreauth(
  host: string,
  token: string,
  hostname: string,
  ephemeral: boolean,
): Promise<MeshPreauth> {
  return call<MeshPreauth>("mesh_preauth", { host, token, hostname, ephemeral });
}
