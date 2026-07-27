// Social feature, shaped like Steam: two floating windows rather than a tab.
// One holds the roster (status bar, Friends | Rooms | Activity), the other the
// open conversation; each drags independently and either can be closed alone.
// State + actions come from useSocial — this component is composition only.
//
// Chats and Requests used to be roster tabs of their own. Both now live inside
// the friends list — pending invites on top, unread DM counts on the friend
// rows — so clicking a person is the one way to open a conversation.
//
// AppShell owns whether the roster is open; it keeps this component mounted
// while a conversation is open so closing the friends list can't kill a chat.

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
import { loadSettings } from "../settings/api";
import { FriendList } from "./components/FriendList";
import { ChatList } from "./components/ChatList";
import { FloatingWindow } from "./components/FloatingWindow";
import { presenceLabel } from "./components/PresenceDot";
import {
  displayName,
  sortFriendsBy,
  unreadByPeer,
  orphanChats,
  FRIEND_SORT_LABELS,
  type FriendSort,
} from "./selectors";
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

// Steam's proportions: a narrow roster parked on the right, chats a bit wider
// and further left so the two don't sit on top of each other.
const ROSTER_SIZE = { w: 340, h: 620 };
const ROSTER_AT = { x: 900, y: 90 };
const CHAT_SIZE = { w: 640, h: 560 };
const CHAT_AT = { x: 220, y: 130 };

