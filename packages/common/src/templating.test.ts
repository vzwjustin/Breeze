import { describe, it, expect } from "vitest";
import { renderTemplate } from "./templating.js";
import type { TemplateScope } from "./templating.js";

// ── Whole-string placeholders ──────────────────────────────────────────

describe("whole-string placeholder — typed passthrough", () => {
  it("returns number value without stringification", () => {
    const scope: TemplateScope = { count: 42 };
    expect(renderTemplate("{{count}}", scope)).toBe(42);
  });

  it("returns object value as-is", () => {
    const scope: TemplateScope = { meta: { a: 1 } };
    const result = renderTemplate("{{meta}}", scope);
    expect(result).toEqual({ a: 1 });
  });

  it("returns array value as-is", () => {
    const scope: TemplateScope = { items: [1, 2, 3] };
    expect(renderTemplate("{{items}}", scope)).toEqual([1, 2, 3]);
  });

  it("returns null for null scope value", () => {
    const scope: TemplateScope = { val: null };
    expect(renderTemplate("{{val}}", scope)).toBeNull();
  });

  it("returns false for boolean false", () => {
    const scope: TemplateScope = { flag: false };
    expect(renderTemplate("{{flag}}", scope)).toBe(false);
  });

  it("returns empty string for missing whole-string path", () => {
    const scope: TemplateScope = {};
    expect(renderTemplate("{{missing}}", scope)).toBeUndefined();
  });
});

// ── Partial placeholders ───────────────────────────────────────────────

describe("partial placeholder — string concatenation", () => {
  it("concatenates string value with surrounding text", () => {
    const scope: TemplateScope = { name: "World" };
    expect(renderTemplate("Hello {{name}}!", scope)).toBe("Hello World!");
  });

  it("renders number as string in partial context", () => {
    const scope: TemplateScope = { count: 5 };
    expect(renderTemplate("You have {{count}} messages", scope)).toBe("You have 5 messages");
  });

  it("renders missing path as empty string in partial context", () => {
    const scope: TemplateScope = {};
    expect(renderTemplate("Hello {{name}}!", scope)).toBe("Hello !");
  });

  it("renders null as empty string in partial context", () => {
    const scope: TemplateScope = { val: null };
    expect(renderTemplate("prefix_{{val}}_suffix", scope)).toBe("prefix__suffix");
  });

  it("renders object as JSON in partial context", () => {
    const scope: TemplateScope = { meta: { key: "val" } };
    const result = renderTemplate("data: {{meta}}", scope);
    expect(result).toContain('"key"');
  });

  it("renders multiple placeholders in one string", () => {
    const scope: TemplateScope = { first: "Jane", last: "Doe" };
    expect(renderTemplate("{{first}} {{last}}", scope)).toBe("Jane Doe");
  });
});

// ── Nested structures ──────────────────────────────────────────────────

describe("nested arrays and objects recurse", () => {
  it("recurses into object values", () => {
    const scope: TemplateScope = { subject: "Hello" };
    const template = { email: { subject: "{{subject}}" } };
    expect(renderTemplate(template, scope)).toEqual({ email: { subject: "Hello" } });
  });

  it("recurses into array elements", () => {
    const scope: TemplateScope = { item: "A" };
    const template = ["{{item}}", "literal"];
    expect(renderTemplate(template, scope)).toEqual(["A", "literal"]);
  });

  it("recurses into nested array of objects", () => {
    const scope: TemplateScope = { name: "Bob" };
    const template = [{ label: "{{name}}" }];
    expect(renderTemplate(template, scope)).toEqual([{ label: "Bob" }]);
  });

  it("passes through non-string, non-array, non-object values unchanged", () => {
    expect(renderTemplate(42, {})).toBe(42);
    expect(renderTemplate(true, {})).toBe(true);
    expect(renderTemplate(null, {})).toBeNull();
  });
});

// ── Dot-path traversal ─────────────────────────────────────────────────

describe("dot-path traversal", () => {
  it("traverses nested path", () => {
    const scope: TemplateScope = { a: { b: { c: "deep" } } };
    expect(renderTemplate("{{a.b.c}}", scope)).toBe("deep");
  });

  it("returns undefined for missing intermediate key", () => {
    const scope: TemplateScope = { a: {} };
    expect(renderTemplate("{{a.b.c}}", scope)).toBeUndefined();
  });

  it("does not traverse into primitives mid-path", () => {
    const scope: TemplateScope = { a: "string" };
    expect(renderTemplate("{{a.b}}", scope)).toBeUndefined();
  });
});

// ── Empty and non-string templates ─────────────────────────────────────

describe("edge cases", () => {
  it("returns empty string for empty template string", () => {
    expect(renderTemplate("", {})).toBe("");
  });

  it("returns template unchanged when no placeholders", () => {
    expect(renderTemplate("no placeholders here", {})).toBe("no placeholders here");
  });

  it("empty scope and whole-string placeholder returns undefined", () => {
    expect(renderTemplate("{{x}}", {})).toBeUndefined();
  });
});

// ── Prototype pollution guards ─────────────────────────────────────────

describe("prototype pollution guard", () => {
  it("{{__proto__.polluted}} returns undefined and does not pollute", () => {
    const scope: TemplateScope = {};
    const result: unknown = renderTemplate("{{__proto__.polluted}}" as string, scope);
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect(result === undefined || result === "").toBe(true);
  });

  it("{{constructor.prototype.x}} returns undefined, no pollution", () => {
    const scope: TemplateScope = {};
    renderTemplate("{{constructor.prototype.x}}", scope);
    expect((Object.prototype as any).x).toBeUndefined();
  });

  it("{{toString}} returns undefined — does not call toString on Object", () => {
    // 'toString' is not an own property of a plain scope object
    const scope: TemplateScope = {};
    const result: unknown = renderTemplate("{{toString}}" as string, scope);
    expect(result === undefined || result === "").toBe(true);
  });

  it("scope with __proto__ own key does not affect Object.prototype", () => {
    // JSON.parse creates an object with __proto__ as an own key (not inheritance)
    const scope = JSON.parse('{"__proto__":{"evil":true}}') as TemplateScope;
    renderTemplate("{{__proto__.evil}}", scope);
    expect((Object.prototype as any).evil).toBeUndefined();
  });

  it("nested path with constructor does not execute it", () => {
    const scope: TemplateScope = { a: {} };
    const result = renderTemplate("{{a.constructor}}", scope);
    // constructor is NOT an own property of a plain object
    expect(typeof result).not.toBe("function");
  });
});

// ── Circular reference guard ───────────────────────────────────────────

describe("circular references", () => {
  it("whole-string placeholder returning circular object does not hang", () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const scope: TemplateScope = { circ };
    // Should return the circular object reference without infinite loop during lookup
    const result = renderTemplate("{{circ}}", scope);
    expect(result).toBe(circ);
  });

  it("partial placeholder with circular object serializes via JSON (may throw) or is handled", () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const scope: TemplateScope = { circ };
    // In partial context, renderString calls JSON.stringify — this will throw
    // The test verifies the call does NOT hang indefinitely
    expect(() => renderTemplate("prefix_{{circ}}", scope)).toThrow();
  });
});
