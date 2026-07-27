// GIF search against Tenor v2, plus the rule for rendering a GIF inline in a
// chat bubble.
//
// A GIF is sent as an ordinary text message containing its URL — the wire
// protocol, the server, and the mobile client all stay untouched, and a client
// that doesn't know about GIFs still shows something meaningful (the link).
// MessageRow turns a message that is *only* a media URL back into an image;
// see embeds.ts for that rule.
//
// The key is user-supplied (Settings → Integrations). Tenor requires one and we
// have nowhere to hide a shared secret in a desktop app, so with no key the
// picker says so instead of silently returning nothing.

export interface Gif {
  id: string;
  description: string;
  /** Animated GIF/MP4-free URL suitable for both preview and send. */
  url: string;
  /** Small still/animated preview for the grid. */
  previewUrl: string;
  width: number;
  height: number;
}

const TENOR = "https://tenor.googleapis.com/v2";

/** Tenor caps `limit` at 50; asking for more is an error, not a bigger page. */
export const GIF_LIMIT = 24;

export function searchUrl(
  key: string,
  query: string,
  limit = GIF_LIMIT,
): string {
  const q = new URLSearchParams({
    key,
    q: query.trim(),
    limit: String(limit),
    // gif = the animated file we send; tinygif = the cheap grid preview.
    media_filter: "gif,tinygif",
    contentfilter: "medium",
    client_key: "arcadelauncher",
  });
  return `${TENOR}/search?${q.toString()}`;
}

/** Trending is what the picker shows before you type anything. */
export function trendingUrl(key: string, limit = GIF_LIMIT): string {
  const q = new URLSearchParams({
    key,
    limit: String(limit),
    media_filter: "gif,tinygif",
    contentfilter: "medium",
    client_key: "arcadelauncher",
  });
  return `${TENOR}/featured?${q.toString()}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Parse a Tenor response into our shape, dropping anything without a usable
 * animated URL. Tolerant by design: a result missing `tinygif` falls back to
 * the full `gif` for its preview rather than disappearing from the grid.
 */
export function parseGifs(body: unknown): Gif[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: Gif[] = [];
  for (const r of results) {
    const formats = (r as { media_formats?: Record<string, unknown> })
      ?.media_formats;
    if (!formats) continue;
    const gif = formats.gif as { url?: unknown; dims?: unknown } | undefined;
    const tiny = formats.tinygif as { url?: unknown } | undefined;
    const url = str(gif?.url);
    if (!url) continue;
    const dims = Array.isArray(gif?.dims) ? (gif?.dims as unknown[]) : [];
    out.push({
      id: str((r as { id?: unknown }).id) || url,
      description: str(
        (r as { content_description?: unknown }).content_description,
      ),
      url,
      previewUrl: str(tiny?.url) || url,
      width: num(dims[0]),
      height: num(dims[1]),
    });
  }
  return out;
}
