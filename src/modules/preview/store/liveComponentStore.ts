import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { LiveComponentMetadata } from "../types";
import { useWebServerStore } from "./webServerStore";

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
  if (comp.isResolvingSource) {
    return "Buscando archivo...";
  }
  return comp.selector;
}

export function formatComponentReference(comp: LiveComponentMetadata): string {
  const tagLabel = comp.componentName
    ? `<${comp.componentName}/>`
    : comp.idAttr
      ? `<${comp.tagName}#${comp.idAttr}/>`
      : comp.classList && comp.classList.length > 0
        ? `<${comp.tagName}.${comp.classList.join(".")}/>`
        : `<${comp.tagName}/>`;

  const details: string[] = [];
  if (comp.selector && comp.selector !== comp.tagName) {
    details.push(`selector: \`${comp.selector}\``);
  }
  if (
    comp.innerText &&
    comp.innerText.trim().length > 0 &&
    comp.innerText.trim().length <= 40
  ) {
    details.push(`text: "${comp.innerText.trim()}"`);
  }

  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";

  if (comp.filePath) {
    const loc = comp.lineNumber ? `:${comp.lineNumber}` : "";
    return `@component ${tagLabel} in ${comp.filePath}${loc}${suffix}`;
  }
  return `@dom ${tagLabel}${suffix}`;
}

export function formatComponentDebugPrompt(comp: LiveComponentMetadata): string {
  const parts: string[] = [
    "### 🐛 Solicitud de Diagnóstico y Depuración",
    `- **Elemento**: \`<${comp.componentName || comp.tagName || "element"}>\``,
  ];

  if (comp.filePath) {
    const loc = comp.lineNumber ? `:${comp.lineNumber}` : "";
    parts.push(`- **Archivo**: \`${comp.filePath}${loc}\``);
  }
  if (comp.framework && comp.framework !== "dom-generic") {
    parts.push(`- **Framework / Tipo**: \`${comp.framework.toUpperCase()}\``);
  }
  parts.push(`- **Selector DOM**: \`${comp.selector}\``);
  if (comp.innerText) {
    parts.push(`- **Texto visible**: "${comp.innerText.trim()}"`);
  }
  if (comp.htmlSnippet) {
    parts.push(`- **HTML del elemento**:\n\`\`\`html\n${comp.htmlSnippet.trim()}\n\`\`\``);
  }
  if (comp.propsSummary && Object.keys(comp.propsSummary).length > 0) {
    parts.push(`- **Props / Atributos**: \`${JSON.stringify(comp.propsSummary)}\``);
  }
  parts.push(
    "- **Problema / Fallo detectado**:\n[Describe aquí el fallo visual, error de funcionalidad o comportamiento inesperado]",
    "- **Objetivo**:\nAnaliza la causa raíz y proporciona la corrección de código exacta en el archivo correspondiente.",
  );

  return parts.join("\n");
}

export function formatComponentModifyPrompt(comp: LiveComponentMetadata): string {
  const parts: string[] = [
    "### 💡 Instrucción de Modificación de Componente",
    `- **Elemento**: \`<${comp.componentName || comp.tagName || "element"}>\``,
  ];

  if (comp.filePath) {
    const loc = comp.lineNumber ? `:${comp.lineNumber}` : "";
    parts.push(`- **Archivo**: \`${comp.filePath}${loc}\``);
  }
  if (comp.framework && comp.framework !== "dom-generic") {
    parts.push(`- **Framework / Tipo**: \`${comp.framework.toUpperCase()}\``);
  }
  parts.push(`- **Selector DOM**: \`${comp.selector}\``);
  if (comp.innerText) {
    parts.push(`- **Texto visible**: "${comp.innerText.trim()}"`);
  }
  if (comp.htmlSnippet) {
    parts.push(`- **HTML actual**:\n\`\`\`html\n${comp.htmlSnippet.trim()}\n\`\`\``);
  }
  parts.push(
    "- **Cambios solicitados**:\n[Describe aquí los cambios requeridos en diseño, estilos CSS, estructura HTML o lógica]",
    "- **Requisito**:\nModifica únicamente este componente/sección respetando el resto del proyecto.",
  );

  return parts.join("\n");
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
  if (comp.classList && comp.classList.length > 0) {
    queries.push(comp.classList[0]);
  }
  if (comp.innerText && comp.innerText.length >= 4 && comp.innerText.length <= 40) {
    queries.push(comp.innerText);
  }

  return Array.from(new Set(queries));
}

