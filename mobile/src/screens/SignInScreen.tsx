import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ApiError, login } from "../api";
import { loginBlocker, type MobileSession } from "../core/session";
import { colors, styles } from "../theme";

export default function SignInScreen({ onSignedIn }: { onSignedIn: (s: MobileSession) => void }) {
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const blocker = loginBlocker(host, username, password);
    if (blocker) {
      setError(blocker);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSignedIn(await login(host, username, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: "center" }]}>
        <Text style={styles.h1}>ArcadeLauncher</Text>
        <Text style={styles.dim}>Sign in with the same account you use on the launcher.</Text>

        <TextInput
          style={styles.input}
          placeholder="Server address"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={host}
          onChangeText={setHost}
        />
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.dim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#0b0d12" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>

        <View style={{ marginTop: 24 }}>
          <Text style={styles.dim}>
            The companion browses your library and the request board. Installing and launching games stays on the
            desktop launcher.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
