import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBroker } from "./index.js";
import type { BrokerPorts } from "./index.js";
import type {
  ActionRequest,
  ActionResult,
  Approval,
  ApprovalPreview,
  PolicyProfile,
  PolicyDecision,
} from "@breeze/common";
import { BreezeError } from "@breeze/common";
import type { ConnectorCapability } from "@breeze/connectors";
import { z } from "zod";

// ── Shared fixtures ────────────────────────────────────────────────────

const ALLOW_PROFILE: PolicyProfile = {
  id: "test.allow_all",
  name: "Allow All",
  kind: "custom",
  rules: [{ id: "allow_all", decision: "allow", reason: "test" }],
};

const DENY_PROFILE: PolicyProfile = {
  id: "test.deny_all",
  name: "Deny All",
  kind: "custom",
  rules: [{ id: "deny_all", decision: "deny", reason: "denied by test policy" }],
};

const APPROVAL_PROFILE: PolicyProfile = {
  id: "test.require_approval",
  name: "Require Approval",
  kind: "custom",
  rules: [
    { id: "req", decision: "require_approval", reason: "needs review" },
  ],
};

function makeCap(overrides: Partial<ConnectorCapability> = {}): ConnectorCapability {
  return {
    key: "gmail.send_reply",
    displayName: "Send Reply",
    description: "Send a reply to an email",
    sensitivity: "medium",
    mutatesState: true,
    approvalHint: "sometimes",
    idempotent: false,
    inputSchema: z.object({ threadId: z.string(), body: z.string() }),
    outputSchema: z.object({ messageId: z.string() }),
    execute: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    idempotencyKey: "idem-1",
    userId: "user-1",
    planStepId: "step-1",
    connector: "gmail",
    capability: "gmail.send_reply",
    input: { threadId: "t-1", body: "Hello" },
    correlationId: "corr-1",
    ...overrides,
  };
}

const MOCK_PREVIEW: ApprovalPreview = {
  title: "Send Reply",
  serviceIcon: "gmail",
  targetSummary: "Thread t-1",
  undoable: false,
};

