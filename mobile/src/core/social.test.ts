import { describe, expect, it } from "vitest";
import { gatewayUrl, installTargets, outbound, parseFrame } from "./social";
import type { DeviceEntry } from "./social";

describe("parseFrame", () => {
  it("parses the handshake including the accepted device id", () => {
    expect(parseFrame('{"type":"hello","selfId":42,"deviceId":"phone-1"}')).toEqual({
      type: "hello",
      selfId: 42,
      deviceId: "phone-1",
    });
  });

  it("reports a rejected device identity as null, not as an empty string", () => {
    // The server sends null when our id failed validation; an empty string
    // would look like a real id to any `if (deviceId)` check downstream.
    expect(parseFrame('{"type":"hello","selfId":1,"deviceId":null}')).toMatchObject({
      deviceId: null,
    });
    expect(parseFrame('{"type":"hello","selfId":1,"deviceId":""}')).toMatchObject({
      deviceId: null,
    });
    expect(parseFrame('{"type":"hello","selfId":1}')).toMatchObject({ deviceId: null });
  });

  it("parses a chat frame", () => {
    const raw =
      '{"type":"chat","messageId":7,"senderId":2,"receiverId":42,"text":"hi","attachmentId":3,"replyTo":5,"timestamp":1700000000}';
    expect(parseFrame(raw)).toEqual({
      type: "chat",
      messageId: 7,
      senderId: 2,
      receiverId: 42,
      text: "hi",
      attachmentId: 3,
      replyTo: 5,
      timestamp: 1700000000,
    });
  });

  it("defaults a chat frame's optional fields instead of leaving them undefined", () => {
    expect(parseFrame('{"type":"chat","messageId":1,"senderId":2,"receiverId":3}')).toEqual({
      type: "chat",
      messageId: 1,
      senderId: 2,
      receiverId: 3,
      text: "",
      attachmentId: 0,
      replyTo: 0,
      timestamp: 0,
    });
  });

  it("gives presence a state even when the server omits one", () => {
    expect(parseFrame('{"type":"presence","userId":5}')).toEqual({
      type: "presence",
      userId: 5,
      state: "offline",
      gameTitle: "",
    });
  });

  it("parses a device list", () => {
    const raw =
      '{"type":"devices","devices":[{"id":"pc-1","name":"Den PC","kind":"desktop","version":"0.14.0"}]}';
    expect(parseFrame(raw)).toEqual({
      type: "devices",
      devices: [{ id: "pc-1", name: "Den PC", kind: "desktop", version: "0.14.0" }],
    });
  });

  it("drops device rows with no id and names the rest by their id", () => {
    const raw = '{"type":"devices","devices":[{"id":""},{"id":"pc-1"},null,7]}';
    expect(parseFrame(raw)).toEqual({
      type: "devices",
      devices: [{ id: "pc-1", name: "pc-1", kind: "unknown", version: "" }],
    });
  });

  it("treats a missing devices array as an empty list", () => {
    expect(parseFrame('{"type":"devices"}')).toEqual({ type: "devices", devices: [] });
  });

  it("parses an install acknowledgement and its refusal reason", () => {
    const raw =
      '{"type":"remote_install_ack","deviceId":"pc-1","gameId":"g-7","ok":false,"error":"unknown_device","message":"That PC is not signed in right now."}';
    expect(parseFrame(raw)).toEqual({
      type: "remote_install_ack",
      deviceId: "pc-1",
      gameId: "g-7",
      ok: false,
      error: "unknown_device",
      message: "That PC is not signed in right now.",
    });
  });

  it("treats a missing ok as a failure rather than a success", () => {
    // Defaulting the other way would report a phantom install to the user.
    expect(parseFrame('{"type":"remote_install_ack","gameId":"g"}')).toMatchObject({ ok: false });
  });

  it("parses an install result", () => {
    const raw =
      '{"type":"remote_install_result","deviceId":"pc-1","gameId":"g-7","status":"done","message":"Installed."}';
    expect(parseFrame(raw)).toMatchObject({ status: "done", message: "Installed." });
  });

  it("labels a status-less result rather than showing a blank", () => {
    expect(parseFrame('{"type":"remote_install_result","gameId":"g"}')).toMatchObject({
      status: "unknown",
    });
  });

  it("parses a sign-in approval push", () => {
    const raw =
      '{"type":"guard_request","requestId":"r1","prompt":"Den PC is trying to sign in from 10.0.0.5.","deviceName":"Den PC","ip":"10.0.0.5","expiresIn":120}';
    expect(parseFrame(raw)).toEqual({
      type: "guard_request",
      requestId: "r1",
      prompt: "Den PC is trying to sign in from 10.0.0.5.",
      deviceName: "Den PC",
      ip: "10.0.0.5",
      expiresIn: 120,
    });
  });

  it("passes a call signal through without inspecting the payload", () => {
    // The payload is the two clients' business; core/call.ts narrows it. Frame
    // parsing must not reject a kind it has not heard of, or a newer client
    // could never add one.
    expect(parseFrame('{"type":"voice_signal","fromId":7,"payload":{"kind":"offer","sdp":"v=0"}}')).toEqual({
      type: "voice_signal",
      fromId: 7,
      payload: { kind: "offer", sdp: "v=0" },
    });
    expect(parseFrame('{"type":"voice_signal","fromId":"7"}')).toEqual({
      type: "voice_signal",
      fromId: 0,
      payload: undefined,
    });
  });

  it("turns anything it does not recognise into an unknown frame", () => {
    // A newer server must be able to add frames without crashing this phone.
    for (const raw of ["", "not json", "[]", "null", '"a"', '{"type":"invented_later"}']) {
      expect(parseFrame(raw)).toEqual({ type: "unknown", raw });
    }
  });

  it("does not trust the wire's types", () => {
    const raw = '{"type":"chat","messageId":"7","senderId":null,"receiverId":3,"text":42}';
    expect(parseFrame(raw)).toMatchObject({ messageId: 0, senderId: 0, text: "" });
  });
});

