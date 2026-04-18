/**
 * Breeze design system.
 *
 * In production this package wraps shadcn/ui primitives (Button, Dialog,
 * Dropdown, Sidebar, Command, Sheet, Tooltip, Tabs, Toast) with the
 * Breeze design tokens and Framer Motion presets.
 *
 * For the blueprint scaffold we only declare the surface; shadcn is
 * added via `pnpm dlx shadcn@latest init` in apps/web during Phase 0.
 */
export const tokens = {
  color: {
    accent: "var(--breeze-accent, #4F7CFF)",
    surface: "var(--breeze-surface, #ffffff)",
    surfaceMuted: "var(--breeze-surface-muted, #F6F7F9)",
    border: "var(--breeze-border, #E5E7EB)",
    text: "var(--breeze-text, #0F172A)",
    textMuted: "var(--breeze-text-muted, #64748B)",
    danger: "var(--breeze-danger, #EF4444)",
    success: "var(--breeze-success, #16A34A)",
  },
  radius: { sm: "6px", md: "10px", lg: "14px" },
  motion: { fast: "150ms", base: "200ms" },
} as const;

export type Tokens = typeof tokens;