const MOCK_APPROVAL: Approval = {
  id: "appr-1",
  userId: "user-1",
  planStepId: "step-1",
  actionRequest: makeRequest(),
  preview: MOCK_PREVIEW,
  risk: "medium",
  status: "approved",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

// ── Port factory ───────────────────────────────────────────────────────

function makePorts(profile: PolicyProfile, capOverride?: Partial<ConnectorCapability>): BrokerPorts {
  const cap = makeCap(capOverride);

  // We need to mock requireCapability from @breeze/connectors
  // The broker imports it directly, so we cannot easily swap it without module mocking.
  // We test via integration by providing a cap that parses valid input.

  return {
    policy: {
      forUser: vi.fn().mockResolvedValue(profile),
    },
    connectors: {
      getAccount: vi.fn().mockResolvedValue({ id: "acc-1", userId: "user-1", connectorKey: "gmail" }),
      getFreshTokens: vi.fn().mockResolvedValue({ accessToken: "tok", expiresAt: new Date().toISOString() }),
    },
    executions: {
      findByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue({ executionId: "exec-1" }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    },
    approvals: {
      create: vi.fn().mockResolvedValue({ ...MOCK_APPROVAL, id: "appr-new" }),
      requireApproved: vi.fn().mockResolvedValue(MOCK_APPROVAL),
    },
    preview: {
      build: vi.fn().mockResolvedValue(MOCK_PREVIEW),
    },
    events: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

// ── Note: broker calls requireCapability(connector, capability) internally ──
// We need to mock the @breeze/connectors module to avoid real connector lookup.
vi.mock("@breeze/connectors", async () => {
  const { z } = await import("zod");
  const cap = {
    key: "gmail.send_reply",
    connector: "gmail",
    displayName: "Send Reply",
    description: "desc",
    sensitivity: "medium",
    mutatesState: true,
    approvalHint: "sometimes",
    idempotent: false,
    inputSchema: z.object({ threadId: z.string(), body: z.string() }),
    execute: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
  };

  return {
    requireCapability: vi.fn().mockReturnValue(cap),
    __cap: cap,
  };
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("broker.submit()", () => {
  it("returns approval_required when policy says require_approval", async () => {
    const ports = makePorts(APPROVAL_PROFILE);
    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    expect(result.kind).toBe("approval_required");
    expect((result as any).approvalId).toBeDefined();
  });

  it("returns denied when policy denies", async () => {
    const ports = makePorts(DENY_PROFILE);
    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    expect(result.kind).toBe("denied");
    expect((result as any).reason).toMatch(/denied/i);
  });

  it("returns allowed with result.ok: true on success path", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    expect(result.kind).toBe("allowed");
    expect((result as any).result.ok).toBe(true);
  });

  it("idempotency: second submit with same key returns cached result", async () => {
    const cachedResult: ActionResult = { ok: true, executionId: "exec-cached", output: { done: true } };
    const ports = makePorts(ALLOW_PROFILE);
    (ports.executions.findByIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValue(cachedResult);

    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    expect(result.kind).toBe("allowed");
    expect((result as any).result).toEqual(cachedResult);
    // Should NOT call policy or execute again
    expect(ports.policy.forUser).not.toHaveBeenCalled();
  });

  it("idempotency retry on non-ok: warns + re-executes", async () => {
    const nonOkResult: ActionResult = { ok: false, executionId: "exec-failed", errorMessage: "network error" };
    const ports = makePorts(ALLOW_PROFILE);
    (ports.executions.findByIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValue(nonOkResult);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    // Should proceed to re-execute
    expect(ports.policy.forUser).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("invalid input schema → throws BreezeError with validation kind", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    // Mock requireCapability to return a cap with strict schema that will reject
    const { requireCapability } = await import("@breeze/connectors");
    (requireCapability as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ...makeCap(),
      inputSchema: z.object({ required_field: z.string() }),
    });

    await expect(
      broker.submit(makeRequest({ input: { wrong_field: 123 } }))
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("emits policy.decision event on every submit", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    await broker.submit(makeRequest());
    const calls = (ports.events.emit as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((c: any) => c[0].type);
    expect(types).toContain("policy.decision");
  });

  it("emits action.started and action.completed on success", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    await broker.submit(makeRequest());
    const calls = (ports.events.emit as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((c: any) => c[0].type);
    expect(types).toContain("action.started");
    expect(types).toContain("action.completed");
  });
});

describe("broker.submit() — executeNow failure path", () => {
  it("returns kind: failed when connector.execute throws", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const { requireCapability } = await import("@breeze/connectors");
    (requireCapability as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ...makeCap(),
      execute: vi.fn().mockRejectedValue(new Error("connector exploded")),
    });

    const broker = createBroker(ports);
    const result = await broker.submit(makeRequest());
    expect(result.kind).toBe("failed");
    expect((result as any).errorMessage).toContain("connector exploded");
  });

  it("calls executions.fail on connector error", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const { requireCapability } = await import("@breeze/connectors");
    (requireCapability as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ...makeCap(),
      execute: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const broker = createBroker(ports);
    await broker.submit(makeRequest());
    expect(ports.executions.fail).toHaveBeenCalledWith("exec-1", "boom");
  });

  it("emits action.failed event on connector error", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const { requireCapability } = await import("@breeze/connectors");
    (requireCapability as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ...makeCap(),
      execute: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    const broker = createBroker(ports);
    await broker.submit(makeRequest());
    const calls = (ports.events.emit as ReturnType<typeof vi.fn>).mock.calls;
    const types = calls.map((c: any) => c[0].type);
    expect(types).toContain("action.failed");
  });
});

describe("broker.submit() — AbortController timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts signal after 30 seconds", async () => {
    let capturedSignal: AbortSignal | undefined;
    const ports = makePorts(ALLOW_PROFILE);
    const { requireCapability } = await import("@breeze/connectors");
    (requireCapability as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ...makeCap(),
      execute: vi.fn().mockImplementation(
        (_input: unknown, ctx: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            capturedSignal = ctx.signal;
            ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
          })
      ),
    });

    const broker = createBroker(ports);
    const submitPromise = broker.submit(makeRequest());
    await vi.advanceTimersByTimeAsync(30_001);
    await submitPromise.catch(() => {});
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("broker.resumeAfterApproval()", () => {
  it("executes cap and returns allowed outcome", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    const result = await broker.resumeAfterApproval("appr-1");
    expect(result.kind).toBe("allowed");
    expect((result as any).result.ok).toBe(true);
  });

  it("calls approvals.requireApproved with the provided id", async () => {
    const ports = makePorts(ALLOW_PROFILE);
    const broker = createBroker(ports);
    await broker.resumeAfterApproval("appr-99");
    expect(ports.approvals.requireApproved).toHaveBeenCalledWith("appr-99");
  });
});
