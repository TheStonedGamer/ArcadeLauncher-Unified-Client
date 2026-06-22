// Social feature view: a connection-status bar, the friend roster on the left,
// and the active conversation on the right. State + actions come from useSocial;
// this component is composition only.

import { useMemo, useState } from "react";
import { useSocialContext } from "./SocialContext";
import { useProfile } from "./useProfile";
import { useFriendMeta } from "./useFriendMeta";
import { usePrivacy } from "./usePrivacy";
import { useActivity } from "./useActivity";
import { useVoice } from "./useVoice";
import { useGroupVoice } from "./useGroupVoice";
import { GroupCallBar } from "./components/GroupCallBar";
import { fetchTurnServers } from "./api";
import { FriendList } from "./components/FriendList";
import { ChatList } from "./components/ChatList";
import { sortFriendsBy, FRIEND_SORT_LABELS, type FriendSort } from "./selectors";
import { RequestsPanel } from "./components/RequestsPanel";
import { ActivityFeed } from "./components/ActivityFeed";
import { AddFriend } from "./components/AddFriend";
import { StatusPicker } from "./components/StatusPicker";
import { ChatPane } from "./components/ChatPane";
import { RoomsPanel } from "./components/RoomsPanel";
import { RoomChatPane } from "./components/RoomChatPane";
import { ProfilePanel } from "./components/ProfilePanel";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { CallBar } from "./components/CallBar";
import type { GatewayState } from "./gateway";
import { useSession } from "../session/SessionContext";

