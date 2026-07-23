import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, RefreshControl, Text, TouchableOpacity, View } from "react-native";

import { ApiError, fetchRequests, voteRequest } from "../api";
import { applyVote, sortRequests, statusLabel, voteLabel, type MobileRequest } from "../core/requests";
import type { MobileSession } from "../core/session";
import { colors, styles } from "../theme";

export default function RequestsScreen({ session, onExpired }: { session: MobileSession; onExpired: () => void }) {
  const [rows, setRows] = useState<MobileRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError("");
    try {
      setRows(sortRequests((await fetchRequests(session)).requests));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onExpired();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load the request board");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.host, session.token]);

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

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {error ? <Text style={[styles.error, { paddingHorizontal: 16 }]}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.dim} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing on the request board yet.</Text>}
        ListFooterComponent={
          <Text style={[styles.dim, { padding: 16 }]}>
            New requests are filed from the desktop launcher, which has the game search. You can browse and upvote here.
          </Text>
        }
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
    </View>
  );
}
