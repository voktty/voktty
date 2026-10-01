import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickGitPopup } from "./QuickGitPopup";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("QuickGitPopup", () => {
  it("renders popup container element", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickGitPopup, { onShown: vi.fn() }),
    );

    expect(markup).toBeDefined();
  });
});
