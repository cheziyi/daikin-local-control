import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetStateCache } from "../setStateCache.js";

const REPLY = { pow: "1" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SetStateCache", () => {
  it("answers the reply it was set while the reply is younger than maxAgeInMs", () => {
    const cache = new SetStateCache(1000);
    cache.set(REPLY);

    vi.advanceTimersByTime(999);

    expect(cache.get()).toBe(REPLY);
  });

  it("answers nothing once the reply is maxAgeInMs old", () => {
    const cache = new SetStateCache(1000);
    cache.set(REPLY);

    vi.advanceTimersByTime(1000);

    expect(cache.get()).toBeUndefined();
  });

  it("answers nothing with a maxAgeInMs of 0", () => {
    const cache = new SetStateCache(0);
    cache.set(REPLY);

    expect(cache.get()).toBeUndefined();
  });

  it("answers nothing before it is set a reply", () => {
    expect(new SetStateCache(1000).get()).toBeUndefined();
  });

  it("answers nothing once it is cleared", () => {
    const cache = new SetStateCache(1000);
    cache.set(REPLY);

    cache.clear();

    expect(cache.get()).toBeUndefined();
  });
});
