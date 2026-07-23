import { describe, expect, it } from "vitest";
import {
  decideRemoteInstall,
  failedMessage,
  startedMessage,
  type RemoteInstallContext,
} from "./remoteInstall";
import { outbound, parseInbound } from "./protocol";

const ready: RemoteInstallContext = {
  signedIn: true,
  knownGameIds: ["doom", "quake"],
  installedGameIds: [],
  activeGameIds: [],
};

describe("decideRemoteInstall", () => {
  it("installs a game this PC knows and does not have", () => {
    expect(decideRemoteInstall("doom", "Doom", ready)).toEqual({
      action: "install",
      gameId: "doom",
      title: "Doom",
    });
  });

  it("trims the id, so a stray space does not become a different game", () => {
    expect(decideRemoteInstall("  doom  ", "Doom", ready)).toMatchObject({ gameId: "doom" });
  });

  it("falls back to the id when the phone sent no title", () => {
    expect(decideRemoteInstall("doom", "  ", ready)).toMatchObject({ title: "doom" });
  });

  it("refuses a request that names no game", () => {
    expect(decideRemoteInstall("  ", "", ready)).toMatchObject({ action: "refuse", status: "failed" });
  });

  it("refuses rather than queues when nobody is signed in on this PC", () => {
    // A queued install would fire at an unpredictable later moment, long after
    // the person holding the phone stopped watching.
    const d = decideRemoteInstall("doom", "Doom", { ...ready, signedIn: false });
    expect(d).toMatchObject({ action: "refuse", status: "failed" });
  });

  it("reports an install already running instead of starting a second one", () => {
    expect(decideRemoteInstall("doom", "Doom", { ...ready, activeGameIds: ["doom"] })).toMatchObject({
      action: "refuse",
      status: "downloading",
    });
  });

  it("reports a game that is already installed", () => {
    expect(decideRemoteInstall("doom", "Doom", { ...ready, installedGameIds: ["doom"] })).toMatchObject({
      action: "refuse",
      status: "installed",
    });
  });

  it("prefers the downloading answer over the installed one", () => {
    // Both can be true during a repair or an update; the live one is the more
    // useful thing to tell the user.
    expect(
      decideRemoteInstall("doom", "Doom", {
        ...ready,
        activeGameIds: ["doom"],
        installedGameIds: ["doom"],
      }),
    ).toMatchObject({ status: "downloading" });
  });

  it("refuses a game this PC's library does not have", () => {
    expect(decideRemoteInstall("myst", "Myst", ready)).toMatchObject({
      action: "refuse",
      status: "failed",
    });
  });

  it("does not refuse on a cold start, when no catalog has loaded yet", () => {
    // An empty catalog means "we do not know yet", not "that game does not
    // exist" -- refusing here would fail every request made during startup.
    expect(decideRemoteInstall("myst", "Myst", { ...ready, knownGameIds: [] })).toMatchObject({
      action: "install",
    });
  });

  it("names the game in every refusal a user could see", () => {
    for (const ctx of [
      { ...ready, activeGameIds: ["doom"] },
      { ...ready, installedGameIds: ["doom"] },
      { ...ready, knownGameIds: ["quake"] },
    ]) {
      const d = decideRemoteInstall("doom", "Doom", ctx);
      expect(d.action).toBe("refuse");
      if (d.action === "refuse") expect(d.message).toContain("Doom");
    }
  });
});

describe("messages", () => {
  it("says what started", () => {
    expect(startedMessage("Doom")).toContain("Doom");
  });

  it("carries the reason a failure gives, and reads sensibly without one", () => {
    expect(failedMessage("Doom", "disk full")).toBe("Could not install Doom: disk full");
    expect(failedMessage("Doom", "   ")).toBe("Could not install Doom.");
  });
});

describe("the remote install frames", () => {
  it("parses the request the server relays from the phone", () => {
    const raw = '{"type":"remote_install","gameId":"doom","gameTitle":"Doom","fromDeviceId":"ph-1"}';
    expect(parseInbound(raw)).toEqual({
      type: "remote_install",
      gameId: "doom",
      gameTitle: "Doom",
      fromDeviceId: "ph-1",
    });
  });

  it("survives a request with fields missing", () => {
    expect(parseInbound('{"type":"remote_install"}')).toEqual({
      type: "remote_install",
      gameId: "",
      gameTitle: "",
      fromDeviceId: "",
    });
  });

  it("addresses the result back at the phone that asked", () => {
    // Without the device id the server has no socket to relay to and the phone
    // waits on a result that never comes.
    expect(outbound.remoteInstallResult("ph-1", "doom", "started", "Started downloading Doom.")).toBe(
      '{"type":"remote_install_result","deviceId":"ph-1","gameId":"doom","status":"started","message":"Started downloading Doom."}',
    );
  });

  it("sends an empty message rather than omitting the field", () => {
    expect(outbound.remoteInstallResult("ph-1", "doom", "done")).toContain('"message":""');
  });
});
