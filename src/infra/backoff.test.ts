import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computeBackoff, type BackoffPolicy, sleepWithAbort } from "./backoff";

vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number, value: unknown, options?: { signal?: AbortSignal }) => {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        return reject(options.signal.reason);
      }
      const timer = setTimeout(() => resolve(value), ms);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(options.signal!.reason);
      });
    });
  },
}));

describe("computeBackoff", () => {
  const policy: BackoffPolicy = {
    initialMs: 100,
    maxMs: 1000,
    factor: 2,
    jitter: 0.1,
  };

  beforeEach(() => {
    // Default to no jitter contribution (random returns 0)
    // jitter calculation: base * policy.jitter * Math.random()
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates base backoff correctly for first attempt", () => {
    // attempt 1 -> Math.max(1-1, 0) = 0. initialMs * factor^0 = 100 * 1 = 100
    expect(computeBackoff(policy, 1)).toBe(100);
  });

  it("calculates exponential backoff", () => {
    // attempt 2 -> Math.max(2-1, 0) = 1. 100 * 2^1 = 200
    expect(computeBackoff(policy, 2)).toBe(200);
    // attempt 3 -> Math.max(3-1, 0) = 2. 100 * 2^2 = 400
    expect(computeBackoff(policy, 3)).toBe(400);
  });

  it("applies jitter correctly", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // attempt 2 -> base 200.
    // jitter = base * policy.jitter * random = 200 * 0.1 * 0.5 = 10.
    // result = round(200 + 10) = 210.
    expect(computeBackoff(policy, 2)).toBe(210);
  });

  it("respects maxMs", () => {
    // attempt 10 -> 100 * 2^9 = 51200 > 1000 (maxMs)
    expect(computeBackoff(policy, 10)).toBe(1000);
  });

  it("handles negative attempts as attempt 1", () => {
    // attempt -1 -> Math.max(-1-1, 0) = 0. Same as attempt 1.
    expect(computeBackoff(policy, -1)).toBe(100);
    expect(computeBackoff(policy, 0)).toBe(100);
  });
});

describe("sleepWithAbort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should sleep for the specified duration", async () => {
    const promise = sleepWithAbort(1000);

    // Advance time partially
    await vi.advanceTimersByTimeAsync(500);

    // Check it hasn't resolved yet
    let resolved = false;
    promise.then(() => { resolved = true; });
    // Process microtasks
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance remainder
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBeUndefined();
  });

  it("should resolve immediately for non-positive ms", async () => {
    await expect(sleepWithAbort(0)).resolves.toBeUndefined();
    await expect(sleepWithAbort(-100)).resolves.toBeUndefined();
  });

  it("should abort if signal is aborted during sleep", async () => {
    const controller = new AbortController();
    const promise = sleepWithAbort(1000, controller.signal);

    await vi.advanceTimersByTimeAsync(500);
    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
  });

  it("should abort immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithAbort(1000, controller.signal)).rejects.toThrow("aborted");
  });
});
