import { beforeEach, describe, expect, it } from "vitest";
import type { LiveComponentMetadata } from "../types";
import {
  formatCandidateGrepQuery,
  formatComponentBadgeLabel,
  formatComponentLocation,
  formatComponentPromptDirective,
  useLiveComponentStore,
} from "./liveComponentStore";

const mockComponent: LiveComponentMetadata = {
  id: "test-1",
  timestamp: 12345678,
  url: "http://localhost:3000/app",
  componentName: "CheckoutButton",
  filePath: "src/components/CheckoutButton.tsx",
  lineNumber: 42,
  columnNumber: 3,
  framework: "react",
  selector: "button.checkout-btn.primary",
  tagName: "button",
  idAttr: "pay-now",
  classList: ["checkout-btn", "primary"],
  htmlSnippet: "<button id=\"pay-now\" class=\"checkout-btn primary\">Pay $50</button>",
  innerText: "Pay $50",
  attributes: { type: "submit" },
  propsSummary: { variant: "primary", disabled: false },
  hierarchy: ["App", "CheckoutPage", "CheckoutButton"],
};

describe("liveComponentStore", () => {
  beforeEach(() => {
    useLiveComponentStore.setState({
      selectedComponent: null,
      isInspectorActive: false,
      history: [],
    });
  });

  it("updates selectedComponent and deactivates inspector", () => {
    useLiveComponentStore.getState().setInspectorActive(true);
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(true);

    useLiveComponentStore.getState().setSelectedComponent(mockComponent);

    expect(useLiveComponentStore.getState().selectedComponent).toEqual(
      mockComponent,
    );
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(false);
    expect(useLiveComponentStore.getState().history).toHaveLength(1);
  });

  it("toggles inspector state", () => {
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(false);
    useLiveComponentStore.getState().toggleInspector();
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(true);
    useLiveComponentStore.getState().toggleInspector();
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(false);
  });

  it("clears selection", () => {
    useLiveComponentStore.getState().setSelectedComponent(mockComponent);
    expect(useLiveComponentStore.getState().selectedComponent).not.toBeNull();

    useLiveComponentStore.getState().clearSelection();
    expect(useLiveComponentStore.getState().selectedComponent).toBeNull();
  });

  it("formats badge label correctly", () => {
    expect(formatComponentBadgeLabel(mockComponent)).toBe("<CheckoutButton>");

    const domOnly: LiveComponentMetadata = {
      ...mockComponent,
      componentName: undefined,
      idAttr: "submit-btn",
    };
    expect(formatComponentBadgeLabel(domOnly)).toBe("button#submit-btn");

    const classOnly: LiveComponentMetadata = {
      ...domOnly,
      idAttr: undefined,
    };
    expect(formatComponentBadgeLabel(classOnly)).toBe("button.checkout-btn");
  });

  it("formats component location", () => {
    expect(formatComponentLocation(mockComponent)).toBe("CheckoutButton.tsx:42");

    const noFile: LiveComponentMetadata = {
      ...mockComponent,
      filePath: undefined,
    };
    expect(formatComponentLocation(noFile)).toBe("button.checkout-btn.primary");
  });

  it("formats prompt directive with complete targeted context", () => {
    const directive = formatComponentPromptDirective(mockComponent);
    expect(directive).toContain("[TARGET COMPONENT CONTEXT]");
    expect(directive).toContain("Component: <CheckoutButton>");
    expect(directive).toContain("Source File: src/components/CheckoutButton.tsx:42");
    expect(directive).toContain("Framework: react");
    expect(directive).toContain("Selector: button.checkout-btn.primary");
    expect(directive).toContain("Visible Text: \"Pay $50\"");
    expect(directive).toContain("Directive: The user\'s request applies specifically to this targeted component");
  });

  it("generates candidate grep queries for ambiguous components", () => {
    const queries = formatCandidateGrepQuery(mockComponent);
    expect(queries).toContain("function CheckoutButton");
    expect(queries).toContain("<CheckoutButton");
    expect(queries).toContain("id=\"pay-now\"");
    expect(queries).toContain("checkout-btn");
    expect(queries).toContain("Pay $50");
  });
});
