// Message composer. Enter sends; typing notifications are throttled so we don't
// spam a `typing` frame on every keystroke.

import { useRef, useState } from "react";

interface Props {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onTyping: () => void;
}

const TYPING_THROTTLE_MS = 3000;

export function Composer({ disabled, placeholder, onSend, onTyping }: Props) {
  const [text, setText] = useState("");
  const lastTyping = useRef(0);

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

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="composer__input"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button className="composer__send" type="submit" disabled={disabled || text.trim() === ""}>
        Send
      </button>
    </form>
  );
}