const STATE_LABEL: Record<GatewayState, string> = {
  disconnected: "Offline",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

export function SocialView() {
  const { session } = useSession();
  // Stabilise the auth object's identity: a fresh `{host, token}` literal each
  // render would make every auth-keyed hook (useActivity, useProfile, …) re-run
  // its fetch effect on every render — the Activity feed visibly flickered as it
  // refetched in a loop. Re-create it only when host/token actually change.
  const auth = useMemo(
    () => (session ? { host: session.host, token: session.token } : null),
    [session?.host, session?.token],
  );
  const social = useSocialContext();
  const profile = useProfile(auth, social.selfId);
  const friendMeta = useFriendMeta(auth);
  const privacy = usePrivacy(auth);
  const activity = useActivity(auth);
  const voice = useVoice(!!auth && social.connected, {
    voiceSend: social.voiceSend,
    setVoiceHandler: social.setVoiceHandler,
    iceProvider: auth
      ? async () => (await fetchTurnServers(auth.host, auth.token)).iceServers
      : undefined,
  });
  const groupVoice = useGroupVoice(social.selfId, !!auth && social.connected, {
    voiceSend: social.voiceSend,
    setGroupVoiceHandler: social.setGroupVoiceHandler,
    iceProvider: auth
      ? async () => (await fetchTurnServers(auth.host, auth.token)).iceServers
      : undefined,
  });
  const [rosterTab, setRosterTab] = useState<"chats" | "friends" | "requests" | "activity" | "rooms">(
    "chats",
  );
  const [friendSort, setFriendSort] = useState<FriendSort>("status");
  const sortedFriendList = useMemo(
    () => sortFriendsBy(social.friends, friendSort),
    [social.friends, friendSort],
  );
  const requestCount = social.incoming.length + social.outgoing.length;
  const peer = social.friends.find((f) => f.accountId === social.selectedPeer) ?? null;
  const activeRoom = social.rooms.find((r) => r.roomId === social.selectedRoom) ?? null;
  // The right pane shows a room when one is open, else the 1:1 DM. Selecting a
  // friend closes any open room and vice-versa so only one is active.
  const selectPeer = (id: number | null) => {
    social.selectRoom(null);
    social.select(id);
  };
  const selectRoom = (id: number) => {
    social.select(null);
    social.selectRoom(id);
  };
  const callPeerName =
    social.friends.find((f) => f.accountId === voice.call.peerId)?.username ?? "";

  return (
    <div className="social">
      <div className={`social__status social__status--${social.state}`}>
        <span className="social__status-dot" />
        <span>{STATE_LABEL[social.state]}</span>
        {!social.connected && !session && (
          <span className="social__status-note">— sign in to connect</span>
        )}
        {session && social.selfId > 0 && (
          <>
            <StatusPicker
              status={social.myStatus}
              statusText={social.myStatusText}
              connected={social.connected}
              onChange={social.setStatus}
            />
            <button className="social__profile-btn" onClick={() => profile.open(social.selfId)}>
              My profile
            </button>
            <button className="social__profile-btn" onClick={() => privacy.setOpen(true)}>
              Privacy
            </button>
          </>
        )}
      </div>

      <div className="social__layout">
        <aside className="social__roster">
          {auth && (
            <AddFriend
              auth={auth}
              friendIds={new Set(social.friends.map((f) => f.accountId))}
            />
          )}
          <div className="social__rostertabs">
            <button
              className={`social__rostertab${rosterTab === "chats" ? " social__rostertab--active" : ""}`}
              onClick={() => setRosterTab("chats")}
            >
              Chats
              {social.unreadTotal > 0 && <span className="social__rosterbadge">{social.unreadTotal}</span>}
            </button>
            <button
              className={`social__rostertab${rosterTab === "friends" ? " social__rostertab--active" : ""}`}
              onClick={() => setRosterTab("friends")}
            >
              Friends
            </button>
            <button
              className={`social__rostertab${rosterTab === "requests" ? " social__rostertab--active" : ""}`}
              onClick={() => setRosterTab("requests")}
            >
              Requests
              {requestCount > 0 && <span className="social__rosterbadge">{requestCount}</span>}
            </button>
            <button
              className={`social__rostertab${rosterTab === "rooms" ? " social__rostertab--active" : ""}`}
              onClick={() => setRosterTab("rooms")}
            >
              Rooms
              {social.rooms.length > 0 && <span className="social__rosterbadge">{social.rooms.length}</span>}
            </button>
            <button
              className={`social__rostertab${rosterTab === "activity" ? " social__rostertab--active" : ""}`}
              onClick={() => {
                setRosterTab("activity");
                activity.refresh();
              }}
            >
              Activity
            </button>
          </div>
          {rosterTab === "chats" && (
            <ChatList
              chats={social.chats}
              selfId={social.selfId}
              selectedPeer={social.selectedPeer}
              onSelect={selectPeer}
            />
          )}
          {rosterTab === "friends" && (
            <>
              <div className="social__sortbar">
                <label className="social__sortlabel" htmlFor="friend-sort">
                  Sort
                </label>
                <select
                  id="friend-sort"
                  className="social__sortselect"
                  value={friendSort}
                  onChange={(e) => setFriendSort(e.target.value as FriendSort)}
                >
                  {(Object.keys(FRIEND_SORT_LABELS) as FriendSort[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {FRIEND_SORT_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </div>
              <FriendList
                friends={sortedFriendList}
                selectedPeer={social.selectedPeer}
                onSelect={selectPeer}
                meta={auth ? friendMeta : undefined}
                ignore={auth ? { isIgnored: privacy.isIgnored, toggleIgnore: privacy.toggleIgnore } : undefined}
              />
            </>
          )}
          {rosterTab === "rooms" && (
            <RoomsPanel
              rooms={social.rooms}
              selectedRoom={social.selectedRoom}
              friends={social.friends}
              onSelect={selectRoom}
              onCreateRoom={social.createRoom}
            />
          )}
          {rosterTab === "requests" && (
            <RequestsPanel
              incoming={social.incoming}
              outgoing={social.outgoing}
              onRespond={social.respondToRequest}
            />
          )}
          {rosterTab === "activity" && <ActivityFeed activity={activity} />}
        </aside>
        <section className="social__chat">
          {activeRoom ? (
            <RoomChatPane
              room={activeRoom}
              messages={social.roomConversation}
              selfId={social.selfId}
              friends={social.friends}
              connected={social.connected}
              onSend={social.sendRoomMessage}
              onRename={social.renameRoom}
              onAddMember={social.addRoomMember}
              onLeave={social.leaveRoom}
              onStartCall={voice.enabled ? groupVoice.joinCall : undefined}
              callActive={groupVoice.inCall}
            />
          ) : (
            <ChatPane
            peer={peer}
            conversation={social.conversation}
            selfId={social.selfId}
            connected={social.connected}
            onSend={social.send}
            onTyping={social.notifyTyping}
            onEdit={social.editMessage}
            onDelete={social.deleteMessage}
            onReact={social.toggleReaction}
            onReply={social.setReplyTo}
            replyTo={social.replyTo}
            onCancelReply={() => social.setReplyTo(0)}
            onAttach={social.attachEnabled ? social.sendAttachment : undefined}
            onOpenAttachment={social.attachEnabled ? social.openAttachment : undefined}
            onViewProfile={auth ? profile.open : undefined}
            onCall={voice.enabled && peer ? () => voice.startCall(peer.accountId) : undefined}
            />
          )}
        </section>
      </div>

      <ProfilePanel panel={profile} />
      <PrivacyPanel privacy={privacy} />
      <CallBar voice={voice} peerName={callPeerName} />
      <GroupCallBar group={groupVoice} selfId={social.selfId} friends={social.friends} />
    </div>
  );
}
