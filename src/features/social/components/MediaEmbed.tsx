// Renders a message that is nothing but a media link as the media itself.
// What counts as embeddable — and why — lives in embeds.ts.

import { useState } from "react";
import { youtubeEmbedUrl, type Embed } from "../embeds";

interface Props {
  embed: Embed;
}

export function MediaEmbed({ embed }: Props) {
  // A YouTube iframe loads and phones home the moment it mounts, so a chat
  // window full of links would open that many connections on its own. Show a
  // thumbnail until someone actually presses play.
  const [playing, setPlaying] = useState(false);
  // A dead link, a host that's down, an image that isn't really an image: fall
  // back to the link rather than leaving a broken-image box in the bubble.
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        className="msg__link"
        href={embed.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {embed.url}
      </a>
    );
  }

  if (embed.kind === "image") {
    return (
      <a
        className="msg__media"
        href={embed.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  if (embed.kind === "video") {
    return (
      <video
        className="msg__media msg__media--video"
        src={embed.url}
        controls
        // No autoplay and metadata-only: a chat log shouldn't start making noise
        // or pull down megabytes as you scroll past it.
        preload="metadata"
        playsInline
        onError={() => setFailed(true)}
      />
    );
  }

  if (playing) {
    return (
      <iframe
        className="msg__media msg__media--video"
        src={`${youtubeEmbedUrl(embed.id)}&autoplay=1`}
        title="YouTube video"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  return (
    <button
      className="msg__media msg__yt"
      onClick={() => setPlaying(true)}
      title="Play on YouTube"
    >
      <img
        src={`https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg`}
        alt="YouTube thumbnail"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="msg__yt-play" aria-hidden="true">
        ▶
      </span>
    </button>
  );
}
