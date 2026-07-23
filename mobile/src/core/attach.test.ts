import { describe, expect, it } from "vitest";
import {
  attachmentBlocker,
  basename,
  formatSize,
  guessContentType,
  isAcceptableSize,
  isViewableImage,
  MAX_ATTACHMENT_BYTES,
  parsePresign,
  presignRequest,
} from "./attach";

describe("the desktop's rules, restated", () => {
  // These cases are lifted from src-tauri/src/social/attach.rs. If the two ever
  // disagree, a file the PC would send is one the phone silently refuses.
  it("strips both separators", () => {
    expect(basename("/home/me/shot.png")).toBe("shot.png");
    expect(basename("C:\\Users\\me\\My Pics\\shot.png")).toBe("shot.png");
    expect(basename("plain.txt")).toBe("plain.txt");
    expect(basename("/trailing/")).toBe("");
  });

  it("guesses known types and falls back for the rest", () => {
    expect(guessContentType("a.PNG")).toBe("image/png");
    expect(guessContentType("photo.jpeg")).toBe("image/jpeg");
    expect(guessContentType("clip.mp4")).toBe("video/mp4");
    expect(guessContentType("save.dat")).toBe("application/octet-stream");
    expect(guessContentType("noext")).toBe("application/octet-stream");
  });

  it("bounds the size the same way", () => {
    expect(isAcceptableSize(0)).toBe(false);
    expect(isAcceptableSize(1)).toBe(true);
    expect(isAcceptableSize(MAX_ATTACHMENT_BYTES)).toBe(true);
    expect(isAcceptableSize(MAX_ATTACHMENT_BYTES + 1)).toBe(false);
  });

  it("agrees with the server's 25 MiB cap", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("attachmentBlocker", () => {
  it("lets an ordinary file through", () => {
    expect(attachmentBlocker("shot.png", 1024)).toBeNull();
  });

  it("explains each refusal in words a user can act on", () => {
    expect(attachmentBlocker("/trailing/", 10)).toContain("name");
    expect(attachmentBlocker("empty.txt", 0)).toContain("empty");
    expect(attachmentBlocker("huge.zip", MAX_ATTACHMENT_BYTES + 1)).toContain("25.0 MB");
  });
});

describe("presignRequest", () => {
  it("sends the bare filename and its type, not the whole path", () => {
    // The path can be a content:// URI with the user's folder names in it;
    // none of that belongs on the server.
    expect(presignRequest("/storage/emulated/0/DCIM/holiday.JPG", 2048)).toEqual({
      filename: "holiday.JPG",
      contentType: "image/jpeg",
      size: 2048,
    });
  });
});

describe("parsePresign", () => {
  it("accepts a complete response", () => {
    expect(parsePresign({ attachmentId: 7, uploadUrl: "https://s3/put" })).toEqual({
      attachmentId: 7,
      uploadUrl: "https://s3/put",
    });
  });

  it("rejects a half-answer rather than uploading nowhere", () => {
    // An id with no URL would leave a chat frame pointing at bytes that were
    // never uploaded -- worse than failing here.
    for (const bad of [
      null,
      "nope",
      {},
      { attachmentId: 7 },
      { uploadUrl: "https://s3/put" },
      { attachmentId: 0, uploadUrl: "https://s3/put" },
      { attachmentId: 7, uploadUrl: "" },
    ]) {
      expect(parsePresign(bad)).toBeNull();
    }
  });
});

describe("formatSize", () => {
  it("reads sensibly at each scale", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(25 * 1024 * 1024)).toBe("25.0 MB");
  });

  it("does not print a negative or a NaN size", () => {
    expect(formatSize(-1)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
  });
});

describe("isViewableImage", () => {
  it("shows real images inline", () => {
    expect(isViewableImage("image/png")).toBe(true);
    expect(isViewableImage("image/jpeg")).toBe(true);
  });

  it("does not inline an SVG or a non-image", () => {
    // An SVG is a document that can carry script, not a picture to render
    // sight-unseen from whoever sent it.
    expect(isViewableImage("image/svg+xml")).toBe(false);
    expect(isViewableImage("application/pdf")).toBe(false);
  });
});
