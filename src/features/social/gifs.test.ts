import { describe, expect, it } from "vitest";
import { GIF_LIMIT, parseGifs, searchUrl, trendingUrl } from "./gifs";

describe("Tenor request URLs", () => {
  it("carries the key, query and both media formats", () => {
    const u = new URL(searchUrl("KEY123", "  cat  "));
    expect(u.origin + u.pathname).toBe(
      "https://tenor.googleapis.com/v2/search",
    );
    expect(u.searchParams.get("key")).toBe("KEY123");
    expect(u.searchParams.get("q")).toBe("cat");
    expect(u.searchParams.get("media_filter")).toBe("gif,tinygif");
    expect(u.searchParams.get("limit")).toBe(String(GIF_LIMIT));
  });

  it("has a keyless-free trending endpoint shape", () => {
    expect(new URL(trendingUrl("K")).pathname).toBe("/v2/featured");
  });
});

describe("parseGifs", () => {
  const result = {
    id: "42",
    content_description: "cat typing",
    media_formats: {
      gif: { url: "https://media.tenor.com/a.gif", dims: [320, 240] },
      tinygif: { url: "https://media.tenor.com/a-tiny.gif" },
    },
  };

  it("reads the animated url, preview and dimensions", () => {
    expect(parseGifs({ results: [result] })).toEqual([
      {
        id: "42",
        description: "cat typing",
        url: "https://media.tenor.com/a.gif",
        previewUrl: "https://media.tenor.com/a-tiny.gif",
        width: 320,
        height: 240,
      },
    ]);
  });

  it("falls back to the full gif when there is no tiny preview", () => {
    const noTiny = {
      ...result,
      media_formats: { gif: result.media_formats.gif },
    };
    expect(parseGifs({ results: [noTiny] })[0].previewUrl).toBe(
      "https://media.tenor.com/a.gif",
    );
  });

  it("drops results with no animated url, and survives junk", () => {
    expect(
      parseGifs({ results: [{ media_formats: { tinygif: { url: "x" } } }] }),
    ).toEqual([]);
    expect(parseGifs({ results: "nope" })).toEqual([]);
    expect(parseGifs(null)).toEqual([]);
  });
});
