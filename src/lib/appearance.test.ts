import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTranscriptLayout,
  saveTranscriptLayout,
  TRANSCRIPT_LAYOUT_DEFAULT,
} from "./appearance";

const KEY = "monocode.transcriptLayout";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("transcript layout setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to full width", () => {
    expect(TRANSCRIPT_LAYOUT_DEFAULT).toBe("full");
    expect(loadTranscriptLayout()).toBe("full");
  });

  it("persists the chat layout", () => {
    saveTranscriptLayout("chat");
    expect(localStorage.getItem(KEY)).toBe("chat");
    expect(loadTranscriptLayout()).toBe("chat");
    saveTranscriptLayout("full");
    expect(loadTranscriptLayout()).toBe("full");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(KEY, "bubbles");
    expect(loadTranscriptLayout()).toBe("full");
  });
});
