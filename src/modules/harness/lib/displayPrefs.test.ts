// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MASK_EMAILS_DEFAULT,
  SHOW_REMAINING_USAGE_DEFAULT,
  loadMaskEmails,
  loadShowRemainingUsage,
  saveMaskEmails,
  saveShowRemainingUsage,
  subscribeMaskEmails,
  subscribeShowRemainingUsage,
} from "./displayPrefs";

const prefs = [
  {
    name: "show remaining usage",
    key: "monocode.showRemainingUsage",
    defaultValue: SHOW_REMAINING_USAGE_DEFAULT,
    load: loadShowRemainingUsage,
    save: saveShowRemainingUsage,
    subscribe: subscribeShowRemainingUsage,
  },
  {
    name: "mask emails",
    key: "monocode.maskEmails",
    defaultValue: MASK_EMAILS_DEFAULT,
    load: loadMaskEmails,
    save: saveMaskEmails,
    subscribe: subscribeMaskEmails,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  for (const pref of prefs) pref.save(pref.defaultValue);
  localStorage.clear();
});

describe.each(prefs)("$name preference", (pref) => {
  it("uses its default and notifies this window when saved", () => {
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);
    expect(pref.load()).toBe(pref.defaultValue);

    const value = !pref.defaultValue;
    pref.save(value);

    expect(pref.load()).toBe(value);
    expect(localStorage.getItem(pref.key)).toBe(value ? "1" : "0");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps the saved value in memory when storage rejects the write", () => {
    const value = !pref.defaultValue;
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);
    listener.mockImplementation(() => expect(pref.load()).toBe(value));

    pref.save(value);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(pref.load()).toBe(value);
    unsubscribe();
    spy.mockRestore();
    pref.save(pref.defaultValue);
    expect(pref.load()).toBe(pref.defaultValue);
  });

  it("follows a change saved in another window", () => {
    const listener = vi.fn();
    const unsubscribe = pref.subscribe(listener);
    const value = !pref.defaultValue;

    localStorage.setItem(pref.key, value ? "1" : "0");
    window.dispatchEvent(new StorageEvent("storage", { key: pref.key }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pref.load()).toBe(value);

    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.removeItem(pref.key);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(pref.load()).toBe(pref.defaultValue);
    unsubscribe();
  });
});
