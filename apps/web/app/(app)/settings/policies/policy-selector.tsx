"use client";

import { useState } from "react";
import type { PolicyProfile } from "@breeze/common";

const PROFILE_DESCRIPTIONS: Record<string, { tagline: string; examples: string[] }> = {
  "builtin.read_only": {
    tagline: "Read only. No writes whatsoever.",
    examples: ["Browsing email", "Reviewing calendars", "Reading files"],
  },
  "builtin.ask_before_sending": {
    tagline: "Auto-run safe actions; approve sends and posts.",
    examples: ["Auto-archive email", "Approve before sending replies", "Approve before posting comments"],
  },
  "builtin.ask_before_mutating": {
    tagline: "Approve every write action.",
    examples: ["Auto read-only", "Approve all edits", "Approve all sends"],
  },
  "builtin.auto_run_safe_actions": {
    tagline: "Auto-run low-risk actions; approve high-risk ones.",
    examples: ["Auto-label threads", "Auto-draft replies", "Approve before sending"],
  },
  "builtin.power_user": {
    tagline: "Auto-run most actions; only pause for critical ones.",
    examples: ["Auto-send replies", "Auto-create events", "Approve before deletes"],
  },
  "builtin.paranoid": {
    tagline: "Approve everything except pure reads.",
    examples: ["Everything needs review", "Only reads are automatic"],
  },
};

interface Props {
  profiles: PolicyProfile[];
  currentProfileId: string;
}

export function PolicyProfileSelector({ profiles, currentProfileId }: Props) {
  const [selected, setSelected] = useState(currentProfileId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/me/policy-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyProfileId: selected }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {profiles.map((p) => {
          const isSelected = selected === p.id;
          const meta = PROFILE_DESCRIPTIONS[p.id];
          return (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "16px 18px",
                borderRadius: "var(--radius-lg)",
                border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                background: isSelected ? "var(--color-primary-light)" : "var(--color-surface)",
                textAlign: "left",
                cursor: "pointer",
                width: "100%",
              }}
            >
              <div style={{
                width: 18,
                height: 18,
                borderRadius: "var(--radius-full)",
                border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                background: isSelected ? "var(--color-primary)" : "transparent",
                flexShrink: 0,
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {isSelected && (
                  <div style={{ width: 7, height: 7, borderRadius: "var(--radius-full)", background: "white" }} />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>{p.name}</span>
                  {p.id === "builtin.auto_run_safe_actions" && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-primary)",
                      background: "var(--color-primary-light)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}>
                      Default
                    </span>
                  )}
                </div>
                {meta && (
                  <>
                    <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 6 }}>{meta.tagline}</div>
                    <ul style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                      {meta.examples.map((ex) => (
                        <li key={ex} style={{ fontSize: 12, color: "var(--color-text-faint)", display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "var(--radius-full)", background: "var(--color-text-faint)", display: "inline-block" }} />
                          {ex}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={save}
        disabled={saving || selected === currentProfileId}
        style={{
          padding: "10px 20px",
          borderRadius: "var(--radius-md)",
          border: "none",
          background: saved ? "var(--color-success)" : "var(--color-primary)",
          color: "white",
          fontSize: 14,
          fontWeight: 600,
          cursor: (saving || selected === currentProfileId) ? "default" : "pointer",
          opacity: (saving || selected === currentProfileId) ? 0.5 : 1,
        }}
      >
        {saved ? "Saved" : saving ? "Saving..." : "Apply profile"}
      </button>
    </>
  );
}
