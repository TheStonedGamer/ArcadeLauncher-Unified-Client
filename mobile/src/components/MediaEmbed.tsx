// Renders a chat message that is nothing but a media link as the media itself.
// What counts as embeddable — and why — lives in src/core/embeds.ts, which
// mirrors the desktop client's rules exactly.
//
// Images (and GIFs, which React Native animates) render inline. Video files get
// a real player. YouTube hands off to the YouTube app: a phone already has a
// better player for it than anything we'd put in a chat bubble, and embedding it
// would cost a WebView.

import { useState } from "react";
import { Image, Linking, Text, TouchableOpacity, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors } from "../theme";
import type { Embed } from "../core/embeds";

/** Bubbles are capped at 80% of the screen; this keeps media inside that. */
const WIDTH = 240;

function Failed({ url }: { url: string }) {
  return (
    <Text
      style={{
        color: colors.accent,
        fontSize: 15,
        textDecorationLine: "underline",
      }}
      onPress={() => void Linking.openURL(url)}
    >
      {url}
    </Text>
  );
}

function VideoEmbed({ url }: { url: string }) {
  // No autoplay: scrolling a chat log shouldn't start making noise or spend
  // someone's mobile data on a video they haven't asked for.
  const player = useVideoPlayer(url);
  return (
    <VideoView
      player={player}
      style={{ width: WIDTH, height: (WIDTH * 9) / 16, borderRadius: 10 }}
      nativeControls
      contentFit="contain"
    />
  );
}

export function MediaEmbed({ embed }: { embed: Embed }) {
  const [failed, setFailed] = useState(false);
  // Images arrive without dimensions, so start at 16:9 and correct on load —
  // otherwise a tall image renders letterboxed.
  const [ratio, setRatio] = useState(16 / 9);

  if (failed) return <Failed url={embed.url} />;

  if (embed.kind === "image") {
    return (
      <TouchableOpacity
        onPress={() => void Linking.openURL(embed.url)}
        activeOpacity={0.85}
      >
        <Image
          source={{ uri: embed.url }}
          style={{ width: WIDTH, height: WIDTH / ratio, borderRadius: 10 }}
          resizeMode="contain"
          onLoad={(e) => {
            const { width, height } = e.nativeEvent.source;
            if (width > 0 && height > 0) setRatio(width / height);
          }}
          onError={() => setFailed(true)}
        />
      </TouchableOpacity>
    );
  }

  if (embed.kind === "video") return <VideoEmbed url={embed.url} />;

  return (
    <TouchableOpacity
      onPress={() => void Linking.openURL(embed.url)}
      activeOpacity={0.85}
    >
      <View>
        <Image
          source={{ uri: `https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg` }}
          style={{ width: WIDTH, height: (WIDTH * 9) / 16, borderRadius: 10 }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 34 }}>▶</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