describe("installTargets", () => {
  const devices: DeviceEntry[] = [
    { id: "pc-1", name: "Den PC", kind: "desktop", version: "" },
    { id: "ph-1", name: "Pixel", kind: "mobile", version: "" },
    { id: "x-1", name: "Something", kind: "unknown", version: "" },
  ];

  it("offers only desktops, matching the server's rule", () => {
    expect(installTargets(devices).map((d) => d.id)).toEqual(["pc-1"]);
  });

  it("is empty when no PC is signed in", () => {
    expect(installTargets(devices.filter((d) => d.kind !== "desktop"))).toEqual([]);
  });
});

describe("outbound", () => {
  it("builds a plain chat frame without the optional fields", () => {
    expect(outbound.chat(5, "hi")).toBe('{"type":"chat","to":5,"text":"hi"}');
  });

  it("adds replyTo and attachmentId only when they are set", () => {
    expect(outbound.chat(5, "hi", 3, 9)).toBe(
      '{"type":"chat","to":5,"text":"hi","replyTo":3,"attachmentId":9}',
    );
    expect(outbound.chat(5, "hi", 0, 9)).toBe('{"type":"chat","to":5,"text":"hi","attachmentId":9}');
  });

  it("builds the small control frames", () => {
    expect(outbound.ping()).toBe('{"type":"ping"}');
    expect(outbound.typing(5)).toBe('{"type":"typing","to":5}');
    expect(outbound.read(5)).toBe('{"type":"read","to":5}');
    expect(outbound.presence("online")).toBe('{"type":"presence","state":"online"}');
    expect(outbound.devices()).toBe('{"type":"devices"}');
  });

  it("builds a remote install command", () => {
    expect(outbound.remoteInstall("pc-1", "g-7", "Doom")).toBe(
      '{"type":"remote_install","deviceId":"pc-1","gameId":"g-7","gameTitle":"Doom"}',
    );
  });

  it("wraps a call signal for the relay, leaving the payload alone", () => {
    expect(outbound.voiceSignal(5, { kind: "invite" })).toBe(
      '{"type":"voice_signal","to":5,"payload":{"kind":"invite"}}',
    );
  });

  it("builds both guard answers with the words the server accepts", () => {
    expect(outbound.guardDecision("r1", true)).toBe(
      '{"type":"guard_decision","requestId":"r1","action":"approve"}',
    );
    expect(outbound.guardDecision("r1", false)).toBe(
      '{"type":"guard_decision","requestId":"r1","action":"deny"}',
    );
  });
});

describe("gatewayUrl", () => {
  const device = { id: "ph-1", name: "Pixel 8", version: "0.14.0" };

  it("builds the socket URL with this phone's identity", () => {
    expect(gatewayUrl("arcade.example.com", "abc", device)).toBe(
      "wss://arcade.example.com/ws/social?token=abc&deviceId=ph-1&deviceName=Pixel+8" +
        "&deviceKind=mobile&appVersion=0.14.0",
    );
  });

  it("strips whatever scheme and trailing slash the user typed", () => {
    for (const host of ["https://h.test/", "http://h.test", "wss://h.test//", "h.test/"]) {
      expect(gatewayUrl(host, "t", device).startsWith("wss://h.test/ws/social?")).toBe(true);
    }
  });

  it("keeps a port", () => {
    expect(gatewayUrl("10.0.0.210:8721", "t", device)).toContain("wss://10.0.0.210:8721/ws/social");
  });

  it("escapes tokens that would otherwise break the query", () => {
    expect(gatewayUrl("h.test", "a+b/c=d e", device)).toContain("token=a%2Bb%2Fc%3Dd+e");
  });

  it("always declares itself mobile, so it is never offered as an install target", () => {
    const url = gatewayUrl("h.test", "t", { id: "", name: "", version: "" });
    expect(url).toContain("deviceKind=mobile");
    expect(url).not.toContain("deviceId=");
    expect(url).not.toContain("deviceName=");
  });
});
