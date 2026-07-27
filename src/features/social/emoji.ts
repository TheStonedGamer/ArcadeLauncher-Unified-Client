// Emoji picker data + search. Deliberately a curated set bundled with the app
// rather than a full Unicode table pulled from a CDN: the launcher runs on
// machines with no internet reach to anything but the arcade server, and a
// 1,800-entry table is most of a megabyte for emoji nobody picks. These are the
// ones people actually send in a game chat.
//
// Keywords are what search matches on — the glyph itself is unsearchable, and
// people type "lol" or "gg", not the Unicode name.

export interface Emoji {
  glyph: string;
  name: string;
  keywords: string[];
}

export interface EmojiGroup {
  name: string;
  /** Shown as the group's tab in the picker. */
  icon: string;
  emoji: Emoji[];
}

const e = (glyph: string, name: string, ...keywords: string[]): Emoji => ({
  glyph,
  name,
  keywords,
});

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: "Smileys",
    icon: "😀",
    emoji: [
      e("😀", "grinning", "happy", "smile"),
      e("😄", "smile", "happy", "joy"),
      e("😁", "grin", "happy", "teeth"),
      e("😂", "joy", "lol", "laugh", "crying", "tears"),
      e("🤣", "rofl", "lol", "laugh", "rolling"),
      e("😅", "sweat smile", "phew", "relief", "laugh"),
      e("😊", "blush", "happy", "smile"),
      e("🙂", "slight smile", "happy"),
      e("😉", "wink", "flirt"),
      e("😍", "heart eyes", "love", "crush"),
      e("😘", "kiss", "love"),
      e("😎", "sunglasses", "cool", "deal with it"),
      e("🤩", "star struck", "wow", "amazing"),
      e("🥳", "partying", "celebrate", "birthday"),
      e("😏", "smirk", "sly"),
      e("😐", "neutral", "meh"),
      e("😑", "expressionless", "blank", "meh"),
      e("🙄", "eye roll", "annoyed", "whatever"),
      e("😬", "grimace", "awkward", "yikes"),
      e("🤔", "thinking", "hmm"),
      e("🤨", "raised eyebrow", "suspicious", "doubt"),
      e("😴", "sleeping", "zzz", "tired", "afk"),
      e("🥱", "yawn", "bored", "tired"),
      e("😢", "cry", "sad", "tear"),
      e("😭", "sob", "crying", "sad"),
      e("😤", "triumph", "angry", "steam"),
      e("😡", "rage", "angry", "mad"),
      e("🤬", "cursing", "angry", "swearing"),
      e("😱", "scream", "shocked", "fear"),
      e("😳", "flushed", "embarrassed", "shocked"),
      e("🥺", "pleading", "puppy eyes", "please"),
      e("😇", "innocent", "angel", "halo"),
      e("🤡", "clown", "joke"),
      e("💀", "skull", "dead", "died", "rip"),
      e("👻", "ghost", "boo", "spooky"),
      e("🤖", "robot", "bot"),
      e("👽", "alien", "ufo"),
      e("😈", "devil", "evil", "mischief"),
    ],
  },
  {
    name: "Gestures",
    icon: "👍",
    emoji: [
      e("👍", "thumbs up", "yes", "ok", "gg", "nice"),
      e("👎", "thumbs down", "no", "bad"),
      e("👌", "ok hand", "perfect", "fine"),
      e("🤝", "handshake", "deal", "agree"),
      e("👏", "clap", "applause", "bravo"),
      e("🙌", "raised hands", "praise", "hooray"),
      e("🙏", "pray", "please", "thanks", "sorry"),
      e("🤞", "fingers crossed", "luck", "hope"),
      e("✌️", "peace", "victory"),
      e("🤙", "call me", "shaka", "hang loose"),
      e("💪", "flex", "strong", "muscle"),
      e("🫡", "salute", "yes sir", "o7"),
      e("👋", "wave", "hi", "hello", "bye"),
      e("🖐️", "hand", "stop", "five"),
      e("🤷", "shrug", "idk", "dunno"),
      e("🤦", "facepalm", "ugh", "smh"),
      e("👀", "eyes", "looking", "watching", "sus"),
      e("🧠", "brain", "smart", "big brain"),
    ],
  },
  {
    name: "Gaming",
    icon: "🎮",
    emoji: [
      e("🎮", "controller", "game", "gaming", "play"),
      e("🕹️", "joystick", "arcade", "retro"),
      e("👾", "invader", "arcade", "retro", "alien"),
      e("🏆", "trophy", "win", "won", "champion", "achievement"),
      e("🥇", "gold medal", "first", "win"),
      e("🎯", "bullseye", "target", "headshot", "accurate"),
      e("⚔️", "swords", "pvp", "fight", "battle"),
      e("🛡️", "shield", "defense", "tank"),
      e("🔫", "gun", "shooter", "fps"),
      e("💣", "bomb", "explosive"),
      e("💥", "boom", "explosion", "hit"),
      e("⚡", "lightning", "fast", "speed", "power"),
      e("🔥", "fire", "lit", "hot", "streak", "on fire"),
      e("❄️", "ice", "frozen", "cold"),
      e("🐐", "goat", "greatest", "best"),
      e("🚀", "rocket", "launch", "fast", "boost"),
      e("🎲", "dice", "random", "luck", "rng"),
      e("♟️", "chess pawn", "strategy"),
      e("🧩", "puzzle", "piece"),
      e("🏁", "checkered flag", "finish", "race", "gg"),
      e("⏳", "hourglass", "waiting", "loading"),
      e("🔇", "muted", "no sound", "quiet"),
      e("🎧", "headphones", "audio", "listening"),
      e("🎤", "mic", "voice", "singing"),
      e("📶", "signal", "ping", "connection", "lag"),
    ],
  },
  {
    name: "Symbols",
    icon: "❤️",
    emoji: [
      e("❤️", "red heart", "love", "like"),
      e("🧡", "orange heart", "love"),
      e("💛", "yellow heart", "love"),
      e("💚", "green heart", "love"),
      e("💙", "blue heart", "love"),
      e("💜", "purple heart", "love"),
      e("🖤", "black heart", "love"),
      e("💔", "broken heart", "sad", "heartbreak"),
      e("✨", "sparkles", "shiny", "new", "clean"),
      e("🎉", "party popper", "celebrate", "congrats", "tada"),
      e("🎊", "confetti", "celebrate", "party"),
      e("⭐", "star", "favorite", "rating"),
      e("✅", "check", "done", "yes", "ready"),
      e("❌", "cross", "no", "wrong", "nope"),
      e("⚠️", "warning", "careful", "caution"),
      e("❓", "question", "what", "huh"),
      e("❗", "exclamation", "important", "alert"),
      e("💯", "hundred", "100", "perfect", "facts"),
      e("💤", "zzz", "sleep", "afk", "idle"),
      e("🔗", "link", "url"),
      e("📌", "pin", "pinned", "important"),
      e("🕐", "clock", "time", "soon", "wait"),
    ],
  },
  {
    name: "Food & drink",
    icon: "🍕",
    emoji: [
      e("🍕", "pizza", "food"),
      e("🍔", "burger", "food"),
      e("🌮", "taco", "food"),
      e("🍟", "fries", "food"),
      e("🍿", "popcorn", "movie", "watching", "drama"),
      e("🍰", "cake", "birthday", "dessert"),
      e("🍺", "beer", "drink", "cheers"),
      e("🍻", "cheers", "beers", "drink"),
      e("☕", "coffee", "caffeine", "morning"),
      e("🥤", "soda", "drink"),
      e("🍫", "chocolate", "sweet"),
      e("🍎", "apple", "fruit"),
    ],
  },
];

