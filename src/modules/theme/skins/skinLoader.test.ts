import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  scopeSelector,
  splitSelectors,
  scopeSkinCss,
  generateFontFaces,
  applySkin,
  clearSkin,
  SKIN_STYLE_ELEMENT_ID,
} from "./skinLoader";
import {
  registerSkin,
  getSkin,
  listSkins,
  clearSkinRegistry,
} from "./skinRegistry";
import type { ThemeSkin } from "../types";

function createMockDocument() {
  const attributes = new Map<string, string>();
  const elements = new Map<string, any>();
  const headChildren: any[] = [];

  const root = {
    setAttribute: (key: string, val: string) => attributes.set(key, val),
    removeAttribute: (key: string) => attributes.delete(key),
    getAttribute: (key: string) => attributes.get(key) ?? null,
  };

  const head = {
    appendChild: (child: any) => {
      headChildren.push(child);
      if (child.id) elements.set(child.id, child);
    },
  };

  const doc = {
    documentElement: root,
    head,
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        id: "",
        dataset: {},
        textContent: "",
        remove: () => {
          if (el.id) elements.delete(el.id);
          const idx = headChildren.indexOf(el);
          if (idx !== -1) headChildren.splice(idx, 1);
        },
      };
      return el;
    },
  };

  return { doc, root, elements };
}

describe("skinLoader", () => {
  describe("scopeSelector", () => {
    it("scopes standard class and element selectors", () => {
      expect(scopeSelector("win31", ".title-bar")).toBe(
        '[data-theme-skin="win31"] .title-bar',
      );
      expect(scopeSelector("win31", "header")).toBe(
        '[data-theme-skin="win31"] header',
      );
    });

    it("scopes :root and html correctly on the root element", () => {
      expect(scopeSelector("win31", ":root")).toBe(
        ':root[data-theme-skin="win31"]',
      );
      expect(scopeSelector("win31", "html")).toBe(
        'html[data-theme-skin="win31"]',
      );
    });

    it("does not duplicate if selector is already scoped", () => {
      expect(
        scopeSelector("win31", '[data-theme-skin="win31"] .title-bar'),
      ).toBe('[data-theme-skin="win31"] .title-bar');
    });
  });

  describe("splitSelectors", () => {
    it("splits comma-separated selectors", () => {
      expect(splitSelectors(".foo, .bar, button")).toEqual([
        ".foo",
        ".bar",
        "button",
      ]);
    });

    it("does not split inside attribute selectors or parentheses", () => {
      expect(
        splitSelectors(':is(.foo, .bar), [data-attr="a,b"], button'),
      ).toEqual([':is(.foo, .bar)', '[data-attr="a,b"]', "button"]);
    });
  });

  describe("scopeSkinCss", () => {
    it("scopes standard rules and multiple selectors", () => {
      const raw = `
        .header, .footer {
          background: #c0c0c0;
        }
      `;
      const scoped = scopeSkinCss("win31", raw);
      expect(scoped).toContain(
        '[data-theme-skin="win31"] .header, [data-theme-skin="win31"] .footer {',
      );
    });

    it("preserves @font-face and @keyframes untouched", () => {
      const raw = `
        @font-face {
          font-family: 'W95FA';
          src: url('/w95fa.woff2');
        }
        @keyframes pulse {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .icon {
          animation: pulse 1s;
        }
      `;
      const scoped = scopeSkinCss("win31", raw);
      expect(scoped).toContain("@font-face {\n          font-family: 'W95FA';");
      expect(scoped).toContain("@keyframes pulse {");
      expect(scoped).toContain('[data-theme-skin="win31"] .icon {');
    });

    it("scopes selectors inside @media queries", () => {
      const raw = `
        @media (min-width: 600px) {
          .nav {
            display: flex;
          }
        }
      `;
      const scoped = scopeSkinCss("win31", raw);
      expect(scoped).toContain("@media (min-width: 600px) {");
      expect(scoped).toContain('[data-theme-skin="win31"] .nav {');
    });
  });

  describe("generateFontFaces", () => {
    it("generates @font-face blocks", () => {
      const fonts = [
        {
          family: "W95FA",
          src: "url('/fonts/w95fa.woff2') format('woff2')",
          weight: "normal",
        },
      ];
      const css = generateFontFaces(fonts);
      expect(css).toContain("@font-face {");
      expect(css).toContain("font-family: 'W95FA';");
      expect(css).toContain("font-weight: normal;");
    });
  });

  describe("DOM application", () => {
    let originalDoc: any;

    beforeEach(() => {
      originalDoc = (globalThis as any).document;
      const { doc } = createMockDocument();
      Object.defineProperty(globalThis, "document", {
        value: doc,
        configurable: true,
        writable: true,
      });
      clearSkin();
    });

    afterEach(() => {
      clearSkin();
      Object.defineProperty(globalThis, "document", {
        value: originalDoc,
        configurable: true,
        writable: true,
      });
    });

    it("applies and clears skin styles and data attribute", () => {
      const skin: ThemeSkin = {
        id: "win31",
        name: "Windows 3.1",
        css: ".window-controls { gap: 0px; }",
      };

      applySkin(skin);
      expect(document.documentElement.getAttribute("data-theme-skin")).toBe(
        "win31",
      );
      const styleEl = document.getElementById(
        SKIN_STYLE_ELEMENT_ID,
      ) as HTMLStyleElement | null;
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain('[data-theme-skin="win31"] .window-controls');

      clearSkin();
      expect(document.documentElement.getAttribute("data-theme-skin")).toBeNull();
      expect(document.getElementById(SKIN_STYLE_ELEMENT_ID)).toBeNull();
    });
  });

  describe("skinRegistry", () => {
    beforeEach(() => {
      clearSkinRegistry();
    });

    it("registers, retrieves, and lists skins", () => {
      const skin: ThemeSkin = {
        id: "test-skin",
        name: "Test Skin",
        css: ".test { color: red; }",
      };
      registerSkin(skin);
      expect(getSkin("test-skin")).toEqual(skin);
      expect(listSkins()).toEqual([skin]);
    });
  });
});
