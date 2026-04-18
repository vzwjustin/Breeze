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

  const act = async (action: "approve" | "deny") => {
    setPending(action);
    try {
      await fetch(`/api/approvals/${approval.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
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
