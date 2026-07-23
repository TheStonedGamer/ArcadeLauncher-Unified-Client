import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import type { MobileSession } from "./src/core/session";
import LibraryScreen from "./src/screens/LibraryScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import SignInScreen from "./src/screens/SignInScreen";
import { clearSession, loadSession, saveSession } from "./src/storage";
import { colors, styles } from "./src/theme";

type Tab = "library" | "requests";

export default function App() {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>("library");

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
            <TouchableOpacity onPress={signOut}>
              <Text style={{ color: colors.dim, fontSize: 13 }}>Sign out</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            {tab === "library" ? (
              <LibraryScreen session={session} onExpired={signOut} />
            ) : (
              <RequestsScreen session={session} onExpired={signOut} />
            )}
          </View>

          <View style={styles.tabbar}>
            {(["library", "requests"] as Tab[]).map((t) => (
              <TouchableOpacity key={t} style={styles.tab} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                  {t === "library" ? "Library" : "Requests"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
