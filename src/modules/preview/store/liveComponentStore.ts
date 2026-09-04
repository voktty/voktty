import { create } from "zustand";
import type { LiveComponentMetadata } from "../types";

export function formatComponentBadgeLabel(comp: LiveComponentMetadata): string {
  if (comp.componentName) {
    return `<${comp.componentName}>`;
  }
  if (comp.idAttr) {
    return `${comp.tagName}#${comp.idAttr}`;
  }
  if (comp.classList && comp.classList.length > 0) {
    return `${comp.tagName}.${comp.classList[0]}`;
  }
  return comp.tagName;
}

export function formatComponentLocation(comp: LiveComponentMetadata): string {
  if (comp.filePath) {
    const file = comp.filePath.replace(/^.*[\\/]/, "");
    if (comp.lineNumber) {
      return `${file}:${comp.lineNumber}`;
    }
    return file;
  }
  return comp.selector;
}

export function formatComponentPromptDirective(comp: LiveComponentMetadata): string {
  const parts: string[] = ["[TARGET COMPONENT CONTEXT]"];

  if (comp.componentName) {
    parts.push(`Component: <${comp.componentName}>`);
  }
  if (comp.filePath) {
    const loc = comp.lineNumber ? `:${comp.lineNumber}` : "";
    parts.push(`Source File: ${comp.filePath}${loc}`);
  }
  if (comp.framework !== "dom-generic") {
    parts.push(`Framework: ${comp.framework}`);
  }
  parts.push(`Selector: ${comp.selector}`);
  if (comp.innerText) {
    parts.push(`Visible Text: "${comp.innerText}"`);
  }
  if (comp.htmlSnippet) {
    parts.push(`HTML Snippet: \`${comp.htmlSnippet}\``);
  }
  if (comp.propsSummary && Object.keys(comp.propsSummary).length > 0) {
    parts.push(`Props: ${JSON.stringify(comp.propsSummary)}`);
  }
  if (comp.hierarchy && comp.hierarchy.length > 1) {
    parts.push(`Hierarchy: ${comp.hierarchy.join(" > ")}`);
  }
  parts.push(
    "Directive: The user's request applies specifically to this targeted component and its immediate implementation in the codebase. Modify only the targeted component/source without altering unrelated code.",
  );

  return parts.join("\n");
}

export function formatCandidateGrepQuery(comp: LiveComponentMetadata): string[] {
  const queries: string[] = [];

  if (comp.componentName) {
    queries.push(`function ${comp.componentName}`);
    queries.push(`const ${comp.componentName}`);
    queries.push(`<${comp.componentName}`);
  }
  if (comp.idAttr) {
    queries.push(`id="${comp.idAttr}"`);
    queries.push(`id='${comp.idAttr}'`);
    queries.push(`id: "${comp.idAttr}"`);
  }
  if (comp.classList.length > 0) {
    queries.push(comp.classList[0]);
  }
  if (comp.innerText && comp.innerText.length >= 4 && comp.innerText.length <= 40) {
    queries.push(comp.innerText);
  }

  return Array.from(new Set(queries));
}

export interface LiveComponentState {
  selectedComponent: LiveComponentMetadata | null;
  isInspectorActive: boolean;
  history: LiveComponentMetadata[];
  setSelectedComponent: (comp: LiveComponentMetadata | null) => void;
  setInspectorActive: (active: boolean) => void;
  toggleInspector: () => void;
  clearSelection: () => void;
}

export const useLiveComponentStore = create<LiveComponentState>((set) => ({
  selectedComponent: null,
  isInspectorActive: false,
  history: [],
  setSelectedComponent: (comp) =>
    set((state) => {
      if (!comp) return { selectedComponent: null };
      const filtered = state.history.filter((h) => h.id !== comp.id);
      return {
        selectedComponent: comp,
        history: [comp, ...filtered].slice(0, 20),
        isInspectorActive: false,
      };
    }),
  setInspectorActive: (active) => set({ isInspectorActive: active }),
  toggleInspector: () =>
    set((state) => ({ isInspectorActive: !state.isInspectorActive })),
  clearSelection: () => set({ selectedComponent: null }),
}));
