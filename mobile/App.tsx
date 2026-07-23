import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import type { MobileSession } from "./src/core/session";
import { useGateway } from "./src/gateway";
import ChatScreen from "./src/screens/ChatScreen";
import GuardPrompt from "./src/screens/GuardPrompt";
import { DevicesModal } from "./src/screens/InstallSheet";
import LibraryScreen from "./src/screens/LibraryScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import SignInScreen from "./src/screens/SignInScreen";
import { clearSession, loadSession, saveSession } from "./src/storage";
import { colors, styles } from "./src/theme";

type Tab = "library" | "chat" | "requests";

const TAB_LABELS: Record<Tab, string> = { library: "Library", chat: "Friends", requests: "Requests" };

export default function App() {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>("library");
  const [showDevices, setShowDevices] = useState(false);

  // The socket is the app's, not a screen's: the sign-in approval push has to
  // arrive whichever tab is showing, and the device list has to already be
  // there when the install picker opens.
  const gateway = useGateway(session);
  const online = gateway.state === "connected";
  const friends = useMemo(() => {
    const map: Record<number, string> = {};
    for (const id of Object.keys(gateway.roster.presence)) map[Number(id)] = "";
    for (const id of Object.keys(gateway.roster.conversations)) map[Number(id)] = map[Number(id)] ?? "";
    return map;
  }, [gateway.roster.presence, gateway.roster.conversations]);

  useEffect(() => {
    void (async () => {
      // A stored token is trusted optimistically; the first 401 from any screen
      // signs out, so there is no blocking round-trip on cold start.
      setSession(await loadSession());
      setRestoring(false);
    })();
  }, []);

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
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text style={styles.h2}>{session.username || session.host}</Text>
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
              <ChatScreen session={session} roster={gateway.roster} online={online} send={gateway.send} friends={friends} />
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
        </>
      )}
    </SafeAreaView>
  );
}
