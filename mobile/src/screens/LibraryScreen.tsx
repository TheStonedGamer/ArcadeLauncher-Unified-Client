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

import { addToLibrary, ApiError, fetchCatalog, fetchLibrary, removeFromLibrary } from "../api";
import {
  filterGames,
  formatSize,
  gameSubtitle,
  gamesInLibrary,
  platformsOf,
  type MobileGame,
} from "../core/catalog";
import type { RosterState } from "../core/roster";
import type { MobileSession } from "../core/session";
import { colors, styles } from "../theme";
import InstallSheet from "./InstallSheet";

export default function LibraryScreen({
  session,
  onExpired,
  roster,
  online,
  send,
}: {
  session: MobileSession;
  onExpired: () => void;
  roster: RosterState;
  online: boolean;
  send: (frame: string) => boolean;
}) {
  const [section, setSection] = useState<"store" | "library">("store");
  const [games, setGames] = useState<MobileGame[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [selected, setSelected] = useState<MobileGame | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState("");

  const load = async () => {
    setError("");
    try {
      const [catalog, library] = await Promise.all([fetchCatalog(session), fetchLibrary(session)]);
      setGames(catalog);
      setOwnedIds(new Set(library.gameIds));
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

  const sectionGames = useMemo(
    () => (section === "library" ? gamesInLibrary(games, ownedIds) : games),
    [games, ownedIds, section],
  );
  const platforms = useMemo(() => platformsOf(sectionGames), [sectionGames]);
  const shown = useMemo(
    () => filterGames(sectionGames, query, platform),
    [sectionGames, query, platform],
  );

  const changeOwnership = async (game: MobileGame, owned: boolean) => {
    setChanging(game.id);
    setError("");
    try {
      if (owned) {
        await removeFromLibrary(session, game.id);
        setOwnedIds((ids) => {
          const next = new Set(ids);
          next.delete(game.id);
          return next;
        });
      } else {
        await addToLibrary(session, game.id);
        setOwnedIds((ids) => new Set(ids).add(game.id));
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onExpired();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not update your library");
    } finally {
      setChanging("");
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.sectionTabs}>
        {(["store", "library"] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.sectionTab, section === item && styles.sectionTabOn]}
            onPress={() => {
              setSection(item);
              setPlatform("");
            }}
          >
            <Text style={[styles.sectionTabText, section === item && styles.sectionTabTextOn]}>
              {item === "store" ? "Store" : `Library (${ownedIds.size})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.pad}>
        <TextInput
          style={[styles.input, { marginTop: 0 }]}
          placeholder={`Search ${sectionGames.length} games`}
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
        ListEmptyComponent={
          <Text style={styles.empty}>
            {section === "library" && ownedIds.size === 0
              ? "Your library is empty. Add games from the Store."
              : "Nothing matches that search."}
          </Text>
        }
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
              <TouchableOpacity
                style={[styles.button, { backgroundColor: ownedIds.has(selected.id) ? colors.panelAlt : colors.accent }]}
                disabled={changing === selected.id}
                onPress={() => void changeOwnership(selected, ownedIds.has(selected.id))}
              >
                <Text style={[styles.buttonText, ownedIds.has(selected.id) && { color: colors.text }]}>
                  {changing === selected.id
                    ? "Updating…"
                    : ownedIds.has(selected.id)
                      ? "Remove from Library"
                      : "Add to Library"}
                </Text>
              </TouchableOpacity>
              {ownedIds.has(selected.id) ? (
                <InstallSheet
                  game={selected}
                  roster={roster}
                  online={online}
                  send={send}
                  onClose={() => setSelected(null)}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}
