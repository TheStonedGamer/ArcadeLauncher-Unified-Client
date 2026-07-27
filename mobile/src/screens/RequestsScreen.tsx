import { useEffect, useState } from "react";
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

import {
  ApiError,
  createRequest,
  fetchRequests,
  searchRequestCandidates,
  voteRequest,
} from "../api";
import {
  applyVote,
  createBodyFromHit,
  hitSubtitle,
  isSearchable,
  outcomeMessage,
  sortRequests,
  statusLabel,
  voteLabel,
  type MobileRequest,
  type RequestHit,
} from "../core/requests";
import type { MobileSession } from "../core/session";
import { colors, styles } from "../theme";

const SEARCH_DEBOUNCE_MS = 350;

/** Search for a game to request, or browse what's already been asked for.
 *
 *  Search is the primary mode — typing anything switches the list to IGDB hits
 *  you can file a request from. With an empty box it falls back to the board,
 *  which is still where you upvote what other people asked for. */
export default function RequestsScreen({ session, onExpired }: { session: MobileSession; onExpired: () => void }) {
  const [rows, setRows] = useState<MobileRequest[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RequestHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [picked, setPicked] = useState<RequestHit | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** 401/403 anywhere means the stored token is dead — bounce to sign-in. */
  const handle = (err: unknown, fallback: string): void => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      onExpired();
      return;
    }
    setError(err instanceof ApiError ? err.message : fallback);
  };

  const load = async () => {
    setError("");
    try {
      setRows(sortRequests((await fetchRequests(session)).requests));
    } catch (err) {
      handle(err, "Could not load the request board");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.host, session.token]);

  // Debounced search. Every run re-checks `cancelled` before it commits, so a
  // slow response for an old query can't overwrite a newer one's results.
  useEffect(() => {
    if (!isSearchable(query)) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchRequestCandidates(session, query);
          if (!cancelled) setHits(found);
        } catch (err) {
          if (!cancelled) {
            setHits([]);
            handle(err, "Search is unavailable right now");
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, session.host, session.token]);

  const vote = async (row: MobileRequest) => {
    // Optimistic, then reconciled with whatever the server says it stored.
    setRows((prev) => prev.map((r) => (r.id === row.id ? applyVote(r, !r.votedByMe) : r)));
    try {
      const voted = await voteRequest(session, row.id);
      setRows((prev) => prev.map((r) => (r.id === row.id ? applyVote(r, voted) : r)));
    } catch {
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      setError("Vote did not go through");
    }
  };

  const submit = async () => {
    if (!picked) return;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await createRequest(session, createBodyFromHit(picked, note));
      setNotice(outcomeMessage(outcome, picked.name));
      setPicked(null);
      setNote("");
      setQuery("");
      // The board just changed either way — a new row, or a vote on an old one.
      await load();
    } catch (err) {
      handle(err, "Could not file that request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const searchMode = isSearchable(query);

  return (
    <View style={styles.screen}>
      <View style={styles.pad}>
        <TextInput
          style={[styles.input, { marginTop: 0 }]}
          placeholder="Search for a game to request"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setNotice("");
          }}
        />
      </View>
      {error ? <Text style={[styles.error, { paddingHorizontal: 16 }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.dim, { paddingHorizontal: 16, color: colors.ok }]}>{notice}</Text> : null}

      {searchMode ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => String(h.igdbId)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            searching ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
            ) : (
              <Text style={styles.empty}>No matches. Try a shorter or different title.</Text>
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => setPicked(item)}>
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              ) : (
                <View style={styles.cover} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.h2} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.dim} numberOfLines={1}>
                  {hitSubtitle(item)}
                </Text>
              </View>
              <View style={[styles.chip, { marginRight: 0 }]}>
                <Text style={styles.chipText}>Request</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.dim} />}
          ListHeaderComponent={
            rows.length ? (
              <Text style={[styles.dim, { paddingHorizontal: 16, paddingBottom: 8 }]}>On the board</Text>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>Nothing requested yet — search above to add the first one.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={styles.cover} /> : <View style={styles.cover} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.h2} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.dim} numberOfLines={1}>
                  {[statusLabel(item.status), item.platform, item.requestedBy && `by ${item.requestedBy}`]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.chip, item.votedByMe && styles.chipOn, { marginRight: 0 }]}
                onPress={() => void vote(item)}
              >
                <Text style={[styles.chipText, item.votedByMe && styles.chipTextOn]}>{voteLabel(item)}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={picked !== null} transparent animationType="slide" onRequestClose={() => setPicked(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#000000aa" }}>
          <View style={{ backgroundColor: colors.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.h1} numberOfLines={2}>
                {picked?.name}
              </Text>
              <Text style={styles.dim}>{picked ? hitSubtitle(picked) : ""}</Text>
              {picked?.summary ? (
                <Text style={[styles.dim, { marginTop: 10 }]} numberOfLines={5}>
                  {picked.summary}
                </Text>
              ) : null}
              <TextInput
                style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
                placeholder="Anything to add? (optional)"
                placeholderTextColor={colors.dim}
                multiline
                maxLength={500}
                value={note}
                onChangeText={setNote}
              />
              <TouchableOpacity style={styles.button} disabled={submitting} onPress={() => void submit()}>
                {submitting ? (
                  <ActivityIndicator color="#0b0d12" />
                ) : (
                  <Text style={styles.buttonText}>Request this game</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={{ alignItems: "center", paddingVertical: 14 }} onPress={() => setPicked(null)}>
                <Text style={styles.dim}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
