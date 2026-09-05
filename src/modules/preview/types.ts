export type FrameworkType =
  | "react"
  | "vue"
  | "svelte"
  | "astro"
  | "blade"
  | "php"
  | "template"
  | "dom-generic";

export type ComponentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
};

export type LiveComponentMetadata = {
  id: string;
  timestamp: number;
  url: string;
  componentName?: string;
  filePath?: string;
  absolutePath?: string;
  lineNumber?: number;
  columnNumber?: number;
  framework: FrameworkType;
  selector: string;
  tagName: string;
  idAttr?: string;
  classList: string[];
  parentClasses?: string[];
  htmlSnippet: string;
  innerText: string;
  attributes: Record<string, string>;
  propsSummary?: Record<string, unknown>;
  hierarchy: string[];
  rect?: ComponentRect;
  matchedBy?: string;
  isResolvingSource?: boolean;
};

export type InspectorInboundMessage =
  | {
      type: "VOKTTY_LIVE_COMPONENT_SELECTED";
      payload: LiveComponentMetadata;
    }
  | {
      type: "VOKTTY_INSPECTOR_STATE_CHANGE";
      payload: { active: boolean };
    }
  | {
      type: "VOKTTY_INSPECTOR_HOVER";
      payload: {
        tagName: string;
        componentName?: string;
        filePath?: string;
        lineNumber?: number;
        rect: ComponentRect;
      } | null;
    };

export type InspectorOutboundMessage =
  | {
      type: "VOKTTY_SET_INSPECTOR_ACTIVE";
      active: boolean;
    }
  | {
      type: "VOKTTY_HIGHLIGHT_ELEMENT";
      selector: string;
    };
