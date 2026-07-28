import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Application from "expo-application";

const LOGO = require("./assets/logo.png");

import { fetchFriends } from "./src/api";
import { friendNames, type Friend } from "./src/core/friends";
import type { MobileSession } from "./src/core/session";
import { useGateway } from "./src/gateway";
import { useCall } from "./src/useCall";
import { useAndroidUpdate } from "./src/useAndroidUpdate";
import CallOverlay from "./src/screens/CallOverlay";
import ChatScreen from "./src/screens/ChatScreen";
import GuardPrompt from "./src/screens/GuardPrompt";
import { DevicesModal } from "./src/screens/InstallSheet";
import LibraryScreen from "./src/screens/LibraryScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import QrLoginScreen from "./src/screens/QrLoginScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import SignInScreen from "./src/screens/SignInScreen";
import { clearSession, loadSession, saveSession, loadSettings, saveSettings } from "./src/storage";
import { DEFAULT_SETTINGS, type MobileSettings } from "./src/core/settings";
import { ensureCallChannel, useRing } from "./src/useRing";
import { usePush } from "./src/usePush";
import { useBlocks } from "./src/useBlocks";
import { colors, styles } from "./src/theme";

type Tab = "library" | "chat" | "requests" | "qr" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  library: "Games",
  chat: "DMs",
  requests: "Requests",
  qr: "QR Login",
  settings: "Settings",
};

export default function App() {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>("library");
  const [showDevices, setShowDevices] = useState(false);
  const [friendList, setFriendList] = useState<Friend[]>([]);
  const [settings, setSettings] = useState<MobileSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const update = useAndroidUpdate();

  // The socket is the app's, not a screen's: the sign-in approval push has to
  // arrive whichever tab is showing, and the device list has to already be
  // there when the install picker opens.
  const gateway = useGateway(session);
  const online = gateway.state === "connected";
  // Calls live at the app level for the same reason: an incoming call has to
  // ring on whichever tab is open, including none of them.
  // The mic settings are read at capture time rather than closed over, so
  // changing them in Settings applies to the next call with no remount.
  const call = useCall(gateway.send, gateway.setFrameHandler, async () => settingsRef.current.voiceAudio);
  // Names come from the authoritative friend list (fetched below); a call or a
  // conversation can still reference an id the list has no name for, so both the
  // caller name and the DMs screen fall back to "User N" rather than a blank.
  const names = useMemo(() => friendNames(friendList), [friendList]);
  const friendName = (id: number) => names[id] || (id > 0 ? `User ${id}` : "");
  // Buzz and notify while a call rings, wherever the user is in the app.
  useRing(call.state, friendName(call.state.peerId), settings.ring);
  // And register this device so a call reaches it when the app is not running.
  const push = usePush(session);
  // Blocking is offered in a conversation and undone in Settings, so the list
  // lives here rather than inside either screen.
  const blocks = useBlocks(session);

  useEffect(() => {
    void (async () => {
      // A stored token is trusted optimistically; the first 401 from any screen
      // signs out, so there is no blocking round-trip on cold start.
      setSession(await loadSession());
      setSettings(await loadSettings());
      setRestoring(false);
    })();
    void ensureCallChannel();
  }, []);

  // `useCall` reads the mic settings through a ref so its capture callback is
  // stable; this keeps that ref current.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applySettings = (next: MobileSettings) => {
    setSettings(next);
    void saveSettings(next);
  };

  useEffect(() => {
    void (async () => {
    })();
  }, []);

  // Load the friend roster whenever the session changes. This is the snapshot
  // the DMs list is built from: gateway presence frames only report *changes*,
  // so a friend already online at connect would otherwise never appear. A
  // failure here leaves the list empty rather than blocking the app — the
  // gateway still fills in anyone whose presence changes after connect.
  useEffect(() => {
    if (!session) {
      setFriendList([]);
      return;
    }
    let alive = true;
    void fetchFriends(session)
      .then((list) => {
        if (alive) setFriendList(list);
      })
      .catch(() => {
        /* offline or expired token; the library screen handles the 401 */
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const signIn = (s: MobileSession) => {
    setSession(s);
    void saveSession(s);
  };

  const signOut = () => {
    setSession(null);
    void clearSession();
  };

  if (restoring) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {!session ? (
        <SignInScreen onSignedIn={signIn} />
      ) : (
        <>
          <View style={styles.brandBar}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Image source={LOGO} style={styles.brandLogo} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={styles.brandTitle}>Arcade Launcher</Text>
                {session.username ? (
                  <Text style={styles.dim} numberOfLines={1}>
                    {session.username}
                  </Text>
                ) : null}
              </View>
            </View>
            {/* The header keeps only what is worth glancing at. Sign out,
                devices and updates moved to the Settings tab, where they can be
                explained rather than abbreviated into a header. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              {update.phase === "available" ? (
                <TouchableOpacity onPress={() => setTab("settings")}>
                  <Text style={{ color: colors.accent, fontSize: 13 }}>Update {update.version}</Text>
                </TouchableOpacity>
              ) : update.phase === "downloading" || update.phase === "installing" ? (
                <Text style={{ color: colors.accent, fontSize: 13 }}>Updating…</Text>
              ) : null}
              <TouchableOpacity onPress={() => setTab("settings")}>
                <Text style={{ color: online ? colors.ok : colors.dim, fontSize: 13 }}>
                  {online ? "Online" : gateway.state}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {tab === "library" ? (
              <LibraryScreen
                session={session}
                onExpired={signOut}
                roster={gateway.roster}
                online={online}
                send={gateway.send}
              />
            ) : tab === "chat" ? (
              <ChatScreen
                session={session}
                roster={gateway.roster}
                online={online}
                send={gateway.send}
                friends={friendList}
                onCall={call.start}
                onBlock={(id, username) => {
                  blocks.block(id, username);
                  // The server drops the friendship too, so take the row away
                  // now rather than waiting for the next sign-in to refetch.
                  setFriendList((cur) => cur.filter((f) => f.id !== id));
                }}
              />
            ) : tab === "requests" ? (
              <RequestsScreen session={session} onExpired={signOut} />
            ) : tab === "qr" ? (
              <QrLoginScreen session={session} />
            ) : (
              <SettingsScreen
                session={session}
                settings={settings}
                onChange={applySettings}
                connection={online ? "Connected" : gateway.state}
                deviceCount={gateway.roster.devices.length}
                onShowDevices={() => setShowDevices(true)}
                onSignOut={signOut}
                update={update}
                appVersion={Application.nativeApplicationVersion ?? "—"}
                push={push}
                blocks={blocks}
              />
            )}
          </View>

          <View style={styles.tabbar}>
            {(["library", "chat", "requests", "qr", "settings"] as Tab[]).map((t) => (
              <TouchableOpacity key={t} style={styles.tab} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{TAB_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <DevicesModal roster={gateway.roster} visible={showDevices} onClose={() => setShowDevices(false)} />
          <GuardPrompt roster={gateway.roster} send={gateway.send} onAnswered={gateway.dismissGuard} />
          <CallOverlay call={call} name={friendName(call.state.peerId)} />
        </>
      )}
    </SafeAreaView>
  );
}
