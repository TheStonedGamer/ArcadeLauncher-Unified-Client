// Microphone processing for voice calls. The browser can run echo cancellation,
// noise suppression and automatic gain control inside the capture pipeline —
// before encoding, so the peer hears the cleaned signal and no extra CPU is
// spent on our side. Until now we passed a bare `audio: true`, which leaves all
// three to whatever the engine defaults to; these settings make them explicit
// and user-controllable.
//
// Pure and IO-free: this turns settings into constraints, `useVoice` and
// `useGroupVoice` hand the result to getUserMedia. Mirrors the Rust `VoiceAudio`
// in src-tauri/src/settings/model.rs.

/** Per-device microphone processing preferences. */
export interface VoiceAudioSettings {
  /** Remove the other side's voice leaking back through your speakers. */
  echoCancellation: boolean;
  /** Suppress steady background noise — fans, keyboards, hum. */
  noiseSuppression: boolean;
  /** Even out your level so a quiet or loud mic still lands sensibly. */
  autoGainControl: boolean;
}

/** All processing on, matching what browsers do by default for a call. */
export const DEFAULT_VOICE_AUDIO: VoiceAudioSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Capture constraints for the call microphone.
 *
 *  Each flag is stated explicitly rather than omitted when off: an absent
 *  constraint means "engine's choice", which for these three is usually *on* —
 *  so leaving one out would quietly ignore a user who turned it off. */
export function micConstraints(settings: VoiceAudioSettings): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    },
    video: false,
  };
}

/** Coerce a value loaded from disk (or an older config that predates these
 *  settings) into a complete, valid object. Anything missing or the wrong type
 *  falls back to the default for that field rather than failing the load. */
export function normalizeVoiceAudio(value: unknown): VoiceAudioSettings {
  const v = (value ?? {}) as Partial<Record<keyof VoiceAudioSettings, unknown>>;
  const flag = (x: unknown, fallback: boolean) => (typeof x === "boolean" ? x : fallback);
  return {
    echoCancellation: flag(v.echoCancellation, DEFAULT_VOICE_AUDIO.echoCancellation),
    noiseSuppression: flag(v.noiseSuppression, DEFAULT_VOICE_AUDIO.noiseSuppression),
    autoGainControl: flag(v.autoGainControl, DEFAULT_VOICE_AUDIO.autoGainControl),
  };
}

/** One-line summary of what's active, for the settings screen. */
export function voiceAudioSummary(s: VoiceAudioSettings): string {
  const on = [
    s.noiseSuppression && "noise suppression",
    s.echoCancellation && "echo cancellation",
    s.autoGainControl && "auto gain",
  ].filter((x): x is string => typeof x === "string");
  if (on.length === 0) return "No microphone processing — your raw input is sent.";
  return `Active: ${on.join(", ")}.`;
}
