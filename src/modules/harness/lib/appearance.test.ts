import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_BACKGROUND_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  isLightScheme,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadTranscriptAnchor,
  loadTranscriptLayout,
  loadTranscriptZen,
  saveChatBackgroundOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveTranscriptAnchor,
  saveTranscriptLayout,
  saveTranscriptZen,
  TRANSCRIPT_ANCHOR_DEFAULT,
  TRANSCRIPT_LAYOUT_DEFAULT,
  TRANSCRIPT_ZEN_DEFAULT,
  toggleTranscriptZen,
} from "./appearance";

const KEY = "monocode.transcriptLayout";
const ZEN_KEY = "monocode.transcriptZen";
const ANCHOR_KEY = "monocode.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "monocode.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "monocode.chatBackgroundOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "monocode.chatBackgroundScope";
const APPEARANCE_SOURCE = readFileSync(
  fileURLToPath(new URL("./appearance.ts", import.meta.url)),
  "utf8",
);
const GLOBALS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../styles/globals.css", import.meta.url)),
  "utf8",
);
const LEGACY_STRUCTURAL_KEYS = [
  "monocode.themeHue",
  "monocode.themeSaturation",
  "monocode.sidebarOpacity",
  "monocode.sidebarBlur",
  "monocode.bodyGlass",
];

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

describe("zen mode setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ZEN_KEY);
  });

  it("defaults to on", () => {
    expect(TRANSCRIPT_ZEN_DEFAULT).toBe(true);
    expect(loadTranscriptZen()).toBe(true);
  });

  it("persists across loads", () => {
    saveTranscriptZen(true);
    expect(loadTranscriptZen()).toBe(true);
    saveTranscriptZen(false);
    expect(loadTranscriptZen()).toBe(false);
  });

  it("toggles from the current value", () => {
    expect(toggleTranscriptZen()).toBe(false);
    expect(loadTranscriptZen()).toBe(false);
    expect(toggleTranscriptZen()).toBe(true);
    expect(loadTranscriptZen()).toBe(true);
  });
});

describe("transcript prompt-to-top setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ANCHOR_KEY);
  });

  it("defaults to on", () => {
    expect(TRANSCRIPT_ANCHOR_DEFAULT).toBe(true);
    expect(loadTranscriptAnchor()).toBe(true);
  });

  it("persists across loads", () => {
    saveTranscriptAnchor(true);
    expect(loadTranscriptAnchor()).toBe(true);
    saveTranscriptAnchor(false);
    expect(loadTranscriptAnchor()).toBe(false);
  });
});

describe("chat background setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(CHAT_BACKGROUND_PATH_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_OPACITY_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_SCOPE_KEY);
  });

  it("stores and clears the app-owned background path", () => {
    expect(loadChatBackgroundPath()).toBeNull();
    saveChatBackgroundPath("/app-data/backgrounds/chat-background.webp");
    expect(loadChatBackgroundPath()).toBe(
      "/app-data/backgrounds/chat-background.webp",
    );
    saveChatBackgroundPath(null);
    expect(loadChatBackgroundPath()).toBeNull();
  });

  it("defaults and clamps background visibility", () => {
    expect(loadChatBackgroundOpacity()).toBe(CHAT_BACKGROUND_OPACITY_DEFAULT);
    saveChatBackgroundOpacity(1);
    expect(loadChatBackgroundOpacity()).toBe(0.65);
    saveChatBackgroundOpacity(0);
    expect(loadChatBackgroundOpacity()).toBe(0.05);
  });

  it("persists where the background is shown", () => {
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
    saveChatBackgroundScope("empty");
    expect(loadChatBackgroundScope()).toBe("empty");
    saveChatBackgroundScope("all");
    expect(loadChatBackgroundScope()).toBe("all");
    localStorage.setItem(CHAT_BACKGROUND_SCOPE_KEY, "transcript");
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
  });
});

function mockDocumentElementClasses() {
  const classes = new Set<string>();
  Object.defineProperty(globalThis, "document", {
    value: {
      documentElement: {
        classList: {
          contains: (name: string) => classes.has(name),
          add: (...names: string[]) =>
            names.forEach((name) => {
              classes.add(name);
            }),
          remove: (...names: string[]) =>
            names.forEach((name) => {
              classes.delete(name);
            }),
        },
      },
    },
    configurable: true,
  });
  return classes;
}

describe("isLightScheme", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
  });

  it("mirrors the real app theme's resolved class, not a scheme of its own", () => {
    const classes = mockDocumentElementClasses();
    classes.add("light");
    expect(isLightScheme()).toBe(true);
    classes.delete("light");
    classes.add("dark");
    expect(isLightScheme()).toBe(false);
  });
});

describe("Harness appearance authority", () => {
  it("does not retain structural theme preferences outside Voktty", () => {
    for (const key of LEGACY_STRUCTURAL_KEYS) {
      expect(APPEARANCE_SOURCE).not.toContain(key);
    }
    expect(APPEARANCE_SOURCE).not.toContain("set_window_background_blur");
    expect(GLOBALS_SOURCE).not.toContain("--theme-hue");
    expect(GLOBALS_SOURCE).not.toContain("--theme-saturation");
  });

  it("preserves content and layout preferences", () => {
    expect(APPEARANCE_SOURCE).toContain(CHAT_BACKGROUND_PATH_KEY);
    expect(APPEARANCE_SOURCE).toContain("monocode.sidebarLayout");
    expect(APPEARANCE_SOURCE).toContain("monocode.projectRailWidth");
  });
});
