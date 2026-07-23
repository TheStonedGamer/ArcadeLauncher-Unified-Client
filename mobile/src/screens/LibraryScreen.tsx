import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ApiError, fetchCatalog } from "../api";
import { filterGames, formatSize, gameSubtitle, platformsOf, type MobileGame } from "../core/catalog";
import type { MobileSession } from "../core/session";
import { colors, styles } from "../theme";

export default function LibraryScreen({ session, onExpired }: { session: MobileSession; onExpired: () => void }) {
  const [games, setGames] = useState<MobileGame[]>([]);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [selected, setSelected] = useState<MobileGame | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError("");
    try {
      setGames(await fetchCatalog(session));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onExpired();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load the library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.host, session.token]);

  const platforms = useMemo(() => platformsOf(games), [games]);
  const shown = useMemo(() => filterGames(games, query, platform), [games, query, platform]);

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.pad}>
        <TextInput
          style={[styles.input, { marginTop: 0 }]}
          placeholder={`Search ${games.length} games`}
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {platforms.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, flexGrow: 0 }}>
          {["", ...platforms].map((p) => (
            <TouchableOpacity
              key={p || "all"}
              style={[styles.chip, platform === p && styles.chipOn]}
              onPress={() => setPlatform(p)}
            >
              <Text style={[styles.chipText, platform === p && styles.chipTextOn]}>{p || "All"}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {error ? <Text style={[styles.error, { paddingHorizontal: 16 }]}>{error}</Text> : null}

      <FlatList
        style={{ marginTop: 8 }}
        data={shown}
        keyExtractor={(g) => g.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.dim} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing matches that search.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setSelected(item)}>
            {item.coverArtUrl ? (
              <Image source={{ uri: item.coverArtUrl }} style={styles.cover} />
            ) : (
              <View style={styles.cover} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.h2} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.dim} numberOfLines={1}>
                {gameSubtitle(item)}
              </Text>
            </View>
            <Text style={styles.dim}>{formatSize(item.sizeBytes)}</Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.pad}>
          {selected && (
            <>
              {selected.coverArtUrl ? (
                <Image
                  source={{ uri: selected.coverArtUrl }}
                  style={{ width: 140, height: 190, borderRadius: 10, marginBottom: 16 }}
                />
              ) : null}
              <Text style={styles.h1}>{selected.title}</Text>
              <Text style={styles.dim}>{gameSubtitle(selected)}</Text>
              {selected.developer ? <Text style={styles.dim}>{selected.developer}</Text> : null}
              {selected.genres ? <Text style={styles.dim}>{selected.genres}</Text> : null}
              <Text style={[styles.dim, { marginTop: 8 }]}>Download size {formatSize(selected.sizeBytes)}</Text>
              {selected.summary ? (
                <Text style={{ color: colors.text, marginTop: 16, lineHeight: 21 }}>{selected.summary}</Text>
              ) : null}
              <Text style={[styles.dim, { marginTop: 24 }]}>
                Installing is done from the desktop launcher — the companion is read-only for the library.
              </Text>
              <TouchableOpacity style={styles.button} onPress={() => setSelected(null)}>
                <Text style={styles.buttonText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}
