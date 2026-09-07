import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mac1Skin } from "./mac1Skin";
import { mac1Theme } from "../../themes/mac1Theme";
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

describe("Macintosh System 1.0 Radical Skin", () => {
  it("defines authentic System 1.0 structural traits and round corners", () => {
    expect(mac1Skin.id).toBe("mac1");
    expect(mac1Skin.windowCorners).toBe("round");
    expect(mac1Skin.structuralTraits?.elevationStyle).toBe("flat");
    expect(mac1Skin.structuralTraits?.pillRadius).toBe("8px");
    expect(mac1Skin.structuralTraits?.borderWidth).toBe("1px");
    expect(mac1Skin.structuralTraits?.borderStyle).toBe("solid");
    expect(mac1Skin.structuralTraits?.focusStyle).toBe("invert");
    expect(mac1Skin.structuralTraits?.uiFontSmoothing).toBe("none");
  });

  it("validates that all CSS rules are properly scoped to [data-theme-skin=\"mac1\"]", () => {
    const { valid, errors, scopedCss } = validateSkinCss("mac1", mac1Skin.css);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    expect(scopedCss).toContain('[data-theme-skin="mac1"] header');
    expect(scopedCss).toContain('[data-theme-skin="mac1"] .window-controls');
    expect(scopedCss).toContain('[data-theme-skin="mac1"] .window-control-button-close::after');
  });

  it("resolves structural traits through resolveStructuralTraits", () => {
    const resolved = resolveStructuralTraits({
      theme: mac1Theme,
    });
    expect(resolved.traits.elevationStyle).toBe("flat");
    expect(resolved.traits.pillRadius).toBe("8px");
    expect(resolved.traits.borderWidth).toBe("1px");
    expect(resolved.traits.focusStyle).toBe("invert");
    expect(resolved.traits.uiFontSmoothing).toBe("none");
    expect(resolved.traits.windowCorners).toBe("round");
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

    it("applies mac1 theme, stamping data-theme-skin and injecting stylesheet", () => {
      applyTheme(mac1Theme, "light");
      expect(mockRoot.getAttribute("data-theme-skin")).toBe("mac1");
      const styleEl = document.getElementById(SKIN_STYLE_ELEMENT_ID);
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain('[data-theme-skin="mac1"] header');

      clearTheme();
      expect(mockRoot.getAttribute("data-theme-skin")).toBeNull();
      expect(document.getElementById(SKIN_STYLE_ELEMENT_ID)).toBeNull();
    });
  });
});
