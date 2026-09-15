import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isToolDeadlineTimeout,
  raceWithDeadline,
  shapeToolDeadlineTimeout,
  type DeadlineTimers,
} from "../core/inline-agent/step-control";
import {
  INLINE_AGENT_STEP_TIMEOUT_MS,
  INLINE_AGENT_TOOL_CALL_TIMEOUT_MS,
} from "../core/inline-agent/types";
import { translate } from "../core/i18n";

const EN_MESSAGE = "Tool call timed out after 3 minutes and was skipped.";
const ZH_MESSAGE = "工具调用超时（3 分钟），已跳过。";

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

const provider = {
  kind: "local",
  id: "browser_control",
  displayName: "Browser Control",
  transport: "in_process",
} as const;

describe("INLINE_AGENT_TOOL_CALL_TIMEOUT_MS", () => {
  it("is bounded at 3 minutes, above the stream step timeout", () => {
    expect(INLINE_AGENT_TOOL_CALL_TIMEOUT_MS).toBe(180_000);
    expect(INLINE_AGENT_TOOL_CALL_TIMEOUT_MS).toBeGreaterThan(
      INLINE_AGENT_STEP_TIMEOUT_MS,
    );
  });
});

describe("raceWithDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise value when the tool finishes before the deadline", async () => {
    const value = { ok: true, summary: "done" };
    await expect(
      raceWithDeadline(
        Promise.resolve(value),
        new AbortController().signal,
        INLINE_AGENT_TOOL_CALL_TIMEOUT_MS,
      ),
    ).resolves.toBe(value);
  });

  it("resolves with the timeout sentinel when the deadline expires first", async () => {
    vi.useFakeTimers();
    const pending = raceWithDeadline(
      never<{ ok: boolean; summary: string }>(),
      new AbortController().signal,
      INLINE_AGENT_TOOL_CALL_TIMEOUT_MS,
    );
    vi.advanceTimersByTime(INLINE_AGENT_TOOL_CALL_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ timedOut: true });
  });

  it("rejects with signal.reason when the run aborts before the deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new DOMException("Run stopped.", "AbortError");
    const pending = raceWithDeadline(
      never<{ ok: boolean; summary: string }>(),
      controller.signal,
      INLINE_AGENT_TOOL_CALL_TIMEOUT_MS,
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Run stopped.", "AbortError");
    controller.abort(reason);
    await expect(
      raceWithDeadline(Promise.resolve("late"), controller.signal, 1000),
    ).rejects.toBe(reason);
  });

  it("propagates the tool promise's own rejection", async () => {
    const failure = new Error("runtime_message_failed");
    await expect(
      raceWithDeadline(
        Promise.reject(failure),
        new AbortController().signal,
        INLINE_AGENT_TOOL_CALL_TIMEOUT_MS,
      ),
    ).rejects.toBe(failure);
  });

  it("settles once, clears the timer when the tool wins, and ignores late expiry", async () => {
    vi.useFakeTimers();
    const clearScheduledTimeout = vi.fn((timer: unknown) =>
      clearTimeout(timer as ReturnType<typeof setTimeout>),
    );
    const timers: DeadlineTimers = {
      scheduleTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
      clearScheduledTimeout,
    };
    let settleTool: ((value: string) => void) | undefined;
    const pending = raceWithDeadline(
      new Promise<string>((resolve) => {
        settleTool = resolve;
      }),
      new AbortController().signal,
      1000,
      timers,
    );

    settleTool?.("done");
    await expect(pending).resolves.toBe("done");
    expect(clearScheduledTimeout).toHaveBeenCalledTimes(1);

    // A late deadline firing after settlement must be a no-op.
    vi.advanceTimersByTime(5000);
    await expect(Promise.resolve("still settled")).resolves.toBe(
      "still settled",
    );
  });
});

describe("isToolDeadlineTimeout", () => {
  it("narrows the sentinel and rejects ordinary results", () => {
    expect(isToolDeadlineTimeout({ timedOut: true })).toBe(true);
    expect(isToolDeadlineTimeout({ ok: true, summary: "done" })).toBe(false);
  });
});

describe("shapeToolDeadlineTimeout", () => {
  it("produces the exact retryable error record for the failed tool", () => {
    const call = {
      name: "browser_control",
      provider,
      descriptorId: "desc-browser-control",
    };
    expect(shapeToolDeadlineTimeout(call, EN_MESSAGE)).toEqual({
      ok: false,
      name: "browser_control",
      provider,
      descriptorId: "desc-browser-control",
      summary: EN_MESSAGE,
      error: {
        code: "tool_call_deadline_exceeded",
        message: EN_MESSAGE,
        retryable: true,
      },
    });
  });

  it("uses the localized deadline message wired from both locales", () => {
    expect(translate("en", "content.agent.toolDeadline")).toBe(EN_MESSAGE);
    expect(translate("zh-CN", "content.agent.toolDeadline")).toBe(ZH_MESSAGE);
  });
});
