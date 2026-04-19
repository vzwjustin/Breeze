"use client";

import { useState, useEffect } from "react";

const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models — strong at reasoning, coding, and long context.",
    models: ["claude-sonnet-4-6", "claude-opus-4", "claude-haiku-3-5"],
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models — broad capability, widely supported.",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini models — large context windows, multimodal.",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    envKey: "GOOGLE_API_KEY",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Route across many models via a single API key.",
    models: ["anthropic/claude-sonnet-4-6", "openai/gpt-4o", "google/gemini-pro"],
    envKey: "OPENROUTER_API_KEY",
  },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

interface Prefs {
  aiProvider?: ProviderId;
  plannerModel?: string;
}

export default function ModelsPage() {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me/preferences")
      .then((r) => r.json())
      .then((d) => setPrefs((d.preferences as Prefs) ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedProvider = PROVIDERS.find((p) => p.id === prefs.aiProvider) ?? PROVIDERS[0]!;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ color: "var(--color-text-muted)", fontSize: 14 }}>Loading preferences...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Model & Provider
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        Choose the AI provider and model used for your conversations and planning.
      </p>

      <div style={{ marginBottom: 32 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 12 }}>
          AI Provider
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PROVIDERS.map((p) => {
            const selected = prefs.aiProvider === p.id || (!prefs.aiProvider && p === PROVIDERS[0]);
            return (
              <button
                key={p.id}
                onClick={() => setPrefs((prev) => ({ ...prev, aiProvider: p.id, plannerModel: p.models[0] }))}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: "var(--radius-md)",
                  border: `2px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: selected ? "var(--color-primary-light)" : "var(--color-surface)",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: "var(--radius-full)",
                  border: `2px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: selected ? "var(--color-primary)" : "transparent",
                  flexShrink: 0,
                  marginTop: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {selected && (
                    <div style={{ width: 7, height: 7, borderRadius: "var(--radius-full)", background: "white" }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{p.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>
          Model
        </label>
        <select
          value={prefs.plannerModel ?? selectedProvider.models[0]}
          onChange={(e) => setPrefs((prev) => ({ ...prev, plannerModel: e.target.value }))}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: 14,
            outline: "none",
          }}
        >
          {selectedProvider.models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          padding: "10px 20px",
          borderRadius: "var(--radius-md)",
          border: "none",
          background: saved ? "var(--color-success)" : "var(--color-primary)",
          color: "white",
          fontSize: 14,
          fontWeight: 600,
          cursor: saving ? "wait" : "pointer",
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saved ? "Saved" : saving ? "Saving..." : "Save changes"}
      </button>
    </div>
  );
}