export interface ResolvedSourceResult {
  file_path: string;
  relative_path: string;
  line_number: number;
  column_number: number;
  framework: string;
  matched_by: string;
}

export async function resolveElementSource(
  comp: LiveComponentMetadata,
  workspaceRoot?: string | null,
): Promise<ResolvedSourceResult | null> {
  if (comp.filePath) return null;
  try {
    let root = workspaceRoot || "";
    if (!root && comp.url) {
      const servers = useWebServerStore.getState().servers;
      for (const s of Object.values(servers)) {
        if (comp.url.includes(`:${s.port}`)) {
          root = s.root_path;
          break;
        }
      }
    }
    const result = await invoke<ResolvedSourceResult | null>(
      "web_server_resolve_element_source",
      {
        root: root || null,
        url: comp.url || null,
        tagName: comp.tagName,
        idAttr: comp.idAttr || null,
        classes: comp.classList || [],
        parentClasses: comp.parentClasses || null,
        textSnippet: comp.innerText || comp.htmlSnippet || null,
      },
    );
    return result;
  } catch (err) {
    console.debug("[LiveComponentStore] Source resolution skipped:", err);
    return null;
  }
}

export interface LiveComponentState {
  selectedComponent: LiveComponentMetadata | null;
  isInspectorActive: boolean;
  history: LiveComponentMetadata[];
  activeWorkspaceRoot: string | null;
  setActiveWorkspaceRoot: (root: string | null) => void;
  setSelectedComponent: (
    comp: LiveComponentMetadata | null,
    workspaceRoot?: string | null,
  ) => void;
  setInspectorActive: (active: boolean) => void;
  toggleInspector: () => void;
  clearSelection: () => void;
}

export const useLiveComponentStore = create<LiveComponentState>((set, get) => ({
  selectedComponent: null,
  isInspectorActive: false,
  history: [],
  activeWorkspaceRoot: null,
  setActiveWorkspaceRoot: (root) => set({ activeWorkspaceRoot: root }),
  setSelectedComponent: (comp, workspaceRoot) => {
    if (!comp) {
      set({ selectedComponent: null });
      return;
    }
    const root = workspaceRoot ?? get().activeWorkspaceRoot;
    const isResolving = !comp.filePath;
    const initialComp: LiveComponentMetadata = {
      ...comp,
      isResolvingSource: isResolving,
    };
    const filtered = get().history.filter((h) => h.id !== comp.id);
    set({
      selectedComponent: initialComp,
      history: [initialComp, ...filtered].slice(0, 20),
      isInspectorActive: false,
    });

    if (isResolving) {
      void resolveElementSource(comp, root).then((resolved) => {
        if (resolved && get().selectedComponent?.id === comp.id) {
          set((state) => {
            if (
              !state.selectedComponent ||
              state.selectedComponent.id !== comp.id
            ) {
              return state;
            }
            const updated: LiveComponentMetadata = {
              ...state.selectedComponent,
              filePath: resolved.relative_path || resolved.file_path,
              lineNumber: resolved.line_number,
              columnNumber: resolved.column_number,
              framework:
                (resolved.framework as LiveComponentMetadata["framework"]) ||
                state.selectedComponent.framework,
              matchedBy: resolved.matched_by,
              isResolvingSource: false,
            };
            return {
              selectedComponent: updated,
              history: state.history.map((h) =>
                h.id === comp.id ? updated : h,
              ),
            };
          });
        } else if (get().selectedComponent?.id === comp.id) {
          set((state) => {
            if (
              !state.selectedComponent ||
              state.selectedComponent.id !== comp.id
            ) {
              return state;
            }
            return {
              selectedComponent: {
                ...state.selectedComponent,
                isResolvingSource: false,
              },
            };
          });
        }
      });
    }
  },
  setInspectorActive: (active) => set({ isInspectorActive: active }),
  toggleInspector: () =>
    set((state) => ({ isInspectorActive: !state.isInspectorActive })),
  clearSelection: () => set({ selectedComponent: null }),
}));
