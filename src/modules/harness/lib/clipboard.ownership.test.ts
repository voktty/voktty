// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { copyText } from "@/modules/harness/lib/clipboard";

const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let current: boolean;
let browser: ReturnType<typeof vi.fn>, dom: ReturnType<typeof vi.fn>;
const guard = () => {
  if (!current) throw new DOMException("Retired", "AbortError");
};
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  current = true;
  native.mockReset();
  browser = vi.fn().mockResolvedValue(undefined);
  dom = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: browser },
    configurable: true,
  });
  Object.defineProperty(document, "execCommand", {
    value: dom,
    configurable: true,
  });
});
it("does not enter the native writer after retirement during import", async () => {
  const work = copyText("original", guard);
  current = false;
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(native).not.toHaveBeenCalled();
  expect(browser).not.toHaveBeenCalled();
  expect(dom).not.toHaveBeenCalled();
});
it.each(["resolve", "reject"] as const)(
  "does not fall back or acknowledge a retired native %s",
  async (outcome) => {
    const pending = deferred();
    native.mockReturnValue(pending.promise);
    const work = copyText("original", guard);
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledExactlyOnceWith("original"),
    );
    current = false;
    if (outcome === "resolve") pending.resolve();
    else pending.reject(new Error("native failed"));
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(browser).not.toHaveBeenCalled();
    expect(dom).not.toHaveBeenCalled();
  },
);
it("does not enter the DOM fallback after a retired browser failure", async () => {
  native.mockRejectedValue(new Error("native failed"));
  const pending = deferred();
  browser.mockReturnValue(pending.promise);
  const work = copyText("original", guard);
  await vi.waitFor(() =>
    expect(browser).toHaveBeenCalledExactlyOnceWith("original"),
  );
  current = false;
  pending.reject(new Error("browser failed"));
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(dom).not.toHaveBeenCalled();
});
it("retains the DOM fallback for current ordinary failures", async () => {
  native.mockRejectedValue(new Error("native failed"));
  browser.mockRejectedValue(new Error("browser failed"));
  await copyText("original", guard);
  expect(dom).toHaveBeenCalledExactlyOnceWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
});
