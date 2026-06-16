// Self presence/status control (ROADMAP T9f): a dropdown of selectable statuses
// (Online / Away / Do Not Disturb / Invisible) plus a custom status-text field.
// Options + frame shaping live in statusMenu.ts (unit-tested); this is the thin
// popover UI. Disabled until connected (the presence frame needs a live socket).

import { useEffect, useRef, useState } from "react";
import { STATUS_OPTIONS, statusLabel, MAX_STATUS_TEXT, type SelfStatus } from "../statusMenu";
import { PresenceDot } from "./PresenceDot";

interface Props {
  status: SelfStatus;
  statusText: string;
  connected: boolean;
  onChange: (status: SelfStatus, statusText: string) => void;
}

export function StatusPicker({ status, statusText, connected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draftText, setDraftText] = useState(statusText);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraftText(statusText), [statusText]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (s: SelfStatus) => {
    onChange(s, draftText);
    setOpen(false);
  };
  const commitText = () => {
    if (draftText !== statusText) onChange(status, draftText);
  };

  return (
    <div className="statuspick" ref={rootRef}>
      <button
        className="statuspick__btn"
        disabled={!connected}
        onClick={() => setOpen((o) => !o)}
        title={connected ? "Set your status" : "Connect to set status"}
      >
        <PresenceDot presence={status} />
        <span>{statusLabel(status)}</span>
        {statusText && <span className="statuspick__custom">— {statusText}</span>}
        <span className="statuspick__caret">▾</span>
      </button>

      {open && (
        <div className="statuspick__menu">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`statuspick__opt${o.value === status ? " statuspick__opt--active" : ""}`}
              onClick={() => pick(o.value)}
            >
              <PresenceDot presence={o.value} />
              <span className="statuspick__opt-label">{o.label}</span>
              <span className="statuspick__opt-hint">{o.hint}</span>
            </button>
          ))}
          <div className="statuspick__textrow">
            <input
              className="statuspick__text"
              value={draftText}
              maxLength={MAX_STATUS_TEXT}
              placeholder="Set a custom status…"
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitText();
                  setOpen(false);
                }
              }}
              onBlur={commitText}
            />
            {draftText && (
              <button
                className="statuspick__clear"
                onClick={() => {
                  setDraftText("");
                  onChange(status, "");
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
