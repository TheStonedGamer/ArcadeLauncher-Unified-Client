import { describe, expect, it } from "vitest";
import { parseInbound, outbound } from "./protocol";

describe("parseInbound", () => {
  it("parses hello", () => {
    expect(parseInbound('{"type":"hello","selfId":42}')).toEqual({ type: "hello", selfId: 42 });
  });

  it("parses a chat frame", () => {
    expect(
      parseInbound(
        '{"type":"chat","messageId":7,"senderId":2,"receiverId":42,"text":"hi","attachmentId":0,"timestamp":1700000000}',
      ),
    ).toEqual({
      type: "chat",
      messageId: 7,
      senderId: 2,
      receiverId: 42,
      text: "hi",
      attachmentId: 0,
      timestamp: 1700000000,
    });
  });

  it("parses presence with game", () => {
    expect(
      parseInbound('{"type":"presence","userId":3,"state":"ingame","gameId":"g1","gameTitle":"Crystalis"}'),
    ).toEqual({ type: "presence", userId: 3, state: "ingame", gameId: "g1", gameTitle: "Crystalis" });
  });

  it("parses typing using fromId", () => {
    expect(parseInbound('{"type":"typing","fromId":9}')).toEqual({ type: "typing", fromId: 9 });
  });

  it("parses read receipt", () => {
    expect(parseInbound('{"type":"read","readerId":2,"upToId":11}')).toEqual({
      type: "read",
      readerId: 2,
      upToId: 11,
    });
  });

  it("defaults missing fields rather than throwing", () => {
    expect(parseInbound('{"type":"presence","userId":3}')).toEqual({
      type: "presence",
      userId: 3,
      state: "",
      gameId: "",
      gameTitle: "",
    });
  });

  it("maps unknown frame types to unknown", () => {
    expect(parseInbound('{"type":"voice_signal","to":1}')).toEqual({ type: "unknown" });
  });

  it("returns null for malformed json", () => {
    expect(parseInbound("{not json")).toBeNull();
  });
});

describe("outbound", () => {
  it("builds frames matching the C++/Rust shapes", () => {
    expect(outbound.ping()).toBe('{"type":"ping"}');
    expect(outbound.chat(42, "hi")).toBe('{"type":"chat","to":42,"text":"hi"}');
    expect(outbound.typing(42)).toBe('{"type":"typing","to":42}');
    expect(outbound.read(42)).toBe('{"type":"read","to":42}');
    expect(outbound.react(7, "👍")).toBe('{"type":"react","msgId":7,"emoji":"👍"}');
    expect(outbound.presence("away")).toBe('{"type":"presence","state":"away"}');
    expect(outbound.presenceInGame("g1")).toBe('{"type":"presence","state":"ingame","gameId":"g1"}');
  });
});
