// Everything that was previously crammed into the header, plus the call
// preferences that had nowhere to live at all. Presentation only: the settings
// object is owned by App, persisted by storage.ts, and shaped by core/settings.

import { ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";

import type { MobileSession } from "../core/session";
import { voiceAudioSummary, type MobileSettings } from "../core/settings";
import type { AndroidUpdate } from "../useAndroidUpdate";
import type { BlocksApi } from "../useBlocks";
import { PUSH_STATUS_TEXT, type PushStatus } from "../usePush";
import { colors, styles } from "../theme";

interface Props {
  session: MobileSession;
  settings: MobileSettings;
  /** Apply a change. App persists it; nothing here waits for the write. */
  onChange: (next: MobileSettings) => void;
  /** Gateway state, spelled the way the header used to spell it. */
  connection: string;
  deviceCount: number;
  onShowDevices: () => void;
  onSignOut: () => void;
  update: AndroidUpdate;
  appVersion: string;
  /** Whether this phone can be rung while the app is closed. Reported rather
   *  than toggled: it depends on OS permission and on server configuration. */
  push: PushStatus;
  /** Blocking is done from a conversation; this is where it is undone, since a
   *  blocked person is no longer a friend and has no row to reach. */
  blocks: BlocksApi;
}

export default function SettingsScreen({
  session,
  settings,
  onChange,
  connection,
  deviceCount,
  onShowDevices,
  onSignOut,
  update,
  appVersion,
  push,
  blocks,
}: Props) {
  const audio = settings.voiceAudio;
  const setAudio = (patch: Partial<MobileSettings["voiceAudio"]>) =>
    onChange({ ...settings, voiceAudio: { ...audio, ...patch } });
  const setRing = (patch: Partial<MobileSettings["ring"]>) =>
    onChange({ ...settings, ring: { ...settings.ring, ...patch } });

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Section title="Account">
        <Line label="Signed in as" value={session.username || "—"} />
        <Line label="Server" value={session.host} />
        <Line label="Connection" value={connection} />
        <TouchableOpacity style={styles.button} onPress={onSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </Section>

      <Section title="Microphone">
        <Toggle
          label="Noise suppression"
          hint="Filters steady background noise — traffic, fans, hum."
          value={audio.noiseSuppression}
          onChange={(v) => setAudio({ noiseSuppression: v })}
        />
        <Toggle
          label="Echo cancellation"
          hint="Stops the other side hearing themselves through your earpiece."
          value={audio.echoCancellation}
          onChange={(v) => setAudio({ echoCancellation: v })}
        />
        <Toggle
          label="Automatic gain"
          hint="Evens out your level so a quiet mic still carries."
          value={audio.autoGainControl}
          onChange={(v) => setAudio({ autoGainControl: v })}
        />
        <Text style={[styles.dim, { marginTop: 8 }]}>{voiceAudioSummary(audio)}</Text>
        <Text style={[styles.dim, { marginTop: 4 }]}>
          Applies to your next call — changing it mid-call does nothing to the one in progress.
        </Text>
      </Section>

      <Section title="Incoming calls">
        <Toggle
          label="Vibrate"
          hint="Buzz while a call is ringing."
          value={settings.ring.vibrate}
          onChange={(v) => setRing({ vibrate: v })}
        />
        <Toggle
          label="Notification"
          hint="Show a call notification, so a call is visible outside the app."
          value={settings.ring.notify}
          onChange={(v) => setRing({ notify: v })}
        />
        <Text style={[styles.dim, { marginTop: 8 }]}>{PUSH_STATUS_TEXT[push]}</Text>
      </Section>

      <Section title="Blocked">
        {blocks.error ? <Text style={styles.error}>{blocks.error}</Text> : null}
        {blocks.blocked.length === 0 ? (
          <Text style={styles.dim}>You haven't blocked anyone.</Text>
        ) : (
          blocks.blocked.map((b) => (
            <View
              key={b.userId}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Text style={{ color: colors.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                {b.username || `Deleted account (${b.userId})`}
              </Text>
              <TouchableOpacity onPress={() => blocks.unblock(b.userId)}>
                <Text style={{ color: colors.accent, fontSize: 14 }}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        <Text style={[styles.dim, { marginTop: 4 }]}>
          Blocked people can't message, call or add you. Unblocking doesn't bring back a
          friendship — you'd each have to add the other again.
        </Text>
      </Section>

      <Section title="Devices">
        <TouchableOpacity style={styles.button} onPress={onShowDevices}>
          <Text style={styles.buttonText}>
            {deviceCount > 0 ? `Your devices (${deviceCount})` : "Your devices"}
          </Text>
        </TouchableOpacity>
      </Section>

      <Section title="App">
        <Line label="Version" value={appVersion} />
        {update.phase === "available" ? (
          <TouchableOpacity style={styles.button} onPress={() => void update.install()}>
            <Text style={styles.buttonText}>Update to {update.version}</Text>
          </TouchableOpacity>
        ) : update.phase === "downloading" || update.phase === "installing" ? (
          <Text style={styles.dim}>Updating…</Text>
        ) : update.phase === "error" ? (
          <>
            <Text style={styles.error}>{update.error || "The update could not be installed."}</Text>
            <TouchableOpacity style={styles.button} onPress={() => void update.openInstallSettings()}>
              <Text style={styles.buttonText}>Allow installs from this app</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => void update.check()}>
              <Text style={{ color: colors.accent, fontSize: 14 }}>Check again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => void update.check()}>
            <Text style={{ color: colors.accent, fontSize: 14 }}>Check for updates</Text>
          </TouchableOpacity>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={[styles.dim, { textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }]}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.panel,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          gap: 10,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.dim}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15 }}>{label}</Text>
        <Text style={styles.dim}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.panelAlt }}
        thumbColor={colors.text}
      />
    </View>
  );
}
