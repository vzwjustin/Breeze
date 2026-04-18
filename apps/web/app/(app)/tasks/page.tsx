"use client";

import { useEffect, useState } from "react";
import type { Task } from "@breeze/common";

interface Execution {
  id: string;
  taskId: string;
  kind: "failed";
  errorMessage?: string;
  startedAt: string;
  originalPayload?: Record<string, unknown>;
}

interface TasksResponse {
  tasks: Task[];
  recentFailures?: Execution[];
}

export default function TasksPage() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/tasks?include=failures")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ tasks: [], recentFailures: [] }));
  }, []);

  const retry = async (exec: Execution) => {
    setRetrying((prev) => ({ ...prev, [exec.id]: true }));
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exec.originalPayload ?? {}),
      });
      setData((prev) =>
        prev
          ? { ...prev, recentFailures: prev.recentFailures?.filter((e) => e.id !== exec.id) }
          : prev,
      );
    } finally {
      setRetrying((prev) => ({ ...prev, [exec.id]: false }));
    }
  };

  const failures = data?.recentFailures ?? [];

  return (
    <section>
      <h1>Tasks</h1>
      <p>Recurring and scheduled work.</p>

      <h2 style={{ marginTop: 24 }}>Failed executions</h2>
      {data === null ? (
        <p>Loading…</p>
      ) : failures.length === 0 ? (
        <p>No failed executions.</p>
      ) : (
        <ul>
          {failures.map((exec) => (
            <li key={exec.id} style={{ marginBottom: 12 }}>
              <span>
                <strong>{exec.taskId}</strong>{" "}
                <span style={{ fontSize: 12, color: "#888" }}>
                  {new Date(exec.startedAt).toLocaleString()}
                </span>
              </span>
              {exec.errorMessage && (
                <p style={{ margin: "4px 0", color: "red", fontSize: 13 }}>{exec.errorMessage}</p>
              )}
              <button
                disabled={retrying[exec.id] ?? false}
                onClick={() => retry(exec)}
                style={{ opacity: retrying[exec.id] ? 0.5 : 1 }}
              >
                {retrying[exec.id] ? "Retrying…" : "Retry"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
