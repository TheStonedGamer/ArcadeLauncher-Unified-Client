// What a chat message should render as, when the message is nothing but a link.
//
// Three kinds: an image (GIF/PNG/JPEG/WebP/AVIF), a video file (MP4/WebM), and
// a YouTube video, which is a page rather than a file and so gets an iframe.
//
// Two rules hold for all of them:
//
//   * https only. An http embed is a downgrade the user never asked for.
//   * The whole message must be the URL. Text around a link means the sender
//     was talking about it, and a bubble that silently swallowed their words
//     would be worse than showing the link.
//
// Note on privacy: loading an embed reveals your IP to whatever host serves it,
// so a link from a stranger is a tracking pixel with extra steps. Chat here is
// between accounts on one arcade server rather than the open internet, and a
// GIF that renders as a link is not a working GIF, so embeds are on by extension
// for any https host. If that ever needs tightening, this is the one place to
// add a host allow-list.

export type Embed =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "youtube"; id: string; url: string };

const IMAGE_EXT = [".gif", ".png", ".jpg", ".jpeg", ".webp", ".avif"];
// Formats a WebView can actually play. .mkv/.avi would embed as a broken player,
// which is worse than a link you can click.
const VIDEO_EXT = [".mp4", ".webm", ".m4v"];

/** A YouTube id is exactly 11 url-safe characters; anything else is some other
 *  kind of YouTube link (a channel, a playlist page) that we shouldn't embed. */
function validId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * The YouTube video id in this URL, or "". Covers the three shapes people
 * actually paste: a watch link, a youtu.be short link, and a Shorts link.
 */
export function youtubeId(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = u.pathname.slice(1);
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
    else if (u.pathname.startsWith("/shorts/"))
      id = u.pathname.slice("/shorts/".length);
    else if (u.pathname.startsWith("/embed/"))
      id = u.pathname.slice("/embed/".length);
  }
  // Trailing path segments (`/watch/foo`) or a stray slash shouldn't leak in.
  id = id.split("/")[0];
  return validId(id) ? id : "";
}

/** nocookie + no related-video sidebar: an embed shouldn't set a tracking
 *  cookie or advertise at whoever is reading a chat. */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}

function hasExt(pathname: string, exts: string[]): boolean {
  const p = pathname.toLowerCase();
  return exts.some((x) => p.endsWith(x));
}

/**
 * How to render this message, or null for ordinary text. The extension is read
 * from the path only, so a query string (`?width=320`, a CDN signature) doesn't
 * hide it, and `?x=.mp4` on an HTML page doesn't fake one.
 */
export function embedFor(text: string): Embed | null {
  const t = text.trim();
  if (t === "" || /\s/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;

  const yt = youtubeId(u);
  if (yt) return { kind: "youtube", id: yt, url: t };
  if (hasExt(u.pathname, IMAGE_EXT)) return { kind: "image", url: t };
  if (hasExt(u.pathname, VIDEO_EXT)) return { kind: "video", url: t };
  return null;
}
