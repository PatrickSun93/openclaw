import { describe, expect, it } from "vitest";
import { createDedupeCache } from "./dedupe.js";

describe("dedupe cache", () => {
  it("handles basic lifecycle (check, hit, miss)", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 100 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false); // miss
    expect(cache.size()).toBe(1);

    expect(cache.check("key1", now + 500)).toBe(true); // hit
    expect(cache.size()).toBe(1);

    expect(cache.check("key2", now + 500)).toBe(false); // miss
    expect(cache.size()).toBe(2);
  });

  it("expires entries after TTL", () => {
    const cache = createDedupeCache({ ttlMs: 100, maxSize: 100 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false); // miss

    // Expires at 1000 + 100 = 1100.
    expect(cache.check("key1", now + 101)).toBe(false); // expired -> miss
    expect(cache.size()).toBe(1); // it's re-added as a new entry
  });

  it("extends TTL on access (sliding window)", () => {
    const cache = createDedupeCache({ ttlMs: 100, maxSize: 100 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false); // miss
    expect(cache.check("key1", now + 50)).toBe(true); // hit, updates ts to 1050

    // Should not expire at 1100, but at 1150
    // Check at 1101 (past original 1100, but within extended 1150)
    expect(cache.check("key1", now + 101)).toBe(true); // hit

    // Now it is extended to 1101 + 100 = 1201.
    // Check at 1202 to verify expiration
    expect(cache.check("key1", now + 202)).toBe(false); // expired
  });

  it("supports infinite TTL (ttlMs <= 0)", () => {
    // ttlMs <= 0 means entries never expire based on time, only maxSize
    const cache = createDedupeCache({ ttlMs: 0, maxSize: 100 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false);
    expect(cache.check("key1", now + 100000)).toBe(true); // still hit
  });

  it("evicts oldest entries when maxSize is exceeded (LRU)", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 2 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false);
    expect(cache.check("key2", now)).toBe(false);
    expect(cache.size()).toBe(2);

    // Add 3rd key, should evict key1 (oldest)
    expect(cache.check("key3", now)).toBe(false);
    expect(cache.size()).toBe(2);

    // verify key2 is present
    expect(cache.check("key2", now)).toBe(true); // hit
    // verify key3 is present
    expect(cache.check("key3", now)).toBe(true); // hit
    // verify key1 is gone (checking it re-adds it)
    expect(cache.check("key1", now)).toBe(false); // miss (was evicted)
  });

  it("updates LRU position on access", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 2 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false);
    expect(cache.check("key2", now)).toBe(false);

    // Access key1 to make it most recent
    expect(cache.check("key1", now)).toBe(true);

    // Add key3, should evict key2 (now oldest)
    expect(cache.check("key3", now)).toBe(false);

    expect(cache.check("key1", now)).toBe(true); // key1 still there
    expect(cache.check("key2", now)).toBe(false); // key2 evicted
  });

  it("handles maxSize = 0 (no caching)", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 0 });
    const now = 1000;

    expect(cache.check("key1", now)).toBe(false);
    expect(cache.size()).toBe(0);
    expect(cache.check("key1", now + 10)).toBe(false); // still miss
  });

  it("handles invalid keys gracefully", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 100 });

    expect(cache.check(null, 1000)).toBe(false);
    expect(cache.check(undefined, 1000)).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it("clears the cache", () => {
    const cache = createDedupeCache({ ttlMs: 1000, maxSize: 100 });
    cache.check("key1", 1000);
    expect(cache.size()).toBe(1);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.check("key1", 1000)).toBe(false);
  });

  it("prunes expired keys on miss", () => {
    // Current implementation uses eager pruning on miss, iterating over all entries.
    // This test verifies that behavior.
    const cache = createDedupeCache({ ttlMs: 100, maxSize: 100 });
    const now = 1000;

    cache.check("key1", now); // expires at 1100
    cache.check("key2", now); // expires at 1100
    expect(cache.size()).toBe(2);

    // Advance time past expiration
    const later = 1200;

    // Check a new key to trigger pruning
    cache.check("key3", later);

    // key1 and key2 should be gone
    // We can't inspect internal map directly easily without exposing it,
    // but size should reflect it if prune works.
    expect(cache.size()).toBe(1);
    expect(cache.check("key3", later)).toBe(true);
  });
});
