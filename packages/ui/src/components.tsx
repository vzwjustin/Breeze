"use client";

import type { CSSProperties, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { tokens } from "./index.js";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="breeze-page-header" style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.02em", marginBottom: description ? 6 : 0 }}>
            {title}
          </h1>
          {description && (
            <p style={{ color: "var(--color-text-muted)", fontSize: 14, maxWidth: 520 }}>{description}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Card({
  children,
  style,
  padding = 20,
}: {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
}) {
  return (
    <div
      style={{
        padding,
        borderRadius: tokens.radius.lg,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const badgeColors: Record<string, { bg: string; text: string }> = {
  default: { bg: "var(--color-surface-muted)", text: "var(--color-text-muted)" },
  success: { bg: "var(--color-success-light)", text: "var(--color-success)" },
  warning: { bg: "var(--color-warning-light)", text: "var(--color-warning)" },
  error: { bg: "var(--color-error-light)", text: "var(--color-error)" },
  primary: { bg: "var(--color-primary-light)", text: "var(--color-primary)" },
};

export function Badge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: keyof typeof badgeColors;
}) {
  const c = badgeColors[variant] ?? badgeColors.default!;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: tokens.radius.sm,
        background: c.bg,
        color: c.text,
      }}
    >
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  children,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: { background: "var(--color-primary)", color: "white", border: "none" },
    secondary: { background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" },
    ghost: { background: "transparent", color: "var(--color-text-muted)", border: "1px solid transparent" },
    danger: { background: "var(--color-error)", color: "white", border: "none" },
  };
  const sizes = { sm: { padding: "6px 12px", fontSize: 12 }, md: { padding: "9px 16px", fontSize: 14 } };
  return (
    <button
      type="button"
      {...props}
      style={{
        borderRadius: tokens.radius.md,
        fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        transition: "opacity var(--transition-fast), background var(--transition-fast)",
        ...variants[variant],
        ...sizes[size],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: tokens.radius.md,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        fontSize: 14,
        outline: "none",
        ...props.style,
      }}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: tokens.radius.md,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        fontSize: 14,
        lineHeight: 1.5,
        resize: "vertical",
        outline: "none",
        ...props.style,
      }}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        borderRadius: tokens.radius.lg,
        border: "1px dashed var(--color-border)",
        background: "var(--color-surface-muted)",
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>{title}</p>
      {description && <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 16 }}>{description}</p>}
      {action}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
        marginBottom: 12,
      }}
    >
      {children}
    </h2>
  );
}
