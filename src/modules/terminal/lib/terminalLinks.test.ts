import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
const { gitAddSafeDirectory } = vi.hoisted(() => ({
  gitAddSafeDirectory: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitAddSafeDirectory,
  },
}));

import {
  createTerminalLinkHandler,
  DUBIOUS_OWNERSHIP_LINK_REGEX,
  SAFE_DIR_LINK_REGEX,
} from "./terminalLinks";

describe("createTerminalLinkHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens OSC 8 links natively and restores late-bound terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const initialFocus = vi.fn();
    let focus = initialFocus;
    const handler = createTerminalLinkHandler(() => focus());
    focus = vi.fn();

    handler.activate(
      {} as MouseEvent,
      "https://chatgpt.com/codex/settings/usage",
    );

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(initialFocus).not.toHaveBeenCalled();
  });

  it("matches and handles git safe.directory command links", async () => {
    gitAddSafeDirectory.mockResolvedValue(undefined);
    const focus = vi.fn();
    const handler = createTerminalLinkHandler(focus);
    const text = "git config --global --add safe.directory '%(prefix)///192.168.1.4/www/amor40'";

    expect(SAFE_DIR_LINK_REGEX.test(text)).toBe(true);
    handler.activate({} as MouseEvent, text);

    await vi.waitFor(() => {
      expect(gitAddSafeDirectory).toHaveBeenCalledWith(
        "%(prefix)///192.168.1.4/www/amor40",
      );
      expect(focus).toHaveBeenCalledOnce();
    });
  });

  it("matches and handles dubious ownership error links", async () => {
    gitAddSafeDirectory.mockResolvedValue(undefined);
    const focus = vi.fn();
    const handler = createTerminalLinkHandler(focus);
    const text = "fatal: detected dubious ownership in repository at '//192.168.1.4/www/amor40'";

    expect(DUBIOUS_OWNERSHIP_LINK_REGEX.test(text)).toBe(true);
    handler.activate({} as MouseEvent, text);

    await vi.waitFor(() => {
      expect(gitAddSafeDirectory).toHaveBeenCalledWith(
        "//192.168.1.4/www/amor40",
      );
      expect(focus).toHaveBeenCalledOnce();
    });
  });
});
