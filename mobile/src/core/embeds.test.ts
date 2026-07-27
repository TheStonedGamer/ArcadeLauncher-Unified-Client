import { describe, expect, it } from "vitest";
import { embedFor, youtubeEmbedUrl, youtubeId } from "./embeds";

describe("embedFor", () => {
  it("embeds images by extension", () => {
    expect(embedFor("https://media.tenor.com/a.gif")).toEqual({
      kind: "image",
      url: "https://media.tenor.com/a.gif",
    });
    expect(embedFor("  https://cdn.example.com/pic.PNG  ")?.kind).toBe("image");
    expect(embedFor("https://cdn.example.com/pic.webp")?.kind).toBe("image");
  });

  it("embeds playable video files", () => {
    expect(embedFor("https://cdn.example.com/clip.mp4")).toEqual({
      kind: "video",
      url: "https://cdn.example.com/clip.mp4",
    });
    expect(embedFor("https://cdn.example.com/clip.webm")?.kind).toBe("video");
  });

  it("leaves formats a player can't handle as a link", () => {
    expect(embedFor("https://cdn.example.com/clip.mkv")).toBeNull();
    expect(embedFor("https://cdn.example.com/clip.avi")).toBeNull();
  });

  it("reads the extension from the path, not the query", () => {
    expect(embedFor("https://cdn.example.com/a.gif?w=320&sig=abc")?.kind).toBe(
      "image",
    );
    // A page that merely mentions .mp4 in its query is not a video.
    expect(embedFor("https://example.com/watch?file=clip.mp4")).toBeNull();
  });

  it("embeds YouTube in its three pasted shapes", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://m.youtube.com/watch?v=${id}&t=42s`,
    ]) {
      expect(embedFor(url)).toEqual({ kind: "youtube", id, url });
    }
  });

  it("does not embed other YouTube pages", () => {
    expect(embedFor("https://www.youtube.com/@somechannel")).toBeNull();
    expect(embedFor("https://www.youtube.com/playlist?list=PL123")).toBeNull();
    expect(youtubeId(new URL("https://youtu.be/tooshort"))).toBe("");
  });

  it("refuses non-https and text around a link", () => {
    expect(embedFor("http://media.tenor.com/a.gif")).toBeNull();
    expect(embedFor("look at this https://media.tenor.com/a.gif")).toBeNull();
  });

  it("ignores ordinary text", () => {
    expect(embedFor("hello")).toBeNull();
    expect(embedFor("")).toBeNull();
    expect(embedFor("not a url .gif")).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("uses the no-cookie host and drops related videos", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });
});
