import { describe, expect, it } from "vitest";
import {
  canShareVideo,
  hasVideo,
  nextVideoMode,
  parseVideoMode,
  primaryTile,
  remoteVideoLabel,
  videoButtonLabel,
  videoConstraints,
  VIDEO_MODES,
  type VideoMode,
} from "./video";

describe("parseVideoMode", () => {
  it("accepts every known mode", () => {
    for (const mode of VIDEO_MODES) expect(parseVideoMode(mode)).toBe(mode);
  });

  it("rejects anything else", () => {
    for (const bad of ["Camera", "video", "", 1, null, undefined, {}, ["camera"], true]) {
      expect(parseVideoMode(bad)).toBeNull();
    }
  });
});

describe("nextVideoMode", () => {
  it("turns off the mode already being sent", () => {
    expect(nextVideoMode("camera", "camera")).toBe("none");
    expect(nextVideoMode("screen", "screen")).toBe("none");
  });

  it("switches straight across without passing through none", () => {
    expect(nextVideoMode("camera", "screen")).toBe("screen");
    expect(nextVideoMode("screen", "camera")).toBe("camera");
  });

  it("turns on from none", () => {
    expect(nextVideoMode("none", "camera")).toBe("camera");
    expect(nextVideoMode("none", "screen")).toBe("screen");
  });

  it("is its own inverse when pressing the same button twice", () => {
    for (const start of VIDEO_MODES) {
      for (const press of ["camera", "screen"] as const) {
        const once = nextVideoMode(start, press);
        expect(nextVideoMode(once, press)).toBe(once === "none" ? press : "none");
      }
    }
  });
});

describe("canShareVideo", () => {
  it("allows only the phases that own a peer connection", () => {
    expect(canShareVideo("connecting")).toBe(true);
    expect(canShareVideo("connected")).toBe(true);
  });

  it("blocks phases with no peer connection to renegotiate", () => {
    for (const phase of ["idle", "inviting", "ringing", "ended", "bogus"]) {
      expect(canShareVideo(phase)).toBe(false);
    }
  });
});

describe("videoConstraints", () => {
  it("never asks for audio — the call already carries the mic", () => {
    expect(videoConstraints("camera").audio).toBe(false);
    expect(videoConstraints("screen").audio).toBe(false);
  });

  it("always asks for video", () => {
    expect(videoConstraints("camera").video).toBeTruthy();
    expect(videoConstraints("screen").video).toBeTruthy();
  });

  it("requests 720p for the camera and a frame-rate cap for the screen", () => {
    expect(videoConstraints("camera").video).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
    expect(videoConstraints("screen").video).toMatchObject({
      frameRate: { ideal: 30, max: 60 },
    });
  });
});

describe("videoButtonLabel", () => {
  it("reads as an action, flipping to Stop when that mode is live", () => {
    expect(videoButtonLabel("none", "camera")).toContain("Camera");
    expect(videoButtonLabel("camera", "camera")).toContain("Stop camera");
    expect(videoButtonLabel("none", "screen")).toContain("Share screen");
    expect(videoButtonLabel("screen", "screen")).toContain("Stop sharing");
  });

  it("does not say Stop for a mode that is not the current one", () => {
    expect(videoButtonLabel("screen", "camera")).not.toContain("Stop");
    expect(videoButtonLabel("camera", "screen")).not.toContain("Stop");
  });
});

describe("remoteVideoLabel", () => {
  it("names what the peer is sending", () => {
    expect(remoteVideoLabel("camera", "Ash")).toBe("Ash's camera");
    expect(remoteVideoLabel("screen", "Ash")).toBe("Ash's screen");
  });

  it("returns null when the peer sends nothing", () => {
    expect(remoteVideoLabel("none", "Ash")).toBeNull();
  });

  it("falls back to a placeholder when the name is empty", () => {
    expect(remoteVideoLabel("screen", "")).toBe("Peer's screen");
  });
});

describe("hasVideo / primaryTile", () => {
  const modes = VIDEO_MODES;

  it("agree on whether there is anything to show", () => {
    for (const local of modes) {
      for (const remote of modes) {
        expect(hasVideo(local, remote)).toBe(primaryTile(local, remote) !== null);
      }
    }
  });

  it("gives the stage to the remote whenever the peer is sending", () => {
    for (const local of modes) {
      expect(primaryTile(local, "camera")).toBe("remote");
      expect(primaryTile(local, "screen")).toBe("remote");
    }
  });

  it("promotes the local preview only when it is the only picture", () => {
    expect(primaryTile("camera", "none")).toBe("local");
    expect(primaryTile("screen", "none")).toBe("local");
    expect(primaryTile("none", "none")).toBeNull();
  });

  it("shows nothing for a silent call", () => {
    const local: VideoMode = "none";
    expect(hasVideo(local, "none")).toBe(false);
  });
});
