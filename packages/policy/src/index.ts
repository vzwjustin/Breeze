/**
 * Policy engine. PURE FUNCTION. No IO. No side effects.
 *
 * evaluate(input) -> decision
 *
 * Evaluation order (see BLUEPRINT §12):
 *   1. explicit deny rule (any match wins)
 *   2. first matching allow / require_approval rule in profile order
 *   3. bulk safety for mutating actions over BULK_SAFETY_THRESHOLD
 *   4. read-only short-circuit
 *   5. default to require_approval (conservative)
 */
import type {
  PolicyDecision,
  PolicyInput,
  PolicyProfile,
  PolicyRule,
  RiskLevel,
} from "@breeze/common";

export const BULK_SAFETY_THRESHOLD = 10;

export { BUILTIN_PROFILES, getBuiltinProfile } from "./profiles.js";

const riskRank: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function evaluate(input: PolicyInput): PolicyDecision {
  const { profile, connector, capability, capabilityMeta, context } = input;

  for (const rule of matchingRules(profile, input)) {
    if (rule.decision === "deny") {
      return { decision: "deny", reason: rule.reason, rule: rule.id };
    }
  }

  for (const rule of matchingRules(profile, input)) {
    if (rule.decision === "require_approval") {
      return { decision: "require_approval", reason: rule.reason, rule: rule.id };
    }
    if (rule.decision === "allow" && !triggersBulkSafety(input)) {
      return { decision: "allow", reason: rule.reason, rule: rule.id };
    }
  }

  if (triggersBulkSafety(input)) {
    return {
      decision: "require_approval",
      reason: "Bulk mutation safety: large target set requires confirmation.",
      rule: "system.bulk_safety",
      approvalTemplate: "bulk",
    };
  }

  if (!capabilityMeta.mutatesState) {
    return {
      decision: "allow",
      reason: "Read-only capability.",
      rule: "system.read_only",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _noted = { connector, capability, originatingKind: context.originatingKind };
  return {
    decision: "require_approval",
    reason: "Default conservative: mutation requires explicit approval.",
    rule: "system.default",
  };
}

function matchingRules(profile: PolicyProfile, input: PolicyInput): PolicyRule[] {
  return profile.rules.filter((rule) => ruleMatches(rule, input));
}

function ruleMatches(rule: PolicyRule, input: PolicyInput): boolean {
  if (rule.connector && rule.connector !== "*" && rule.connector !== input.connector) {
    return false;
  }
  if (rule.capability && rule.capability !== "*") {
    if (rule.capability.endsWith(".*")) {
      const prefix = rule.capability.slice(0, -2);
      if (!input.capability.startsWith(prefix + ".")) return false;
    } else if (rule.capability !== input.capability) {
      return false;
    }
  }
  if (rule.when?.mutatesState !== undefined && rule.when.mutatesState !== input.capabilityMeta.mutatesState) {
    return false;
  }
  if (rule.when?.sensitivityAtLeast) {
    if (riskRank[input.capabilityMeta.sensitivity] < riskRank[rule.when.sensitivityAtLeast]) {
      return false;
    }
  }
  if (rule.when?.bulkOver !== undefined) {
    if ((input.context.targetCount ?? 0) <= rule.when.bulkOver) return false;
  }
  return true;
}

function triggersBulkSafety(input: PolicyInput): boolean {
  if (!input.capabilityMeta.mutatesState) return false;
  const count = input.context.targetCount ?? 0;
  return count > BULK_SAFETY_THRESHOLD;
}
