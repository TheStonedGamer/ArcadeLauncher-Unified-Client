// Pure privacy-policy option model (ROADMAP T9f / 1.1b). The server stores two
// enums per user: a friend-request policy (everyone|mutual|nobody) and a DM
// policy (everyone|friends|nobody). These helpers describe the selectable
// options + human labels for the settings UI; IO-free → unit-tested in
// privacy.test.ts. The IPC lives in api.ts and the React glue in usePrivacy.

export type FriendPolicy = "everyone" | "mutual" | "nobody";
export type DmPolicy = "everyone" | "friends" | "nobody";

export interface Privacy {
  friendPolicy: FriendPolicy;
  dmPolicy: DmPolicy;
}

export interface PolicyOption<T> {
  value: T;
  label: string;
  hint: string;
}

export const FRIEND_POLICY_OPTIONS: PolicyOption<FriendPolicy>[] = [
  { value: "everyone", label: "Everyone", hint: "Anyone can send a request" },
  { value: "mutual", label: "Mutual friends", hint: "Only people who share a friend" },
  { value: "nobody", label: "No one", hint: "Block all incoming requests" },
];

export const DM_POLICY_OPTIONS: PolicyOption<DmPolicy>[] = [
  { value: "everyone", label: "Everyone", hint: "Anyone can message you" },
  { value: "friends", label: "Friends only", hint: "Only accepted friends" },
  { value: "nobody", label: "No one", hint: "Silence all DMs" },
];

/** Default policies used before the server value loads. */
export const DEFAULT_PRIVACY: Privacy = { friendPolicy: "everyone", dmPolicy: "everyone" };

/** Coerce an arbitrary server token to a known FriendPolicy (fallback everyone). */
export function friendPolicyFromWire(s: string): FriendPolicy {
  return s === "mutual" || s === "nobody" ? s : "everyone";
}

/** Coerce an arbitrary server token to a known DmPolicy (fallback everyone). */
export function dmPolicyFromWire(s: string): DmPolicy {
  return s === "friends" || s === "nobody" ? s : "everyone";
}

/** Label for a friend-policy value (falls back to the raw token). */
export function friendPolicyLabel(value: string): string {
  return FRIEND_POLICY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Label for a DM-policy value (falls back to the raw token). */
export function dmPolicyLabel(value: string): string {
  return DM_POLICY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
