// Typed IPC for remote game streaming (Sunshine/Moonlight). Mirrors the Rust
// commands in src-tauri/src/streaming/commands.rs. Sunshine credentials are
// passed per-call and never persisted client-side; only the host record + its
// pinned certificate live on disk (streaming_hosts.json, owned by Rust).

import { call } from "../../lib/ipc";
import type { StreamSettings } from "./streaming";

/** A Sunshine host on record. Mirrors the Rust `StreamHost`. */
export interface StreamHost {
  name: string;
  address: string;
  paired: boolean;
  /** "unknown" | "offline" | "online" */
  state: string;
  /** SHA-256 cert fingerprint pinned on first pair (hex); empty if unknown. */
  fingerprint: string;
}

/** A game the host advertises. Mirrors the Rust `SunshineApp`. */
export interface SunshineApp {
  name: string;
}

/** Pair with a Sunshine host using its 4-digit PIN. Records the host + pins its
 *  cert on success. Resolves to whether Sunshine accepted the PIN. */
export function sunshinePair(
  address: string,
  username: string,
  password: string,
  pin: string,
  name: string,
): Promise<boolean> {
  return call<boolean>("sunshine_pair", { address, username, password, pin, name });
}

/** List the apps a paired host advertises. Requires a prior pair. */
export function sunshineApps(
  address: string,
  username: string,
  password: string,
): Promise<SunshineApp[]> {
  return call<SunshineApp[]>("sunshine_apps", { address, username, password });
}

/** Add a launcher game to a paired host as a Sunshine app. */
export function sunshineAddApp(
  address: string,
  username: string,
  password: string,
  name: string,
  cmd: string,
  imagePath: string,
): Promise<boolean> {
  return call<boolean>("sunshine_add_app", {
    address,
    username,
    password,
    name,
    cmd,
    imagePath,
  });
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
