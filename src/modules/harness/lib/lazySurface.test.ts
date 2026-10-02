import { describe, expect, it, vi } from "vitest";
import { lazySurface } from "./lazySurface";

describe("lazySurface", () => {
  it("shares one import between warmup and subsequent preload calls", async () => {
    const mockComponent = () => null;
    let resolve!: (val: { default: typeof mockComponent }) => void;
    const pending = new Promise<{ default: typeof mockComponent }>((done) => {
      resolve = done;
    });
    const load = vi.fn(() => pending);
    const Surface = lazySurface(load, { suspense: false });

    expect(load).not.toHaveBeenCalled();
    const first = Surface.preload();
    const second = Surface.preload();
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();

    resolve({ default: mockComponent });
    await first;
  });

  it("retries a failed warmup when preloaded again", async () => {
    const mockComponent = () => null;
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("Warmup failed"))
      .mockResolvedValue({ default: mockComponent });
    const Surface = lazySurface(load);

    await expect(Surface.preload()).rejects.toThrow("Warmup failed");
    await expect(Surface.preload()).resolves.toEqual({ default: mockComponent });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
