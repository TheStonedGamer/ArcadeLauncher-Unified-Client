// The sign-in approval sheet. It appears over whatever screen is showing,
// because a sign-in the owner did not start is the one thing worth interrupting
// them for.
//
// The countdown is honest: when it reaches zero the sheet closes itself rather
// than leaving a button that the server would refuse. Nothing is lost by that —
// on the server side an unanswered request degrades the sign-in to "type your
// code", so a missed prompt is an inconvenience, never a lockout.

import { useEffect, useState } from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";

import { liveGuard, secondsLeft, type RosterState } from "../core/roster";
import { outbound } from "../core/social";
import { colors, styles } from "../theme";

export default function GuardPrompt({
  roster,
  send,
  onAnswered,
}: {
  roster: RosterState;
  send: (frame: string) => boolean;
  onAnswered: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const prompt = liveGuard(roster, now);

  // Closing on expiry is an effect rather than part of the render, so the
  // parent's state update does not happen mid-render.
  useEffect(() => {
    if (roster.guard && !prompt) onAnswered();
  }, [roster.guard, prompt, onAnswered]);

  if (!prompt) return null;

  const answer = (approve: boolean) => {
    send(outbound.guardDecision(prompt.requestId, approve));
    onAnswered();
  };

  const left = secondsLeft(prompt, now);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => answer(false)}>
      <View style={{ flex: 1, backgroundColor: "#000000cc", justifyContent: "flex-end" }}>
        <View
          style={{
            backgroundColor: colors.panel,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            padding: 20,
            paddingBottom: 32,
          }}
        >
          <Text style={styles.h1}>Approve sign-in?</Text>
          <Text style={[styles.dim, { fontSize: 15, marginTop: 4 }]}>
            {prompt.prompt || `${prompt.deviceName || "A device"} is trying to sign in.`}
          </Text>

          <View style={{ marginTop: 16, gap: 4 }}>
            <Detail label="Device" value={prompt.deviceName || "unknown device"} />
            <Detail label="From" value={prompt.ip || "unknown location"} />
          </View>

          <Text style={[styles.dim, { marginTop: 16 }]}>
            {left > 0
              ? `Expires in ${left}s. If you did not start this, deny it and change your password.`
              : "Expired."}
          </Text>

          <TouchableOpacity style={styles.button} onPress={() => answer(true)}>
            <Text style={styles.buttonText}>That was me — approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "transparent", borderColor: colors.danger, borderWidth: 1 }]}
            onPress={() => answer(false)}
          >
            <Text style={[styles.buttonText, { color: colors.danger }]}>Deny</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={styles.dim}>{label}</Text>
      <Text style={[styles.dim, { color: colors.text }]}>{value}</Text>
    </View>
  );
}
