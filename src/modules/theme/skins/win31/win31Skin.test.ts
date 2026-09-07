import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { win31Skin } from "./win31Skin";
import { win31Theme } from "../../themes/win31Theme";
import { validateSkinCss, clearSkin, SKIN_STYLE_ELEMENT_ID } from "../skinLoader";
import { resolveStructuralTraits } from "../../resolveStructuralTraits";
import { applyTheme, clearTheme } from "../../applyTheme";

function createMockDocument() {
  const attributes = new Map<string, string>();
  const elements = new Map<string, any>();
  const headChildren: any[] = [];
  const styles = new Map<string, string>();
  const classes = new Set<string>();

  const root = {
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

describe("Windows 3.1 Reference Skin", () => {
  it("defines authentic structural traits and square corners", () => {
    expect(win31Skin.id).toBe("win31");
    expect(win31Skin.windowCorners).toBe("square");
    expect(win31Skin.structuralTraits?.elevationStyle).toBe("bevel");
    expect(win31Skin.structuralTraits?.pillRadius).toBe("0px");
    expect(win31Skin.structuralTraits?.borderWidth).toBe("2px");
    expect(win31Skin.structuralTraits?.borderStyle).toBe("solid");
    expect(win31Skin.structuralTraits?.focusStyle).toBe("dotted");
    expect(win31Skin.structuralTraits?.uiFontSmoothing).toBe("none");
  });

  it("validates that all CSS rules are properly scoped to [data-theme-skin=\"win31\"]", () => {
    const { valid, errors, scopedCss } = validateSkinCss("win31", win31Skin.css);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    expect(scopedCss).toContain('[data-theme-skin="win31"] header');
    expect(scopedCss).toContain('[data-theme-skin="win31"] .window-controls');
    expect(scopedCss).toContain('[data-theme-skin="win31"] .window-control-button-minimize::after');
    expect(scopedCss).toContain('[data-theme-skin="win31"] .window-control-button-maximize::after');
    expect(scopedCss).toContain('[data-theme-skin="win31"] .window-control-button-close::after');
  });

  it("resolves structural traits through resolveStructuralTraits", () => {
    const resolved = resolveStructuralTraits({
      theme: win31Theme,
    });
    expect(resolved.traits.elevationStyle).toBe("bevel");
    expect(resolved.traits.pillRadius).toBe("0px");
    expect(resolved.traits.borderWidth).toBe("2px");
    expect(resolved.traits.focusStyle).toBe("dotted");
    expect(resolved.traits.uiFontSmoothing).toBe("none");
    expect(resolved.traits.windowCorners).toBe("square");
  });

  describe("DOM application", () => {
    let originalDoc: any;
    let mockRoot: any;

    beforeEach(() => {
      originalDoc = (globalThis as any).document;
      const { doc, root } = createMockDocument();
      mockRoot = root;
      Object.defineProperty(globalThis, "document", {
        value: doc,
        configurable: true,
        writable: true,
      });
      clearSkin();
    });

    afterEach(() => {
      clearSkin();
      clearTheme();
      Object.defineProperty(globalThis, "document", {
        value: originalDoc,
        configurable: true,
        writable: true,
      });
    });

    it("applies win31 theme, stamping data-theme-skin and injecting win31 stylesheet", () => {
      applyTheme(win31Theme, "light");
      expect(mockRoot.getAttribute("data-theme-skin")).toBe("win31");
      const styleEl = document.getElementById(SKIN_STYLE_ELEMENT_ID);
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain('[data-theme-skin="win31"] header');

      clearTheme();
      expect(mockRoot.getAttribute("data-theme-skin")).toBeNull();
      expect(document.getElementById(SKIN_STYLE_ELEMENT_ID)).toBeNull();
    });
  });
});
