// Social feature view: a connection-status bar, the friend roster on the left,
// and the active conversation on the right. State + actions come from useSocial;
// this component is composition only.

import { useSocial } from "./useSocial";
import { useProfile } from "./useProfile";
import { useFriendMeta } from "./useFriendMeta";
import { usePrivacy } from "./usePrivacy";
import { useVoice } from "./useVoice";
import { fetchTurnServers } from "./api";
import { FriendList } from "./components/FriendList";
import { AddFriend } from "./components/AddFriend";
import { StatusPicker } from "./components/StatusPicker";
import { ChatPane } from "./components/ChatPane";
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
  const auth = session ? { host: session.host, token: session.token } : null;
  const social = useSocial(auth);
  const profile = useProfile(auth, social.selfId);
  const friendMeta = useFriendMeta(auth);
  const privacy = usePrivacy(auth);
  const voice = useVoice(!!auth && social.connected, {
    voiceSend: social.voiceSend,
    setVoiceHandler: social.setVoiceHandler,
    iceProvider: auth
      ? async () => (await fetchTurnServers(auth.host, auth.token)).iceServers
      : undefined,
  });
  const peer = social.friends.find((f) => f.accountId === social.selectedPeer) ?? null;
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
          <FriendList
            friends={social.friends}
            selectedPeer={social.selectedPeer}
            onSelect={social.select}
            meta={auth ? friendMeta : undefined}
            ignore={auth ? { isIgnored: privacy.isIgnored, toggleIgnore: privacy.toggleIgnore } : undefined}
          />
        </aside>
        <section className="social__chat">
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
        </section>
      </div>

      <ProfilePanel panel={profile} />
      <PrivacyPanel privacy={privacy} />
      <CallBar voice={voice} peerName={callPeerName} />
    </div>
  );
}
