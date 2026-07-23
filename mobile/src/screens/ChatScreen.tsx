// Friends and chat. Two views in one screen: the conversation list, and one
// conversation.
//
// Sending is deliberately not optimistic. The server echoes every message back
// with its assigned id, and that echo is what `applyFrame` files into the
// thread — so a message the server never accepted never appears, instead of
// appearing and then quietly needing to be taken away again.

import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { ApiError, uploadAttachment } from "../api";
import { conversationOrder, isOnline, type Message, type RosterState } from "../core/roster";
import type { MobileSession } from "../core/session";
import { outbound } from "../core/social";
import { colors, styles } from "../theme";

export default function ChatScreen({
  session,
  roster,
  online,
  send,
  friends,
  onCall,
}: {
  session: MobileSession;
  roster: RosterState;
  online: boolean;
  send: (frame: string) => boolean;
  /** userId -> display name, from the friends list. Ids with no name fall back
   *  to the id itself so a conversation is never unreachable. */
  friends: Record<number, string>;
  onCall: (peerId: number) => void;
}) {
  const [peer, setPeer] = useState<number | null>(null);

  const nameOf = (id: number) => friends[id] || `User ${id}`;

  if (peer === null) {
    return <ConversationList roster={roster} friends={friends} nameOf={nameOf} onOpen={setPeer} />;
  }
  return (
    <Conversation
      session={session}
      peer={peer}
      name={nameOf(peer)}
      messages={roster.conversations[peer] ?? []}
      online={online}
      send={send}
      onBack={() => setPeer(null)}
      onCall={() => onCall(peer)}
    />
  );
}

function ConversationList({
  roster,
  friends,
  nameOf,
  onOpen,
}: {
  roster: RosterState;
  friends: Record<number, string>;
  nameOf: (id: number) => string;
  onOpen: (id: number) => void;
}) {
  // Everyone with history, then any remaining friend, so a first message can be
  // started without hunting for a separate "new chat" button.
  const rows = useMemo(() => {
    const withHistory = conversationOrder(roster);
    const rest = Object.keys(friends)
      .map(Number)
      .filter((id) => !withHistory.includes(id))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return [...withHistory, ...rest];
  }, [roster, friends, nameOf]);

  return (
    <FlatList
      style={styles.screen}
      data={rows}
      keyExtractor={(id) => String(id)}
      ListEmptyComponent={<Text style={styles.empty}>No friends yet. Add them from the desktop launcher.</Text>}
      renderItem={({ item }) => {
        const thread = roster.conversations[item] ?? [];
        const last = thread[thread.length - 1];
        return (
          <TouchableOpacity style={styles.row} onPress={() => onOpen(item)}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: isOnline(roster, item) ? colors.ok : colors.border,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.h2} numberOfLines={1}>
                {nameOf(item)}
              </Text>
              <Text style={styles.dim} numberOfLines={1}>
                {last ? preview(last) : roster.playing[item] || "Tap to start a conversation"}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

function preview(m: Message): string {
  const body = m.text || (m.attachmentId > 0 ? "Attachment" : "");
  return m.mine ? `You: ${body}` : body;
}

function Conversation({
  session,
  peer,
  name,
  messages,
  online,
  send,
  onBack,
  onCall,
}: {
  session: MobileSession;
  peer: number;
  name: string;
  messages: Message[];
  online: boolean;
  send: (frame: string) => boolean;
  onBack: () => void;
  onCall: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState("");
  const list = useRef<FlatList<Message>>(null);

  // Photos only, from the phone's own library. A general file picker is a much
  // wider door on a device where most of what is pickable is not something
  // anyone means to put in a chat.
  const attach = async () => {
    setAttachError("");
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setUploading(true);
    try {
      const id = await uploadAttachment(session, {
        uri: asset.uri,
        name: asset.fileName || `photo-${asset.assetId ?? "1"}.jpg`,
        size: asset.fileSize ?? 0,
      });
      // The caption rides along with the attachment rather than being sent as a
      // second message, so the two cannot arrive out of order.
      if (send(outbound.chat(peer, draft.trim(), 0, id))) setDraft("");
      else setAttachError("Sent nothing — you are offline.");
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : "Could not send that photo.");
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    // Only clear the box once the frame is actually on the socket, so an
    // offline tap does not silently eat what was typed.
    if (send(outbound.chat(peer, text))) setDraft("");
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.row, { paddingVertical: 12 }]}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.accent, fontSize: 15 }}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.h2, { flex: 1 }]} numberOfLines={1}>
          {name}
        </Text>
        <TouchableOpacity onPress={onCall} disabled={!online}>
          <Text style={{ color: online ? colors.accent : colors.dim, fontSize: 15 }}>Call</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m, i) => (m.id > 0 ? String(m.id) : `local-${i}`)}
        contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.mine ? "flex-end" : "flex-start",
              backgroundColor: item.mine ? colors.accent : colors.panel,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginVertical: 3,
              maxWidth: "80%",
            }}
          >
            {item.attachmentId > 0 && (
              <Text style={{ color: item.mine ? "#0b0d12" : colors.dim, fontSize: 13, marginBottom: 2 }}>
                Attachment
              </Text>
            )}
            {item.text ? (
              <Text style={{ color: item.mine ? "#0b0d12" : colors.text, fontSize: 15 }}>{item.text}</Text>
            ) : null}
          </View>
        )}
      />

      {attachError ? <Text style={[styles.error, { paddingHorizontal: 12 }]}>{attachError}</Text> : null}

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12 }}>
        <TouchableOpacity
          onPress={() => void attach()}
          disabled={!online || uploading}
          style={{ paddingVertical: 12, paddingHorizontal: 4, opacity: online && !uploading ? 1 : 0.4 }}
        >
          {uploading ? (
            <ActivityIndicator color={colors.dim} size="small" />
          ) : (
            <Text style={{ color: colors.accent, fontSize: 22 }}>+</Text>
          )}
        </TouchableOpacity>
        <TextInput
          style={[styles.input, { flex: 1, marginTop: 0 }]}
          placeholder={online ? "Message" : "Offline"}
          placeholderTextColor={colors.dim}
          editable={online}
          multiline
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (t) send(outbound.typing(peer));
          }}
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={[styles.button, { marginTop: 0, paddingHorizontal: 18, opacity: online && draft.trim() ? 1 : 0.4 }]}
          onPress={submit}
          disabled={!online || !draft.trim()}
        >
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
