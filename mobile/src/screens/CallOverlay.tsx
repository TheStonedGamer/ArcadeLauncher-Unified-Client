// The call, over everything else. It is a Modal rather than a screen because a
// call has to be answerable from whatever tab the phone happened to be on when
// it rang, and must not be dismissable by wandering off to another tab.

import { Modal, Text, TouchableOpacity, View } from "react-native";
import { RTCView } from "react-native-webrtc";

import { callStatusText, canShareVideo, isBusy } from "../core/call";
import type { Call } from "../useCall";
import { colors, styles } from "../theme";

export default function CallOverlay({ call, name }: { call: Call; name: string }) {
  const { state } = call;
  const visible = isBusy(state);
  const showRemote = !!call.remoteStream && state.remoteVideo !== "none";
  const showLocal = !!call.localStream && state.localVideo === "camera";

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={call.hangup}>
      <View style={[styles.screen, { justifyContent: "space-between" }]}>
        <View style={{ flex: 1, backgroundColor: colors.panel }}>
          {showRemote && call.remoteStream ? (
            <RTCView
              streamURL={call.remoteStream.toURL()}
              objectFit="cover"
              style={{ flex: 1 }}
              zOrder={0}
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={[styles.h1, { textAlign: "center" }]}>{name}</Text>
              <Text style={styles.dim}>{callStatusText(state, name)}</Text>
            </View>
          )}

          {showLocal && call.localStream ? (
            <RTCView
              streamURL={call.localStream.toURL()}
              objectFit="cover"
              mirror
              zOrder={1}
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                width: 96,
                height: 128,
                borderRadius: 10,
                backgroundColor: colors.panelAlt,
              }}
            />
          ) : null}
        </View>

        {showRemote ? (
          <Text style={[styles.dim, { textAlign: "center", paddingTop: 8 }]}>
            {callStatusText(state, name)}
          </Text>
        ) : null}
        {call.error ? <Text style={[styles.error, { textAlign: "center" }]}>{call.error}</Text> : null}

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, padding: 20 }}>
          {state.phase === "ringing" ? (
            // Answering is the only action that matters while it rings, so the
            // camera and mute buttons stay out of the way until there is a call
            // to apply them to.
            <>
              <Action label="Decline" tone={colors.danger} onPress={call.hangup} />
              <Action label="Answer" tone={colors.ok} onPress={call.accept} />
            </>
          ) : (
            <>
              <Action
                label={state.muted ? "Unmute" : "Mute"}
                tone={state.muted ? colors.accent : colors.panelAlt}
                onPress={call.toggleMute}
              />
              {canShareVideo(state.phase) ? (
                <Action
                  label={state.localVideo === "camera" ? "Camera off" : "Camera"}
                  tone={state.localVideo === "camera" ? colors.accent : colors.panelAlt}
                  onPress={call.toggleCamera}
                />
              ) : null}
              <Action label="Hang up" tone={colors.danger} onPress={call.hangup} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Action({ label, tone, onPress }: { label: string; tone: string; onPress: () => void }) {
  const dark = tone !== colors.panelAlt;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: tone,
        borderRadius: 999,
        paddingVertical: 14,
        paddingHorizontal: 22,
        minWidth: 110,
        alignItems: "center",
      }}
    >
      <Text style={{ color: dark ? "#0b0d12" : colors.text, fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </TouchableOpacity>
  );
}