const STATE_LABEL: Record<GatewayState, string> = {
  disconnected: "Offline",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

interface Props {
  /** Whether the roster window is showing. A conversation window stays open on
   *  its own — closing the friends list doesn't hang up on anyone. */
  rosterOpen: boolean;
  onCloseRoster: () => void;
  /** Opens the game-requests board, which now hangs off Friends. */
  onOpenGameRequests?: () => void;
}

export function SocialView({
  rosterOpen,
  onCloseRoster,
  onOpenGameRequests,
}: Props) {
  const { session } = useSession();
  const [top, setTop] = useState<"roster" | "chat">("roster");
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
    // Read the mic settings at call time, not at mount: the user can change
    // them in Settings mid-session and the next call should honour that.
    micProvider: async () => (await loadSettings()).voiceAudio,
    iceProvider: auth
      ? async () => (await fetchTurnServers(auth.host, auth.token)).iceServers
      : undefined,
  });
  const groupVoice = useGroupVoice(social.selfId, !!auth && social.connected, {
    voiceSend: social.voiceSend,
    setGroupVoiceHandler: social.setGroupVoiceHandler,
    micProvider: async () => (await loadSettings()).voiceAudio,
    iceProvider: auth
      ? async () => (await fetchTurnServers(auth.host, auth.token)).iceServers
      : undefined,
  });
  // Steam-shaped roster: one Friends list is the home tab. Chats and Requests
  // are no longer tabs of their own — pending friend requests sit at the top of
  // the friends list, and a DM opens by clicking the person, with the unread
  // count riding on their row.
  const [rosterTab, setRosterTab] = useState<"friends" | "activity" | "rooms">(
    "friends",
  );
  const [friendSort, setFriendSort] = useState<FriendSort>("status");
  const sortedFriendList = useMemo(
    () => sortFriendsBy(social.friends, friendSort),
    [social.friends, friendSort],
  );
  const requestCount = social.incoming.length + social.outgoing.length;
  const unread = useMemo(() => unreadByPeer(social.chats), [social.chats]);
  // Threads with someone who isn't in the roster still need a way in now that
  // the Chats tab is gone.
  const strays = useMemo(
    () => orphanChats(social.chats, social.friends),
    [social.chats, social.friends],
  );
  const peer =
    social.friends.find((f) => f.accountId === social.selectedPeer) ?? null;
  const activeRoom =
    social.rooms.find((r) => r.roomId === social.selectedRoom) ?? null;
  // The conversation window shows a room when one is open, else the 1:1 DM.
  // Selecting a friend closes any open room and vice-versa, so exactly one
  // conversation is live — and either way that window comes to the front.
  const selectPeer = (id: number | null) => {
    social.selectRoom(null);
    social.select(id);
    setTop("chat");
  };
  const selectRoom = (id: number) => {
    social.select(null);
    social.selectRoom(id);
    setTop("chat");
  };
  const callPeerName =
    social.friends.find((f) => f.accountId === voice.call.peerId)?.username ??
    "";

  const conversationOpen = peer !== null || activeRoom !== null;
  const closeConversation = () => {
    social.select(null);
    social.selectRoom(null);
  };

  return (
    <>
      {rosterOpen && (
        <FloatingWindow
          title="Friends & Chat"
          subtitle={STATE_LABEL[social.state]}
          initial={ROSTER_AT}
          size={ROSTER_SIZE}
          z={top === "roster" ? 61 : 60}
          onFocus={() => setTop("roster")}
          onClose={onCloseRoster}
          className="floatwin--roster"
        >
          <div className="social">
            <div className={`social__status social__status--${social.state}`}>
              <span className="social__status-dot" />
              <span>{STATE_LABEL[social.state]}</span>
              {!social.connected && !session && (
                <span className="social__status-note">
                  — sign in to connect
                </span>
              )}
              {session && social.selfId > 0 && (
                <>
                  <StatusPicker
                    status={social.myStatus}
                    statusText={social.myStatusText}
                    connected={social.connected}
                    onChange={social.setStatus}
                  />
                  <button
                    className="social__profile-btn"
                    onClick={() => profile.open(social.selfId)}
                  >
                    My profile
                  </button>
                  <button
                    className="social__profile-btn"
                    onClick={() => privacy.setOpen(true)}
                  >
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
                {onOpenGameRequests && (
                  <button
                    className="social__gamereq"
                    onClick={onOpenGameRequests}
                  >
                    🎮 Game requests
                  </button>
                )}
                <div className="social__rostertabs">
                  <button
                    className={`social__rostertab${rosterTab === "friends" ? " social__rostertab--active" : ""}`}
                    onClick={() => setRosterTab("friends")}
                  >
                    Friends
                    {social.unreadTotal > 0 && (
                      <span className="social__rosterbadge">
                        {social.unreadTotal}
                      </span>
                    )}
                  </button>
                  <button
                    className={`social__rostertab${rosterTab === "rooms" ? " social__rostertab--active" : ""}`}
                    onClick={() => setRosterTab("rooms")}
                  >
                    Rooms
                    {social.rooms.length > 0 && (
                      <span className="social__rosterbadge">
                        {social.rooms.length}
                      </span>
                    )}
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
                {rosterTab === "friends" && (
                  <>
                    {requestCount > 0 && (
                      <div className="social__pending">
                        <div className="social__pending-heading">
                          Friend requests
                          <span className="social__rosterbadge">
                            {requestCount}
                          </span>
                        </div>
                        <RequestsPanel
                          incoming={social.incoming}
                          outgoing={social.outgoing}
                          onRespond={social.respondToRequest}
                        />
                      </div>
                    )}
                    <div className="social__sortbar">
                      <label
                        className="social__sortlabel"
                        htmlFor="friend-sort"
                      >
                        Sort
                      </label>
                      <select
                        id="friend-sort"
                        className="social__sortselect"
                        value={friendSort}
                        onChange={(e) =>
                          setFriendSort(e.target.value as FriendSort)
                        }
                      >
                        {(Object.keys(FRIEND_SORT_LABELS) as FriendSort[]).map(
                          (mode) => (
                            <option key={mode} value={mode}>
                              {FRIEND_SORT_LABELS[mode]}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <FriendList
                      friends={sortedFriendList}
                      selectedPeer={social.selectedPeer}
                      onSelect={selectPeer}
                      meta={auth ? friendMeta : undefined}
                      ignore={
                        auth
                          ? {
                              isIgnored: privacy.isIgnored,
                              toggleIgnore: privacy.toggleIgnore,
                            }
                          : undefined
                      }
                      unread={unread}
                      onCall={
                        voice.enabled ? (id) => voice.startCall(id) : undefined
                      }
                      onVideoCall={
                        voice.enabled
                          ? (id) => voice.startCall(id, true)
                          : undefined
                      }
                      callDisabledReason={
                        voice.enabled
                          ? undefined
                          : "Calling needs a connection to the social service"
                      }
                    />
                    {strays.length > 0 && (
                      <div className="social__strays">
                        <div className="social__pending-heading">
                          Other conversations
                        </div>
                        <ChatList
                          chats={strays}
                          selfId={social.selfId}
                          selectedPeer={social.selectedPeer}
                          onSelect={selectPeer}
                        />
                      </div>
                    )}
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
                {rosterTab === "activity" && (
                  <ActivityFeed activity={activity} />
                )}
              </aside>
            </div>
          </div>
        </FloatingWindow>
      )}

      {conversationOpen && (
        <FloatingWindow
          title={
            activeRoom
              ? activeRoom.name || "Group chat"
              : peer
                ? displayName(peer)
                : "Chat"
          }
          subtitle={
            activeRoom
              ? `${activeRoom.members.length} members`
              : peer
                ? peer.presence === "ingame" && peer.currentGameTitle
                  ? peer.currentGameTitle
                  : presenceLabel[peer.presence]
                : ""
          }
          initial={CHAT_AT}
          size={CHAT_SIZE}
          z={top === "chat" ? 61 : 60}
          onFocus={() => setTop("chat")}
          onClose={closeConversation}
          className="floatwin--chat"
        >
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
                onAttach={
                  social.attachEnabled ? social.sendAttachment : undefined
                }
                onOpenAttachment={
                  social.attachEnabled ? social.openAttachment : undefined
                }
                onViewProfile={auth ? profile.open : undefined}
                onCall={
                  voice.enabled && peer
                    ? () => voice.startCall(peer.accountId)
                    : undefined
                }
                onVideoCall={
                  voice.enabled && peer
                    ? () => voice.startCall(peer.accountId, true)
                    : undefined
                }
                callDisabledReason="Calling needs a connection to the social service"
              />
            )}
          </section>
        </FloatingWindow>
      )}

      <ProfilePanel panel={profile} />
      <PrivacyPanel privacy={privacy} />
      <CallBar voice={voice} peerName={callPeerName} />
      <GroupCallBar
        group={groupVoice}
        selfId={social.selfId}
        friends={social.friends}
      />
    </>
  );
}
