/**
 * Built-in policy profiles. See BLUEPRINT §12.
 *
 * These are seed values; users can clone & customize via Settings.
 */
import type { PolicyProfile } from "@breeze/common";

export const READ_ONLY: PolicyProfile = {
  id: "builtin.read_only",
  name: "Read Only",
  kind: "builtin",
  rules: [
    { id: "read_only.allow_reads", decision: "allow", reason: "Read access", when: { mutatesState: false } },
    { id: "read_only.deny_mutations", decision: "deny", reason: "Read Only profile forbids mutations", when: { mutatesState: true } },
  ],
};

export const ASK_BEFORE_SENDING: PolicyProfile = {
  id: "builtin.ask_before_sending",
  name: "Ask Before Sending",
  kind: "builtin",
  rules: [
    { id: "abs.allow_reads", decision: "allow", reason: "Read access", when: { mutatesState: false } },
    { id: "abs.allow_drafts", decision: "allow", capability: "*.draft_*", reason: "Drafts are safe" },
    { id: "abs.allow_archive", decision: "allow", capability: "gmail.archive_thread", reason: "Archive is reversible" },
    { id: "abs.allow_label", decision: "allow", capability: "gmail.label_thread", reason: "Labeling is safe" },
    { id: "abs.require_send", decision: "require_approval", capability: "gmail.send_reply", reason: "Outbound email needs review" },
    { id: "abs.require_post", decision: "require_approval", capability: "github.post_comment", reason: "Public comments need review" },
    { id: "abs.require_calendar_write", decision: "require_approval", capability: "gcal.*", when: { mutatesState: true }, reason: "Calendar changes need review" },
    { id: "abs.deny_delete", decision: "require_approval", capability: "*.delete_*", reason: "Deletes always need review" },
  ],
};

export const ASK_BEFORE_MUTATING: PolicyProfile = {
  id: "builtin.ask_before_mutating",
  name: "Ask Before Mutating",
  kind: "builtin",
  rules: [
    { id: "abm.allow_reads", decision: "allow", reason: "Read access", when: { mutatesState: false } },
    { id: "abm.require_mutations", decision: "require_approval", reason: "All mutations need approval", when: { mutatesState: true } },
  ],
};

export const AUTO_RUN_SAFE_ACTIONS: PolicyProfile = {
  id: "builtin.auto_run_safe_actions",
  name: "Auto-run Safe Actions",
  kind: "builtin",
  rules: [
    { id: "auto.allow_reads", decision: "allow", reason: "Read access", when: { mutatesState: false } },
    { id: "auto.allow_drafts", decision: "allow", capability: "*.draft_*", reason: "Drafts are safe" },
    { id: "auto.require_high", decision: "require_approval", when: { sensitivityAtLeast: "high" }, reason: "High-risk mutation needs review" },
    { id: "auto.allow_low_mut", decision: "allow", when: { mutatesState: true, sensitivityAtLeast: "low" }, reason: "Low-risk mutation auto-run" },
  ],
};

export const POWER_USER: PolicyProfile = {
  id: "builtin.power_user",
  name: "Power User",
  kind: "builtin",
  rules: [
    { id: "pu.require_critical", decision: "require_approval", when: { sensitivityAtLeast: "critical" }, reason: "Critical actions still need confirmation" },
    { id: "pu.allow_most", decision: "allow", reason: "Trusted profile" },
  ],
};

export const PARANOID: PolicyProfile = {
  id: "builtin.paranoid",
  name: "Paranoid",
  kind: "builtin",
  rules: [
    { id: "pa.allow_safe_reads", decision: "allow", when: { mutatesState: false }, reason: "Read-only safe actions" },
    { id: "pa.require_everything", decision: "require_approval", reason: "Paranoid: confirm all non-trivial actions" },
  ],
};

export const BUILTIN_PROFILES: PolicyProfile[] = [
  READ_ONLY,
  ASK_BEFORE_SENDING,
  ASK_BEFORE_MUTATING,
  AUTO_RUN_SAFE_ACTIONS,
  POWER_USER,
  PARANOID,
];

export function getBuiltinProfile(id: string): PolicyProfile | undefined {
  return BUILTIN_PROFILES.find((p) => p.id === id);
}

export const DEFAULT_PROFILE_ID = AUTO_RUN_SAFE_ACTIONS.id;
