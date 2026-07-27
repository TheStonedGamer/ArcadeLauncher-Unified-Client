// Message composer. Enter sends; typing notifications are throttled so we don't
// spam a `typing` frame on every keystroke.
//
// Emoji insert into the draft (you usually want them alongside words); a GIF
// sends immediately as its own message, since a URL mixed into a sentence
// deliberately won't render inline (see gifs.ts).

import { useRef, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";

interface Props {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onTyping: () => void;
  /** Pick + send a file attachment (absent → no paperclip shown). */
  onAttach?: () => void;
}

const TYPING_THROTTLE_MS = 3000;

export function Composer({
  disabled,
  placeholder,
  onSend,
  onTyping,
  onAttach,
}: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState<"emoji" | "gif" | null>(null);
  const lastTyping = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    const t = text.trim();
    if (t === "") return;
    onSend(t);
    setText("");
  }

  function onChange(value: string) {
    setText(value);
    const now = Date.now();
    if (value !== "" && now - lastTyping.current > TYPING_THROTTLE_MS) {
      lastTyping.current = now;
      onTyping();
    }
  }

  // Insert at the caret rather than appending, so picking an emoji mid-sentence
  // lands where you were typing.
  function insert(glyph: string) {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? at;
    const next = text.slice(0, at) + glyph + text.slice(to);
    setText(next);
    setOpen(null);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = at + glyph.length;
      el?.setSelectionRange(caret, caret);
    });
  }

  function sendGif(url: string) {
    setOpen(null);
    onSend(url);
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {onAttach && (
        <button
          className="composer__attach"
          type="button"
          disabled={disabled}
          onClick={onAttach}
          aria-label="Attach a file"
          title="Attach a file"
        >
          📎
        </button>
      )}
      <span className="composer__picker-anchor">
        <button
          className={`composer__icon${open === "emoji" ? " composer__icon--on" : ""}`}
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setOpen((o) => (o === "emoji" ? null : "emoji"))}
          aria-label="Insert emoji"
          title="Emoji"
        >
          😊
        </button>
        {open === "emoji" && (
          <EmojiPicker onPick={insert} onClose={() => setOpen(null)} />
        )}
      </span>
      <span className="composer__picker-anchor">
        <button
          className={`composer__icon${open === "gif" ? " composer__icon--on" : ""}`}
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setOpen((o) => (o === "gif" ? null : "gif"))}
          aria-label="Send a GIF"
          title="GIF"
        >
          GIF
        </button>
        {open === "gif" && (
          <GifPicker onPick={sendGif} onClose={() => setOpen(null)} />
        )}
      </span>
      <input
        className="composer__input"
        ref={input}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="composer__send"
        type="submit"
        disabled={disabled || text.trim() === ""}
      >
        Send
      </button>
    </form>
  );
}
