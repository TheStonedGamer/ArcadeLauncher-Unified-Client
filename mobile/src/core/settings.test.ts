import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  micConstraints,
  parseSettings,
  voiceAudioSummary,
} from "./settings";

describe("parseSettings", () => {
  it("uses defaults when there is nothing stored", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("treats corrupt JSON as no settings rather than failing", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a stored false — the whole point of the switch", () => {
    const s = parseSettings(JSON.stringify({ voiceAudio: { noiseSuppression: false } }));
    expect(s.voiceAudio.noiseSuppression).toBe(false);
    // Fields the stored file never had still come back at their default.
    expect(s.voiceAudio.echoCancellation).toBe(true);
    expect(s.ring.vibrate).toBe(true);
  });

  it("ignores values of the wrong type per field", () => {
    const s = parseSettings(JSON.stringify({ ring: { vibrate: "no", notify: false } }));
    expect(s.ring.vibrate).toBe(true);
    expect(s.ring.notify).toBe(false);
  });
});

describe("micConstraints", () => {
  it("states every flag, including the off ones", () => {
    expect(
      micConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      }),
    ).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      video: false,
    });
  });
});

describe("voiceAudioSummary", () => {
  it("says so when nothing is processing the mic", () => {
    expect(
      voiceAudioSummary({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }),
    ).toMatch(/raw input/);
  });

  it("lists what is active", () => {
    expect(voiceAudioSummary(DEFAULT_SETTINGS.voiceAudio)).toContain("noise suppression");
  });
});
