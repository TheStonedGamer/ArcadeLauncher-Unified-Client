import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_AUDIO,
  micConstraints,
  normalizeVoiceAudio,
  voiceAudioSummary,
} from "./audio";

describe("micConstraints", () => {
  it("asks for a microphone and never a camera", () => {
    const c = micConstraints(DEFAULT_VOICE_AUDIO);
    expect(c.video).toBe(false);
    expect(c.audio).toBeTruthy();
  });

  it("states every flag explicitly, including the off ones", () => {
    // An omitted constraint means "engine's choice", which defaults to on for
    // all three — so a disabled setting has to be sent as an explicit false.
    const c = micConstraints({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(c.audio).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it("passes each setting through independently", () => {
    const c = micConstraints({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    });
    expect(c.audio).toMatchObject({ noiseSuppression: true, echoCancellation: false });
  });
});

describe("normalizeVoiceAudio", () => {
  it("defaults everything on", () => {
    expect(DEFAULT_VOICE_AUDIO).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("fills in a config written before these settings existed", () => {
    expect(normalizeVoiceAudio(undefined)).toEqual(DEFAULT_VOICE_AUDIO);
    expect(normalizeVoiceAudio(null)).toEqual(DEFAULT_VOICE_AUDIO);
    expect(normalizeVoiceAudio({})).toEqual(DEFAULT_VOICE_AUDIO);
  });

  it("keeps valid flags and repairs the rest field by field", () => {
    expect(normalizeVoiceAudio({ noiseSuppression: false, autoGainControl: "yes" })).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
  });

  it("ignores a non-object", () => {
    expect(normalizeVoiceAudio("nope")).toEqual(DEFAULT_VOICE_AUDIO);
    expect(normalizeVoiceAudio(7)).toEqual(DEFAULT_VOICE_AUDIO);
  });
});

describe("voiceAudioSummary", () => {
  it("lists what is on", () => {
    expect(voiceAudioSummary(DEFAULT_VOICE_AUDIO)).toBe(
      "Active: noise suppression, echo cancellation, auto gain.",
    );
  });

  it("says so plainly when nothing is on", () => {
    const s = voiceAudioSummary({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(s).toBe("No microphone processing — your raw input is sent.");
  });

  it("names only the active ones", () => {
    expect(
      voiceAudioSummary({ echoCancellation: false, noiseSuppression: true, autoGainControl: false }),
    ).toBe("Active: noise suppression.");
  });
});
