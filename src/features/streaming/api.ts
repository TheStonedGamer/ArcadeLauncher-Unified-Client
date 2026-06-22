// Typed IPC for remote game streaming. Mirrors the Rust commands in
// src-tauri/src/streaming/commands.rs + engine_session.rs. Pairing/discovery run
// through the stream engine (PIN handshake — no host web credentials); playback
// prefers the bundled engine (`client.start`, with live state events) and falls
// back to the external Moonlight client. Only the host record + its pinned
// certificate live on disk (streaming_hosts.json, owned by Rust).

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

/** Whether a Moonlight client is installed and launchable on this machine. */
export function moonlightAvailable(): Promise<boolean> {
  return call<boolean>("moonlight_available", {});
}

/** Launch Moonlight to stream `app` from `address` with `settings`. */
export function streamLaunch(
  address: string,
  app: string,
  settings: StreamSettings,
): Promise<boolean> {
  return call<boolean>("stream_launch", { address, app, settings });
}

// ---- In-engine playback (engine `client.start`) ---------------------------
// Preferred over external Moonlight when the bundled engine is present: the
// engine streams in its own window and reports live progress as Tauri events.
// Mirrors src-tauri/src/streaming/engine_session.rs.

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
  installed: boolean;
  running: boolean;
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
 *  the account's other devices). Call once on sign-in. */
export function myPcsRegister(host: string, token: string): Promise<void> {
  return call<void>("mypcs_register", { host, token });
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
