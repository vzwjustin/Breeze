"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Approval } from "@breeze/common";

interface Props {
  approval: Approval;
}

export function ApprovalActions({ approval }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "approve" | "deny") => {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; execution?: { ok: boolean; detail: string } };
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (action === "approve" && data.execution && !data.execution.ok) {
        setError(data.execution.detail);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const disabled = pending !== null;

  return (
    <div style={{ marginTop: 8 }}>
      {approval.preview.payloadDiff && (
        <details style={{ marginBottom: 8 }}>
          <summary>Preview</summary>
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
            {approval.preview.payloadDiff.before !== undefined && (
              <span style={{ color: "red" }}>- {approval.preview.payloadDiff.before}{"\n"}</span>
            )}
            <span style={{ color: "green" }}>+ {approval.preview.payloadDiff.after}</span>
          </pre>
        </details>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 8 }}>{error}</p>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note..."
        rows={2}
        disabled={disabled}
        style={{ display: "block", width: "100%", marginBottom: 8, resize: "vertical" }}
      />

      <button
        onClick={() => act("approve")}
        disabled={disabled}
        style={{ marginRight: 8, opacity: pending === "approve" ? 0.5 : 1 }}
      >
        {pending === "approve" ? "Approving…" : "Approve"}
      </button>

      <button
        onClick={() => act("deny")}
        disabled={disabled}
        style={{ opacity: pending === "deny" ? 0.5 : 1 }}
      >
        {pending === "deny" ? "Denying…" : "Deny"}
      </button>
    </div>
  );
}
