import { describe, expect, it } from "vitest";
import {
  extractDomMetadata,
  generateCssSelector,
  getInspectorInjectedScript,
  type InspectableElement,
} from "./inspectorScript";

describe("inspectorScript: DOM & Framework extraction", () => {
  it("generates CSS selector using element ID when unique", () => {
    const el: InspectableElement = {
      tagName: "DIV",
      id: "main-header",
    };
    expect(generateCssSelector(el)).toBe("#main-header");
  });

  it("generates hierarchical selector using classes and tags", () => {
    const parent: InspectableElement = {
      tagName: "SECTION",
      classList: ["hero-banner"],
    };
    const child: InspectableElement = {
      tagName: "BUTTON",
      classList: ["btn-primary", "cta-action"],
      parentElement: parent,
    };

    const selector = generateCssSelector(child);
    expect(selector).toBe("section.hero-banner > button.btn-primary.cta-action");
  });

  it("extracts DOM metadata from generic HTML element", () => {
    const el: InspectableElement = {
      tagName: "BUTTON",
      id: "checkout-btn",
      classList: ["btn", "btn-primary"],
      attributes: [
        { name: "type", value: "submit" },
        { name: "data-test", value: "pay" },
        { name: "class", value: "btn btn-primary" },
      ],
      innerText: "Pay Now $49.00",
      outerHTML: "<button id=\"checkout-btn\" class=\"btn btn-primary\" type=\"submit\" data-test=\"pay\">Pay Now $49.00</button>",
      getBoundingClientRect: () => ({
        x: 10,
        y: 20,
        width: 120,
        height: 40,
        top: 20,
        left: 10,
      }),
    };

    const meta = extractDomMetadata(el, "http://localhost:3000/cart");

    expect(meta.framework).toBe("dom-generic");
    expect(meta.tagName).toBe("button");
    expect(meta.idAttr).toBe("checkout-btn");
    expect(meta.classList).toEqual(["btn", "btn-primary"]);
    expect(meta.innerText).toBe("Pay Now $49.00");
    expect(meta.attributes["type"]).toBe("submit");
    expect(meta.attributes["data-test"]).toBe("pay");
    expect(meta.url).toBe("http://localhost:3000/cart");
    expect(meta.rect?.width).toBe(120);
  });

  it("extracts metadata from Astro elements with data-astro-source-file", () => {
    const astroAttrs: Record<string, string> = {
      "data-astro-source-file": "src/components/Card.astro",
      "data-astro-source-loc": "42:15",
      "data-astro-component": "Card",
    };

    const card: InspectableElement = {
      tagName: "DIV",
      closest: (sel: string) => {
        if (sel === "[data-astro-source-file]") {
          return card;
        }
        return null;
      },
      getAttribute: (name: string) => astroAttrs[name] || null,
      innerText: "Card Content",
    };

    const meta = extractDomMetadata(card);

    expect(meta.framework).toBe("astro");
    expect(meta.filePath).toBe("src/components/Card.astro");
    expect(meta.lineNumber).toBe(42);
    expect(meta.columnNumber).toBe(15);
    expect(meta.componentName).toBe("Card");
  });

  it("extracts metadata from Vue elements with data-v-inspector", () => {
    const vueAttrs: Record<string, string> = {
      "data-v-inspector": "src/components/UserProfile.vue:24:10",
    };

    const vueNode: InspectableElement = {
      tagName: "DIV",
      closest: (sel: string) => {
        if (sel === "[data-v-inspector]") {
          return vueNode;
        }
        return null;
      },
      getAttribute: (name: string) => vueAttrs[name] || null,
      innerText: "User Profile View",
    };

    const meta = extractDomMetadata(vueNode);

    expect(meta.framework).toBe("vue");
    expect(meta.filePath).toBe("src/components/UserProfile.vue");
    expect(meta.lineNumber).toBe(24);
    expect(meta.columnNumber).toBe(10);
  });

  it("extracts React Fiber metadata when present", () => {
    const fiberNode = {
      type: {
        displayName: "OrderButton",
      },
      memoizedProps: {
        variant: "primary",
        disabled: false,
      },
      _debugSource: {
        fileName: "src/components/OrderButton.tsx",
        lineNumber: 88,
        columnNumber: 5,
      },
    };

    const reactEl: InspectableElement = {
      tagName: "BUTTON",
      innerText: "Submit Order",
      __reactFiber$test: fiberNode,
    };

    const meta = extractDomMetadata(reactEl);

    expect(meta.framework).toBe("react");
    expect(meta.componentName).toBe("OrderButton");
    expect(meta.filePath).toBe("src/components/OrderButton.tsx");
    expect(meta.lineNumber).toBe(88);
    expect(meta.columnNumber).toBe(5);
    expect(meta.propsSummary).toEqual({
      variant: "primary",
      disabled: false,
    });
    expect(meta.hierarchy).toContain("OrderButton");
  });

  it("produces valid injected script string", () => {
    const script = getInspectorInjectedScript();
    expect(typeof script).toBe("string");
    expect(script).toContain("VOKTTY_LIVE_COMPONENT_SELECTED");
    expect(script).toContain("VOKTTY_SET_INSPECTOR_ACTIVE");
    expect(script).toContain("voktty-inspector-root");
  });
});
