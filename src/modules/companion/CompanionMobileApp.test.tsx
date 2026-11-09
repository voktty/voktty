// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionMobileApp } from "./CompanionMobileApp";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CompanionMobileApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders pairing intake by default", () => {
    act(() => {
      root.render(<CompanionMobileApp />);
    });

    expect(container.textContent).toContain("companion.mobile.title");
    expect(container.textContent).toContain("companion.mobile.payloadLabel");
    expect(container.textContent).toContain("companion.mobile.connect");
    expect(container.textContent).toContain("companion.mobile.scanQr");
  });

  it("disables connect button when payload is empty", () => {
    act(() => {
      root.render(<CompanionMobileApp />);
    });

    const button = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("companion.mobile.connect"),
    );
    expect(button?.hasAttribute("disabled")).toBe(true);
  });
});
