/**
 * Minimal Mustache-style templating for Recipe action inputs.
 * Supports `{{path.to.value}}` referenced against a scope object.
 *
 * Rules:
 *  - String values: whole-string placeholders (`{{x}}`) return the raw
 *    typed value; partial placeholders are concatenated as strings.
 *  - Arrays / objects: recursed into.
 *  - Missing paths render as empty string (whole-string placeholders
 *    render as undefined so callers can prune if desired).
 */
export type TemplateScope = Record<string, unknown>;

const WHOLE_RE = /^\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}$/;
const PART_RE = /\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g;
const ANY_PLACEHOLDER_RE = /\{\{\s*[a-zA-Z0-9_.$-]+\s*\}\}/;
const PATH_CAPTURE_RE = /\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g;

function lookup(scope: TemplateScope, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur && typeof cur === "object" && Object.hasOwn(cur as object, p)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** JSON.stringify that survives circular references (uses `[Circular]`). */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  });
}

function renderString(template: string, scope: TemplateScope): unknown {
  const whole = template.match(WHOLE_RE);
  if (whole) return lookup(scope, whole[1]!);
  return template.replace(PART_RE, (_, path: string) => {
    const v = lookup(scope, path);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? safeStringify(v) : String(v);
  });
}

export function renderTemplate<T>(template: T, scope: TemplateScope): T {
  if (typeof template === "string") {
    return renderString(template, scope) as T;
  }
  if (Array.isArray(template)) {
    return template.map((v) => renderTemplate(v, scope)) as unknown as T;
  }
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template as Record<string, unknown>)) {
      out[k] = renderTemplate(v, scope);
    }
    return out as unknown as T;
  }
  return template;
}

/** True when the value contains at least one `{{path}}` placeholder. */
export function hasTemplateVariables(template: unknown): boolean {
  if (typeof template === "string") return ANY_PLACEHOLDER_RE.test(template);
  if (Array.isArray(template)) return template.some(hasTemplateVariables);
  if (template && typeof template === "object") {
    return Object.values(template as Record<string, unknown>).some(hasTemplateVariables);
  }
  return false;
}

/** Collect unique dot-paths referenced in a template tree. */
export function extractTemplatePaths(template: unknown): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      PATH_CAPTURE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PATH_CAPTURE_RE.exec(value)) !== null) {
        paths.add(match[1]!);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(template);
  return [...paths].sort();
}

/**
 * Drop object keys whose rendered value is `undefined` (whole-string
 * placeholders with missing paths). Arrays keep entries; use filter if needed.
 */
export function pruneRenderedTemplate<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneRenderedTemplate(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneRenderedTemplate(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    return out as T;
  }
  return value;
}
