import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";

const LOGO = require("./assets/logo.png");

import { fetchFriends } from "./src/api";
import { friendNames, type Friend } from "./src/core/friends";
import type { MobileSession } from "./src/core/session";
import { useGateway } from "./src/gateway";
import { useCall } from "./src/useCall";
import CallOverlay from "./src/screens/CallOverlay";
import ChatScreen from "./src/screens/ChatScreen";
import GuardPrompt from "./src/screens/GuardPrompt";
import { DevicesModal } from "./src/screens/InstallSheet";
import LibraryScreen from "./src/screens/LibraryScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import SignInScreen from "./src/screens/SignInScreen";
import { clearSession, loadSession, saveSession } from "./src/storage";
import { colors, styles } from "./src/theme";

type Tab = "library" | "chat" | "requests";

const TAB_LABELS: Record<Tab, string> = { library: "Library", chat: "DMs", requests: "Requests" };

export default function App() {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>("library");
  const [showDevices, setShowDevices] = useState(false);
  const [friendList, setFriendList] = useState<Friend[]>([]);

  // The socket is the app's, not a screen's: the sign-in approval push has to
  // arrive whichever tab is showing, and the device list has to already be
  // there when the install picker opens.
  const gateway = useGateway(session);
  const online = gateway.state === "connected";
  // Calls live at the app level for the same reason: an incoming call has to
  // ring on whichever tab is open, including none of them.
  const call = useCall(gateway.send, gateway.setFrameHandler);
  // Names come from the authoritative friend list (fetched below); a call or a
  // conversation can still reference an id the list has no name for, so both the
  // caller name and the DMs screen fall back to "User N" rather than a blank.
  const names = useMemo(() => friendNames(friendList), [friendList]);
  const friendName = (id: number) => names[id] || (id > 0 ? `User ${id}` : "");

  useEffect(() => {
    void (async () => {
      // A stored token is trusted optimistically; the first 401 from any screen
      // signs out, so there is no blocking round-trip on cold start.
      setSession(await loadSession());
      setRestoring(false);
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <TouchableOpacity onPress={() => setShowDevices(true)}>
                <Text style={{ color: online ? colors.ok : colors.dim, fontSize: 13 }}>
                  {online ? `Devices (${gateway.roster.devices.length})` : gateway.state}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={signOut}>
                <Text style={{ color: colors.dim, fontSize: 13 }}>Sign out</Text>
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
              />
            ) : (
              <RequestsScreen session={session} onExpired={signOut} />
            )}
          </View>

          <View style={styles.tabbar}>
            {(["library", "chat", "requests"] as Tab[]).map((t) => (
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
