import { beforeEach, describe, expect, it } from "vitest";
import type { LiveComponentMetadata } from "../types";
import {
  formatCandidateGrepQuery,
  formatComponentBadgeLabel,
  formatComponentDebugPrompt,
  formatComponentLocation,
  formatComponentModifyPrompt,
  formatComponentPromptDirective,
  formatComponentReference,
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

    expect(useLiveComponentStore.getState().selectedComponent).toMatchObject(
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

  it("formats component reference for copying", () => {
    expect(formatComponentReference(mockComponent)).toBe(
      "@component <CheckoutButton/> in src/components/CheckoutButton.tsx:42 (selector: `button.checkout-btn.primary`, text: \"Pay $50\")",
    );

    const noFile: LiveComponentMetadata = {
      ...mockComponent,
      filePath: undefined,
    };
    expect(formatComponentReference(noFile)).toBe(
      "@dom <CheckoutButton/> (selector: `button.checkout-btn.primary`, text: \"Pay $50\")",
    );
  });

  it("formats component debug and modify prompts", () => {
    const debugPrompt = formatComponentDebugPrompt(mockComponent);
    expect(debugPrompt).toContain("### 🐛 Solicitud de Diagnóstico y Depuración");
    expect(debugPrompt).toContain("CheckoutButton");
    expect(debugPrompt).toContain("src/components/CheckoutButton.tsx:42");
    expect(debugPrompt).toContain("button.checkout-btn.primary");

    const modifyPrompt = formatComponentModifyPrompt(mockComponent);
    expect(modifyPrompt).toContain("### 💡 Instrucción de Modificación de Componente");
    expect(modifyPrompt).toContain("CheckoutButton");
    expect(modifyPrompt).toContain("src/components/CheckoutButton.tsx:42");
  });

  it("formats candidate grep queries", () => {
    const queries = formatCandidateGrepQuery(mockComponent);
    expect(queries).toContain("function CheckoutButton");
    expect(queries).toContain("<CheckoutButton");
    expect(queries).toContain('id="pay-now"');
    expect(queries).toContain("checkout-btn");
    expect(queries).toContain("Pay $50");
  });
});
