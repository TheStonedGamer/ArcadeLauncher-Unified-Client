// "Install this on my PC" — the picker and its result.
//
// The list is `installTargets(...)`, which mirrors the server's desktop-only
// rule, so the phone cannot offer a machine the relay would then refuse. It is
// also always the account's own signed-in machines and nothing else: the server
// builds the list from sockets already authenticated as this user, so there is
// no addressing here that could reach someone else's PC.

import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from "react-native";

import type { MobileGame } from "../core/catalog";
import type { RosterState } from "../core/roster";
import { installTargets, outbound } from "../core/social";
import { colors, styles } from "../theme";

export default function InstallSheet({
  game,
  roster,
  online,
  send,
  onClose,
}: {
  game: MobileGame;
  roster: RosterState;
  online: boolean;
  send: (frame: string) => boolean;
  onClose: () => void;
}) {
  const targets = installTargets(roster.devices);
  const notice = roster.install?.gameId === game.id ? roster.install : null;

  // The Close button lives outside the branches: whatever the state, the user
  // must be able to get out of the modal this sheet is rendered into.
  const reason = !online
    ? "Connect to the server to install on a PC."
    : targets.length === 0
      ? "No PC is signed in right now. Open ArcadeLauncher on the PC you want to install to."
      : "";

  return (
    <View style={{ marginTop: 24 }}>
      {reason ? <Text style={styles.dim}>{reason}</Text> : <Text style={styles.h2}>Install on</Text>}
      {targets.map((device) => (
        <TouchableOpacity
          key={device.id}
          style={[styles.row, { paddingHorizontal: 0 }]}
          onPress={() => send(outbound.remoteInstall(device.id, game.id, game.title))}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.h2} numberOfLines={1}>
              {device.name}
            </Text>
            <Text style={styles.dim}>{device.version ? `ArcadeLauncher ${device.version}` : "Signed in"}</Text>
          </View>
          <Text style={{ color: colors.accent, fontWeight: "700" }}>Install</Text>
        </TouchableOpacity>
      ))}

      {notice && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          {notice.status === "sent" && <ActivityIndicator color={colors.dim} size="small" />}
          <Text
            style={{
              flex: 1,
              color:
                notice.status === "refused" || notice.status === "failed"
                  ? colors.danger
                  : notice.status === "done"
                    ? colors.ok
                    : colors.dim,
              fontSize: 13,
            }}
          >
            {notice.message || notice.status}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.button} onPress={onClose}>
        <Text style={styles.buttonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Full-screen variant, for the tab that lists the account's machines without a
 *  game in hand. */
export function DevicesModal({
  roster,
  visible,
  onClose,
}: {
  roster: RosterState;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, styles.pad]}>
        <Text style={styles.h1}>Your devices</Text>
        {roster.devices.length === 0 ? (
          <Text style={styles.empty}>Nothing else is signed in.</Text>
        ) : (
          roster.devices.map((d) => (
            <View key={d.id} style={[styles.row, { paddingHorizontal: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.h2}>{d.name}</Text>
                <Text style={styles.dim}>
                  {d.kind === "desktop" ? "PC" : d.kind === "mobile" ? "Phone" : "Device"}
                  {d.version ? ` · ${d.version}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
