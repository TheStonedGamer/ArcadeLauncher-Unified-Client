// Phone-side preferences: microphone processing for calls, and how the phone
// announces an incoming one. Pure — this file turns stored JSON into a complete
// settings object and into WebRTC capture constraints, and nothing here touches
// the keystore, the vibrator or the socket.
//
// The audio half mirrors the desktop's src/features/social/audio.ts and the Rust
// `VoiceAudio` in src-tauri/src/settings/model.rs, so the same three switches
// mean the same three things on every client.

/** Microphone processing applied inside the capture pipeline, before encoding,
 *  so the peer hears the cleaned signal at no CPU cost to us. */
export interface VoiceAudioSettings {
  /** Remove the other side's voice leaking back through the earpiece. */
  echoCancellation: boolean;
  /** Suppress steady background noise — traffic, fans, hum. */
  noiseSuppression: boolean;
  /** Even out the level so a quiet or loud mic still lands sensibly. */
  autoGainControl: boolean;
}

/** How an incoming call announces itself. */
export interface RingSettings {
  /** Vibrate the phone while it rings. */
  vibrate: boolean;
  /** Post a heads-up notification, so a call is visible when the app is not
   *  the thing on screen. */
  notify: boolean;
}

export interface MobileSettings {
  voiceAudio: VoiceAudioSettings;
  ring: RingSettings;
}

/** All processing on, ringing fully announced — what a phone does by default. */
export const DEFAULT_SETTINGS: MobileSettings = {
  voiceAudio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  ring: { vibrate: true, notify: true },
};

function flag(x: unknown, fallback: boolean): boolean {
  return typeof x === "boolean" ? x : fallback;
}

/** Coerce anything loaded from storage — including nothing at all, or a file
 *  written by a build that predates a field — into a complete settings object.
 *  A bad value falls back per field rather than discarding the whole file. */
export function parseSettings(raw: string | null | undefined): MobileSettings {
  let v: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") v = parsed as Record<string, unknown>;
    } catch {
      // Corrupt settings are the same as no settings: defaults, not a crash.
    }
  }
  const a = (v.voiceAudio ?? {}) as Record<string, unknown>;
  const r = (v.ring ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    voiceAudio: {
      echoCancellation: flag(a.echoCancellation, d.voiceAudio.echoCancellation),
      noiseSuppression: flag(a.noiseSuppression, d.voiceAudio.noiseSuppression),
      autoGainControl: flag(a.autoGainControl, d.voiceAudio.autoGainControl),
    },
    ring: {
      vibrate: flag(r.vibrate, d.ring.vibrate),
      notify: flag(r.notify, d.ring.notify),
    },
  };
}

/** Capture constraints for the call microphone.
 *
 *  Each flag is stated explicitly rather than omitted when off: an absent
 *  constraint means "engine's choice", which for these three is usually *on* —
 *  so leaving one out would quietly ignore a user who turned it off. */
export function micConstraints(settings: VoiceAudioSettings) {
  return {
    audio: {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    },
    video: false,
  };
}

/** One-line summary of the active processing, for the settings screen. */
export function voiceAudioSummary(s: VoiceAudioSettings): string {
  const on = [
    s.noiseSuppression && "noise suppression",
    s.echoCancellation && "echo cancellation",
    s.autoGainControl && "auto gain",
  ].filter((x): x is string => typeof x === "string");
  if (on.length === 0) return "No microphone processing — your raw input is sent.";
  return `Active: ${on.join(", ")}.`;
}

/** The vibration pattern for a ringing call: a pause, a buzz, repeated by the
 *  caller passing `repeat`. Expressed here so it is testable and shared. */
export const RING_VIBRATION: number[] = [0, 700, 900];
