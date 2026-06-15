// Social feature view: a connection-status bar, the friend roster on the left,
// and the active conversation on the right. State + actions come from useSocial;
// this component is composition only.

import { useSocial } from "./useSocial";
import { FriendList } from "./components/FriendList";
import { ChatPane } from "./components/ChatPane";
import type { GatewayState } from "./gateway";

const STATE_LABEL: Record<GatewayState, string> = {
  disconnected: "Offline",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

export function SocialView() {
  const social = useSocial();
  const peer = social.friends.find((f) => f.accountId === social.selectedPeer) ?? null;

  return (
    <div className="social">
      <div className={`social__status social__status--${social.state}`}>
        <span className="social__status-dot" />
        <span>{STATE_LABEL[social.state]}</span>
        {!social.connected && (
          <span className="social__status-note">— live gateway lands in T3b</span>
        )}
      </div>

      <div className="social__layout">
        <aside className="social__roster">
          <FriendList
            friends={social.friends}
            selectedPeer={social.selectedPeer}
            onSelect={social.select}
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
          />
        </section>
      </div>
    </div>
  );
}
