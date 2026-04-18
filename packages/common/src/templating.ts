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

function lookup(scope: TemplateScope, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function renderString(template: string, scope: TemplateScope): unknown {
  const whole = template.match(WHOLE_RE);
  if (whole) return lookup(scope, whole[1]!);
  return template.replace(PART_RE, (_, path: string) => {
    const v = lookup(scope, path);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
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
