// Background ringing. The in-app half (useRing) only works while the app is
// running; this is what makes a call reach a phone whose app is closed or whose
// screen is locked.
//
// The push itself is only an announcement: tapping it opens the app, the socket
// connects, and the server replays the still-live invite as an ordinary one. So
// nothing about the call is trusted to the notification payload, and a push
// that arrives late for a call that is already over rings nothing.
//
// Requires the app to be built with a google-services.json from the project
// whose service account the server holds. Without it `getDevicePushTokenAsync`
// throws, which is caught here: the app keeps working, background ringing just
// does not happen.

import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { registerPushToken, unregisterPushToken } from "./api";
import type { MobileSession } from "./core/session";

/** What Settings needs to say about background ringing, honestly. */
export type PushStatus =
  | "idle"
  | "unsupported"
  | "denied"
  | "registered"
  | "server-disabled"
  | "error";

export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  idle: "Setting up…",
  unsupported: "This build cannot receive call notifications.",
  denied: "Notifications are turned off for this app, so calls cannot ring it.",
  registered: "This phone will ring for calls even when the app is closed.",
  "server-disabled": "The server is not set up to send call notifications yet.",
  error: "Could not register this phone for call notifications.",
};

/** Register this device for call pushes while signed in, and un-register on
 *  sign-out. The token is re-fetched per session rather than cached: FCM
 *  rotates it, and a stale token is a phone that silently stops ringing. */
export function usePush(session: MobileSession | null): PushStatus {
  const [status, setStatus] = useState<PushStatus>("idle");

  useEffect(() => {
    if (!session) {
      setStatus("idle");
      return;
    }
    let alive = true;
    let registered = "";

    void (async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted;
        if (!granted && existing.canAskAgain) {
          granted = (await Notifications.requestPermissionsAsync()).granted;
        }
        if (!alive) return;
        if (!granted) {
          setStatus("denied");
          return;
        }
        // The *device* token (FCM/APNs), not an Expo push token: the server
        // talks to FCM directly rather than through Expo's service.
        const token = await Notifications.getDevicePushTokenAsync();
        if (!alive) return;
        const value = String(token.data ?? "");
        if (!value) {
          setStatus("unsupported");
          return;
        }
        const enabled = await registerPushToken(session, value, Platform.OS);
        if (!alive) return;
        registered = value;
        setStatus(enabled ? "registered" : "server-disabled");
      } catch {
        if (alive) setStatus("unsupported");
      }
    })();

    return () => {
      alive = false;
      // Best-effort, and deliberately not awaited: signing out should not wait
      // on the network, and the server also drops the token when FCM reports it
      // dead.
      if (registered) void unregisterPushToken(session, registered).catch(() => {});
    };
  }, [session]);

  return status;
}
