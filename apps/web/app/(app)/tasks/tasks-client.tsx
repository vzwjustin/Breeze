"use client";

import { useState } from "react";
import type { Task } from "@breeze/common";

interface Execution {
  id: string;
  taskId: string;
  status: string;
  errorMessage?: string;
  startedAt: string;
}

interface Props {
  tasks: Task[];
  recentFailures: Execution[];
}


const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: "var(--color-success-light, #f0fdf4)", text: "var(--color-success)" },
  paused: { bg: "var(--color-surface-muted)", text: "var(--color-text-muted)" },
  failed: { bg: "var(--color-error-light, #fef2f2)", text: "var(--color-error)" },
  archived: { bg: "var(--color-surface-muted)", text: "var(--color-text-faint)" },
};

function scheduleLabel(schedule: Task["schedule"]): string {
  if (schedule.kind === "cron") return `Cron: ${schedule.cron}`;
  if (schedule.kind === "once") return `Once: ${new Date(schedule.runAt).toLocaleDateString()}`;
  if (schedule.kind === "watch") return `Watching ${schedule.source.connector}/${schedule.source.resource}`;
  return "Unknown";
}

export function TasksClient({ tasks, recentFailures }: Props) {
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const retry = async (exec: Execution) => {
    setRetrying((prev) => ({ ...prev, [exec.id]: true }));
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: exec.taskId }),
      });
    } finally {
      setRetrying((prev) => ({ ...prev, [exec.id]: false }));
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
            Tasks
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            Scheduled and recurring work that Breeze runs on your behalf.
          </p>
        </div>
      </div>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginBottom: 12,
        }}>
          All tasks {tasks.length > 0 && `(${tasks.length})`}
        </h2>

        {tasks.length === 0 ? (
          <div style={{
            padding: "40px 24px",
            textAlign: "center",
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--color-border)",
            color: "var(--color-text-muted)",
            fontSize: 14,
          }}>
            No tasks yet. Create one from a chat by asking Breeze to schedule something.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map((task) => {
              const statusStyle = STATUS_COLORS[task.status] ?? STATUS_COLORS.active!;
              return (
                <div
                  key={task.id}
                  style={{
                    padding: "16px 20px",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
                        {task.name}
                      </span>
                      {task.description && (
                        <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 2 }}>
                          {task.description}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "3px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: statusStyle.bg,
                      color: statusStyle.text,
                      flexShrink: 0,
                    }}>
                      {task.status}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-faint)", display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="4" rx="2"/>
                        <line x1="16" x2="16" y1="2" y2="6"/>
                        <line x1="8" x2="8" y1="2" y2="6"/>
                        <line x1="3" x2="21" y1="10" y2="10"/>
                      </svg>
                      {scheduleLabel(task.schedule)}
                    </span>
                    {task.lastRunAt && (
                      <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                        Last run {new Date(task.lastRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                    {task.nextRunAt && (
                      <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                        Next {new Date(task.nextRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {recentFailures.length > 0 && (
        <section>
          <h2 style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
            marginBottom: 12,
          }}>
            Recent failures
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentFailures.map((exec) => (
              <div
                key={exec.id}
                style={{
                  padding: "14px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-error-light, #fecaca)",
                  background: "var(--color-error-light, #fef2f2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                      {exec.taskId}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-text-faint)", marginLeft: 8 }}>
                      {new Date(exec.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {exec.errorMessage && (
                      <div style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4 }}>
                        {exec.errorMessage}
                      </div>
                    )}
                  </div>
                  <button
                    disabled={retrying[exec.id] ?? false}
                    onClick={() => retry(exec)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      cursor: retrying[exec.id] ? "not-allowed" : "pointer",
                      opacity: retrying[exec.id] ? 0.5 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {retrying[exec.id] ? "Retrying…" : "Retry"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