/** Every emoji, flattened — the search corpus and the "all" fallback. */
export const ALL_EMOJI: Emoji[] = EMOJI_GROUPS.flatMap((g) => g.emoji);

/**
 * Search by name and keyword. Prefix matches rank above mid-word ones so typing
 * "fire" puts 🔥 first rather than whatever merely mentions fire. A blank query
 * returns nothing — the caller shows the browsable groups instead.
 */
export function searchEmoji(query: string, limit = 48): Emoji[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const scored: { emoji: Emoji; score: number }[] = [];
  for (const item of ALL_EMOJI) {
    const terms = [item.name, ...item.keywords];
    let best = -1;
    for (const t of terms) {
      const i = t.indexOf(q);
      if (i === 0) best = Math.max(best, 2);
      else if (i > 0) best = Math.max(best, 1);
    }
    // Typing the emoji itself (paste) should find it too.
    if (item.glyph === q) best = 3;
    if (best > 0) scored.push({ emoji: item, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.emoji.name.localeCompare(b.emoji.name))
    .slice(0, limit)
    .map((s) => s.emoji);
}

export const MAX_RECENT = 24;

/**
 * Most-recently-used first, de-duplicated, capped. Kept pure so the picker can
 * persist the result wherever it likes.
 */
export function pushRecent(recent: string[], glyph: string): string[] {
  return [glyph, ...recent.filter((g) => g !== glyph)].slice(0, MAX_RECENT);
}

/** Drop anything that isn't in the bundled set — stored recents outlive edits
 *  to the table above, and a glyph we no longer know has no name to show. */
export function parseRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(ALL_EMOJI.map((x) => x.glyph));
  return value.filter((g): g is string => typeof g === "string" && known.has(g)).slice(0, MAX_RECENT);
}
