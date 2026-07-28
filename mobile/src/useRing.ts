// Making an incoming call noticeable. The overlay alone is not enough: a phone
// in a pocket needs to buzz, and a phone whose screen is on something else
// needs a notification to tap. Both are preferences, because the person who
// wants neither has a real reason for it.
//
// Only the *in-app* half lives here — the socket is already connected and the
// invite already arrived. Waking a phone whose app is not running at all is the
// push path (push.ts), which this deliberately does not duplicate.

import { useEffect } from "react";
import { Vibration } from "react-native";
import * as Notifications from "expo-notifications";

import type { CallState } from "./core/call";
import { RING_VIBRATION, type RingSettings } from "./core/settings";

/** The notification channel Android rings calls on. Created up front so the
 *  first incoming call is not also the first time the channel exists. */
const CALL_CHANNEL = "calls";

export async function ensureCallChannel(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(CALL_CHANNEL, {
      name: "Incoming calls",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: RING_VIBRATION,
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    // No channel means a quieter notification, not a broken app.
  }
}

/** Buzz and notify while a call is ringing; stop the moment it is not.
 *
 *  The cleanup is what matters here: a vibration started with `repeat` runs
 *  until it is cancelled, so every path out of "ringing" — answered, declined,
 *  the caller giving up, the socket dropping — has to end it, and returning the
 *  stop from the effect is the only way to get that for free. */
export function useRing(state: CallState, peerName: string, settings: RingSettings): void {
  const ringing = state.phase === "ringing";

  useEffect(() => {
    if (!ringing || !settings.vibrate) return;
    Vibration.vibrate(RING_VIBRATION, true);
    return () => Vibration.cancel();
  }, [ringing, settings.vibrate]);

  useEffect(() => {
    if (!ringing || !settings.notify) return;
    let id: string | null = null;
    let cancelled = false;
    void Notifications.scheduleNotificationAsync({
      content: {
        title: state.wantsVideo ? "Incoming video call" : "Incoming call",
        body: peerName ? `${peerName} is calling` : "Someone is calling",
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null,
    })
      .then((scheduled) => {
        // The call can end while the notification is still being posted; drop
        // it immediately in that case rather than leaving it on the shade.
        if (cancelled) void Notifications.dismissNotificationAsync(scheduled);
        else id = scheduled;
      })
      .catch(() => {
        // Notifications denied — the overlay and the buzz still do their job.
      });
    return () => {
      cancelled = true;
      if (id) void Notifications.dismissNotificationAsync(id);
    };
  }, [ringing, settings.notify, peerName, state.wantsVideo]);
}
