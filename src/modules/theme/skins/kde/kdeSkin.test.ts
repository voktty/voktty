import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { kdeSkin } from "./kdeSkin";
import { kdeTheme } from "../../themes/kdeTheme";
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

describe("KDE Classic Radical Skin", () => {
  it("defines authentic KDE 2/3 structural traits and round corners", () => {
    expect(kdeSkin.id).toBe("kde");
    expect(kdeSkin.windowCorners).toBe("round");
    expect(kdeSkin.structuralTraits?.elevationStyle).toBe("bevel");
    expect(kdeSkin.structuralTraits?.pillRadius).toBe("3px");
    expect(kdeSkin.structuralTraits?.borderWidth).toBe("1px");
    expect(kdeSkin.structuralTraits?.borderStyle).toBe("solid");
    expect(kdeSkin.structuralTraits?.focusStyle).toBe("ring");
    expect(kdeSkin.structuralTraits?.uiFontSmoothing).toBe("antialiased");
  });

  it("validates that all CSS rules are properly scoped to [data-theme-skin=\"kde\"]", () => {
    const { valid, errors, scopedCss } = validateSkinCss("kde", kdeSkin.css);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    expect(scopedCss).toContain('[data-theme-skin="kde"] header');
    expect(scopedCss).toContain('[data-theme-skin="kde"] .window-controls');
    expect(scopedCss).toContain('[data-theme-skin="kde"] .window-control-button-close:hover');
  });

  it("resolves structural traits through resolveStructuralTraits", () => {
    const resolved = resolveStructuralTraits({
      theme: kdeTheme,
    });
    expect(resolved.traits.elevationStyle).toBe("bevel");
    expect(resolved.traits.pillRadius).toBe("3px");
    expect(resolved.traits.borderWidth).toBe("1px");
    expect(resolved.traits.focusStyle).toBe("ring");
    expect(resolved.traits.uiFontSmoothing).toBe("antialiased");
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

    it("applies kde theme, stamping data-theme-skin and injecting stylesheet", () => {
      applyTheme(kdeTheme, "light");
      expect(mockRoot.getAttribute("data-theme-skin")).toBe("kde");
      const styleEl = document.getElementById(SKIN_STYLE_ELEMENT_ID);
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain('[data-theme-skin="kde"] header');

      clearTheme();
      expect(mockRoot.getAttribute("data-theme-skin")).toBeNull();
      expect(document.getElementById(SKIN_STYLE_ELEMENT_ID)).toBeNull();
    });
  });
});
