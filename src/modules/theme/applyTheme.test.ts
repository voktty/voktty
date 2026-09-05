import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, clearTheme, isDarkColor } from "./applyTheme";
import type { Theme } from "./types";

function createMockRoot() {
  const styles = new Map<string, string>();
  const classes = new Set<string>();

  return {
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
      getPropertyValue: (name: string) => styles.get(name) ?? "",
      removeProperty: (name: string) => styles.delete(name),
    },
    classList: {
      add: (...tokens: string[]) => tokens.forEach((t) => classes.add(t)),
      remove: (...tokens: string[]) => tokens.forEach((t) => classes.delete(t)),
      toggle: (token: string, force?: boolean) => {
        if (force === true) {
          classes.add(token);
          return true;
        }
        if (force === false) {
          classes.delete(token);
          return false;
        }
        if (classes.has(token)) {
          classes.delete(token);
          return false;
        }
        classes.add(token);
        return true;
      },
      contains: (token: string) => classes.has(token),
    },
  };
}

describe("isDarkColor", () => {
  it("identifies dark colors correctly", () => {
    expect(isDarkColor("#121214")).toBe(true);
    expect(isDarkColor("#282a36")).toBe(true);
    expect(isDarkColor("#1a1b26")).toBe(true);
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#111")).toBe(true);
    expect(isDarkColor("rgb(20, 20, 20)")).toBe(true);
    expect(isDarkColor("rgba(30, 30, 30, 0.8)")).toBe(true);
  });

  it("identifies light colors correctly", () => {
    expect(isDarkColor("#fafafc")).toBe(false);
    expect(isDarkColor("#f4f5f8")).toBe(false);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#fff")).toBe(false);
    expect(isDarkColor("rgb(250, 250, 252)")).toBe(false);
    expect(isDarkColor("rgba(240, 240, 240, 0.9)")).toBe(false);
  });
});

describe("applyTheme", () => {
  let mockRoot: ReturnType<typeof createMockRoot>;

  beforeEach(() => {
    mockRoot = createMockRoot();
    Object.defineProperty(globalThis, "document", {
      value: { documentElement: mockRoot },
      configurable: true,
    });
  });

  afterEach(() => {
    clearTheme();
  });

  const darkOnlyTheme: Theme = {
    id: "dark-test",
    name: "Dark Test",
    variants: {
      dark: {
        colors: {
          background: "#1e1e2e",
          foreground: "#cdd6f4",
          card: "#181825",
        },
      },
    },
  };

  const lightOnlyTheme: Theme = {
    id: "light-test",
    name: "Light Test",
    variants: {
      light: {
        colors: {
          background: "#eff1f5",
          foreground: "#4c4f69",
          card: "#e6e9ef",
        },
      },
    },
  };

  it("applies dark variant and synchronizes dark class on root even when light mode is passed", () => {
    applyTheme(darkOnlyTheme, "light");

    expect(mockRoot.classList.contains("dark")).toBe(true);
    expect(mockRoot.classList.contains("light")).toBe(false);
    expect(mockRoot.classList.contains("theme-light")).toBe(false);

    expect(mockRoot.style.getPropertyValue("--background")).toBe("#1e1e2e");
    expect(mockRoot.style.getPropertyValue("--foreground")).toBe("#cdd6f4");
    expect(mockRoot.style.getPropertyValue("--background-base")).toBe("#1e1e2e");
    expect(mockRoot.style.getPropertyValue("--color-background-base")).toBe("#1e1e2e");
    expect(mockRoot.style.getPropertyValue("--content")).toBe("#cdd6f4");
    expect(mockRoot.style.getPropertyValue("--color-content")).toBe("#cdd6f4");
    expect(mockRoot.style.getPropertyValue("--background-lightness")).toBe("9%");
    expect(mockRoot.style.getPropertyValue("--content-lightness")).toBe("92%");
  });

  it("applies light variant and synchronizes light/theme-light class on root even when dark mode is passed", () => {
    applyTheme(lightOnlyTheme, "dark");

    expect(mockRoot.classList.contains("light")).toBe(true);
    expect(mockRoot.classList.contains("theme-light")).toBe(true);
    expect(mockRoot.classList.contains("dark")).toBe(false);

    expect(mockRoot.style.getPropertyValue("--background")).toBe("#eff1f5");
    expect(mockRoot.style.getPropertyValue("--foreground")).toBe("#4c4f69");
    expect(mockRoot.style.getPropertyValue("--background-base")).toBe("#eff1f5");
    expect(mockRoot.style.getPropertyValue("--color-background-base")).toBe("#eff1f5");
    expect(mockRoot.style.getPropertyValue("--content")).toBe("#4c4f69");
    expect(mockRoot.style.getPropertyValue("--color-content")).toBe("#4c4f69");
    expect(mockRoot.style.getPropertyValue("--background-lightness")).toBe("97%");
    expect(mockRoot.style.getPropertyValue("--content-lightness")).toBe("18%");
  });

  it("clears all injected CSS variables on clearTheme", () => {
    applyTheme(darkOnlyTheme, "dark");
    expect(mockRoot.style.getPropertyValue("--background-base")).toBe("#1e1e2e");

    clearTheme();
    expect(mockRoot.style.getPropertyValue("--background-base")).toBe("");
    expect(mockRoot.style.getPropertyValue("--content")).toBe("");
    expect(mockRoot.style.getPropertyValue("--background")).toBe("");
    expect(mockRoot.style.getPropertyValue("--foreground")).toBe("");
  });
});
