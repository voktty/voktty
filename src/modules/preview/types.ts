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
  right?: number;
  bottom?: number;
};

export type DomBreadcrumbItem = {
  tagName: string;
  id?: string;
  className?: string;
  selector: string;
  componentName?: string;
};

export type BoxModel = {
  margin: { top: number; right: number; bottom: number; left: number };
  padding: { top: number; right: number; bottom: number; left: number };
  border: { top: number; right: number; bottom: number; left: number };
};

export type ComputedStylesSummary = {
  display?: string;
  position?: string;
  width?: string;
  height?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  lineHeight?: string;
  zIndex?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  gridTemplateColumns?: string;
  borderRadius?: string;
  border?: string;
  [key: string]: string | undefined;
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
  breadcrumbs?: DomBreadcrumbItem[];
  rect?: ComponentRect;
  boundingBox?: ComponentRect;
  styles?: ComputedStylesSummary;
  boxModel?: BoxModel;
  matchedBy?: string;
  isResolvingSource?: boolean;
};

export type ConsoleLogLevel = "log" | "info" | "warn" | "error";

export type ConsoleEntry = {
  id: string;
  level: ConsoleLogLevel;
  message: string;
  stack?: string;
  timestamp: number;
  count: number;
  source?: {
    file?: string;
    line?: number;
    column?: number;
  };
};

export type ViewportMode =
  | "responsive"
  | "mobile"
  | "tablet"
  | "laptop"
  | "desktop"
  | "custom";

export type ViewportPreset = {
  id: string;
  name: string;
  category: "mobile" | "tablet" | "laptop" | "desktop";
  width: number;
  height: number;
  devicePixelRatio?: number;
};

export type InspectorInboundMessage =
  | {
      type: "VOKTTY_LIVE_COMPONENT_SELECTED";
      payload: LiveComponentMetadata;
      autoJump?: boolean;
    }
  | {
      type: "VOKTTY_INSPECTOR_STATE_CHANGE";
      payload: { active: boolean };
    }
  | {
      type: "VOKTTY_CONSOLE_ENTRY";
      payload: ConsoleEntry;
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
    }
  | {
      type: "VOKTTY_NAVIGATED";
      payload: { url: string };
    }
  | {
      type: "VOKTTY_RELOAD_PREVIEW";
    };

export type InspectorOutboundMessage =
  | {
      type: "VOKTTY_SET_INSPECTOR_ACTIVE";
      active: boolean;
    }
  | {
      type: "VOKTTY_HIGHLIGHT_ELEMENT";
      selector: string;
    }
  | {
      type: "VOKTTY_SELECT_ELEMENT_BY_SELECTOR";
      selector: string;
      autoJump?: boolean;
    };

