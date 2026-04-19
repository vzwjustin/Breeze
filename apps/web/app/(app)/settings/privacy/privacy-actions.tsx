"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  action: "clear-memory" | "clear-chats";
  label: string;
  destructive?: boolean;
}

export function PrivacyActions({ action, label, destructive }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const execute = async () => {
    setLoading(true);
    try {
      await fetch(`/api/me/${action}`, { method: "POST" });
      setConfirming(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Are you sure?</span>
        <button
          onClick={execute}
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: "var(--radius-md)",
            border: "none",
            background: "var(--color-error)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Deleting..." : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: "7px 14px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${destructive ? "var(--color-error-muted, #fca5a5)" : "var(--color-border)"}`,
        background: "transparent",
        color: destructive ? "var(--color-error)" : "var(--color-text)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
