import { useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { decideQrSignin, inspectQrSignin } from "../api";
import {
  parseQrSignin,
  qrMatchesSessionServer,
  type QrSigninChallenge,
  type QrSigninDetails,
} from "../core/qr";
import type { MobileSession } from "../core/session";
import { colors, styles } from "../theme";

export default function QrLoginScreen({ session }: { session: MobileSession }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [challenge, setChallenge] = useState<QrSigninChallenge | null>(null);
  const [details, setDetails] = useState<QrSigninDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setChallenge(null);
    setDetails(null);
    setError(null);
    setDone(null);
  };

  const scanned = async ({ data }: { data: string }) => {
    if (busy || challenge) return;
    setBusy(true);
    setError(null);
    const parsed = parseQrSignin(data);
    if (!parsed) {
      setError("That is not an Arcade Launcher sign-in code.");
      setBusy(false);
      return;
    }
    if (!qrMatchesSessionServer(parsed, session.host)) {
      setError("This code belongs to a different Arcade Launcher server.");
      setBusy(false);
      return;
    }
    try {
      const inspected = await inspectQrSignin(session, parsed);
      setChallenge(parsed);
      setDetails(inspected);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await decideQrSignin(session, challenge, approve);
      setDone(approve ? "Sign-in approved." : "Sign-in denied.");
      setChallenge(null);
      setDetails(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!permission) {
    return <View style={[styles.pad, { flex: 1, justifyContent: "center" }]}><ActivityIndicator color={colors.accent} /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={[styles.pad, { flex: 1, justifyContent: "center" }]}>
        <Text style={styles.h1}>QR Login</Text>
        <Text style={[styles.dim, { marginTop: 8 }]}>Camera access is needed to scan sign-in codes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.pad, { flex: 1 }]}>
      <Text style={styles.h1}>QR Login</Text>
      <Text style={[styles.dim, { marginBottom: 14 }]}>
        Scan a code shown by the desktop launcher or website. You will confirm the device before signing in.
      </Text>

      {details ? (
        <View style={{ backgroundColor: colors.panel, borderRadius: 14, padding: 16 }}>
          <Text style={styles.h2}>Approve sign-in?</Text>
          <Detail label="Destination" value={details.target === "store" ? "Website" : "Desktop launcher"} />
          <Detail label="Device" value={details.deviceName} />
          <Detail label="From" value={details.ip || "unknown location"} />
          <Text style={[styles.dim, { marginTop: 12 }]}>Expires in about {details.expiresIn}s.</Text>
          <TouchableOpacity style={styles.button} disabled={busy} onPress={() => void decide(true)}>
            <Text style={styles.buttonText}>Approve sign-in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "transparent", borderColor: colors.danger, borderWidth: 1 }]}
            disabled={busy}
            onPress={() => void decide(false)}
          >
            <Text style={[styles.buttonText, { color: colors.danger }]}>Deny</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 280, borderRadius: 14, overflow: "hidden" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={busy ? undefined : (result) => void scanned(result)}
          />
          {busy && (
            <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#0008" }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {done && (
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Text style={{ color: colors.ok, fontWeight: "700" }}>{done}</Text>
          <TouchableOpacity style={[styles.button, { alignSelf: "stretch" }]} onPress={reset}>
            <Text style={styles.buttonText}>Scan another code</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16, marginTop: 10 }}>
      <Text style={styles.dim}>{label}</Text>
      <Text style={[styles.dim, { color: colors.text, flex: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}
