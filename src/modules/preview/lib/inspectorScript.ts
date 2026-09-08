import type {
  BoxModel,
  ComponentRect,
  DomBreadcrumbItem,
  FrameworkType,
  LiveComponentMetadata,
} from "../types";

export type InspectableElement = {
  tagName: string;
  id?: string;
  className?: string;
  classList?: { length: number; [index: number]: string } | Iterable<string>;
  attributes?:
    | Array<{ name: string; value: string }>
    | { length: number; [index: number]: { name: string; value: string } };
  parentElement?: InspectableElement | null;
  closest?: (selector: string) => InspectableElement | null;
  getAttribute?: (name: string) => string | null;
  innerText?: string;
  textContent?: string | null;
  outerHTML?: string;
  getBoundingClientRect?: () => {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
  };
  nodeType?: number;
  [key: string]: unknown;
};

export function generateCssSelector(el: InspectableElement): string {
  if (el.id && /^[A-Za-z_-][\w-]*$/.test(el.id)) {
    return `#${el.id}`;
  }

  const parts: string[] = [];
  let current: InspectableElement | null = el;
  let depth = 0;

  while (current && depth < 4) {
    const tag = (current.tagName || "").toLowerCase();
    if (tag === "body" || tag === "html" || !tag) {
      break;
    }

    let part = tag;
    if (current.id && /^[A-Za-z_-][\w-]*$/.test(current.id)) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }

    const classArray = Array.from(current.classList || [])
      .filter(
        (c) => !c.startsWith("voktty-") && !c.includes(":") && !c.includes("/"),
      )
      .slice(0, 2);
    if (classArray.length > 0) {
      part += `.${classArray.join(".")}`;
    }

    parts.unshift(part);
    current = current.parentElement ?? null;
    depth++;
  }

  return parts.join(" > ") || (el.tagName ? el.tagName.toLowerCase() : "element");
}

type ReactFiberNode = {
  type?:
    | {
        displayName?: string;
        name?: string;
      }
    | string
    | unknown;
  memoizedProps?: Record<string, unknown>;
  _debugSource?: {
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  _debugOwner?: ReactFiberNode;
  return?: ReactFiberNode | null;
};

export function extractReactFiberMetadata(el: InspectableElement): {
  componentName?: string;
  filePath?: string;
  lineNumber?: number;
  columnNumber?: number;
  propsSummary?: Record<string, unknown>;
  hierarchy: string[];
} {
  const hierarchy: string[] = [];
  let componentName: string | undefined;
  let filePath: string | undefined;
  let lineNumber: number | undefined;
  let columnNumber: number | undefined;
  let propsSummary: Record<string, unknown> | undefined;

  const fiberKey = Object.keys(el).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$"),
  );

  if (!fiberKey) {
    return { hierarchy };
  }

  let fiber = (el as unknown as Record<string, unknown>)[fiberKey] as
    | ReactFiberNode
    | null
    | undefined;

  while (fiber) {
    const fiberType = fiber.type;
    let name: string | undefined;

    if (typeof fiberType === "function") {
      const fn = fiberType as { displayName?: string; name?: string };
      name = fn.displayName || fn.name;
    } else if (
      fiberType &&
      typeof fiberType === "object" &&
      "displayName" in (fiberType as Record<string, unknown>)
    ) {
      name = (fiberType as { displayName?: string }).displayName;
    }

    if (
      name &&
      name !== "Fragment" &&
      name !== "Suspense" &&
      !name.startsWith("_")
    ) {
      hierarchy.unshift(name);
      if (!componentName) {
        componentName = name;
        if (fiber.memoizedProps && typeof fiber.memoizedProps === "object") {
          const summary: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fiber.memoizedProps)) {
            if (k === "children" || typeof v === "function") continue;
            if (
              typeof v === "string" ||
              typeof v === "number" ||
              typeof v === "boolean"
            ) {
              summary[k] = v;
            } else if (v === null || v === undefined) {
              summary[k] = v;
            }
          }
          if (Object.keys(summary).length > 0) {
            propsSummary = summary;
          }
        }
      }
    }

    if (!filePath && fiber._debugSource) {
      filePath = fiber._debugSource.fileName;
      lineNumber = fiber._debugSource.lineNumber;
      columnNumber = fiber._debugSource.columnNumber;
    }

    fiber = fiber.return;
  }

  return {
    componentName,
    filePath,
    lineNumber,
    columnNumber,
    propsSummary,
    hierarchy,
  };
}

export function extractBoxModel(
  style: CSSStyleDeclaration | null | undefined,
): BoxModel | undefined {
  if (!style) return undefined;
  const parse = (v: string | undefined) => (v ? parseFloat(v) || 0 : 0);
  return {
    margin: {
      top: parse(style.marginTop),
      right: parse(style.marginRight),
      bottom: parse(style.marginBottom),
      left: parse(style.marginLeft),
    },
    padding: {
      top: parse(style.paddingTop),
      right: parse(style.paddingRight),
      bottom: parse(style.paddingBottom),
      left: parse(style.paddingLeft),
    },
    border: {
      top: parse(style.borderTopWidth),
      right: parse(style.borderRightWidth),
      bottom: parse(style.borderBottomWidth),
      left: parse(style.borderLeftWidth),
    },
  };
}

export function buildBreadcrumbs(
  element: InspectableElement,
): DomBreadcrumbItem[] {
  const crumbs: DomBreadcrumbItem[] = [];
  let curr: InspectableElement | null = element;
  while (curr && crumbs.length < 6) {
    const tag = (curr.tagName || "").toLowerCase();
    if (!tag || tag === "html" || tag === "#document") break;
    const id =
      curr.id && /^[A-Za-z_-][\w-]*$/.test(curr.id) ? curr.id : undefined;
    const classArray = Array.from(
      (curr.classList as unknown as string[]) || [],
    ).filter((c) => !c.startsWith("voktty-") && !c.includes(":"));
    const cls = classArray.length > 0 ? classArray[0] : undefined;

    let reactName: string | undefined;
    try {
      const fMeta = extractReactFiberMetadata(curr);
      if (fMeta && fMeta.componentName) reactName = fMeta.componentName;
    } catch (_) {}

    crumbs.unshift({
      tagName: tag,
      id,
      className: cls,
      selector: generateCssSelector(curr),
      componentName: reactName,
    });
    curr = curr.parentElement ?? null;
  }
  return crumbs;
}

export function extractDomMetadata(
  element: InspectableElement,
  url: string = typeof window !== "undefined" ? window.location?.href ?? "about:blank" : "about:blank",
): LiveComponentMetadata {
  const tagName = (element.tagName || "div").toLowerCase();
  const idAttr = element.id || undefined;
  const classList = Array.from(element.classList || []).filter(
    (c) => !c.startsWith("voktty-"),
  );
  const selector = generateCssSelector(element);

  const attributes: Record<string, string> = {};
  if (element.attributes) {
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (!attr || !attr.name) continue;
      if (
        attr.name === "class" ||
        attr.name === "id" ||
        attr.name.startsWith("voktty-")
      ) {
        continue;
      }
      if (
        attr.name === "href" ||
        attr.name === "src" ||
        attr.name === "type" ||
        attr.name === "name" ||
        attr.name === "role" ||
        attr.name === "placeholder" ||
        attr.name === "title" ||
        attr.name === "aria-label" ||
        attr.name.startsWith("data-")
      ) {
        attributes[attr.name] = attr.value;
      }
    }
  }

  let framework: FrameworkType = "dom-generic";
  let componentName: string | undefined;
  let filePath: string | undefined;
  let lineNumber: number | undefined;
  let columnNumber: number | undefined;
  let propsSummary: Record<string, unknown> | undefined;
  let hierarchy: string[] = [];

  const astroEl = typeof element.closest === "function"
    ? element.closest("[data-astro-source-file]")
    : null;
  if (astroEl && typeof astroEl.getAttribute === "function") {
    framework = "astro";
    filePath = astroEl.getAttribute("data-astro-source-file") || undefined;
    const loc = astroEl.getAttribute("data-astro-source-loc");
    if (loc) {
      const parts = loc.split(":");
      lineNumber = parseInt(parts[0], 10) || undefined;
      columnNumber = parseInt(parts[1], 10) || undefined;
    }
    componentName = astroEl.getAttribute("data-astro-component") || undefined;
  }

  const vueEl = typeof element.closest === "function"
    ? element.closest("[data-v-inspector]")
    : null;
  if (!filePath && vueEl && typeof vueEl.getAttribute === "function") {
    framework = "vue";
    const insp = vueEl.getAttribute("data-v-inspector");
    if (insp) {
      const parts = insp.split(":");
      filePath = parts[0] || undefined;
      lineNumber = parseInt(parts[1], 10) || undefined;
      columnNumber = parseInt(parts[2], 10) || undefined;
    }
  }

  if (!filePath && typeof element.closest === "function") {
    const svelteEl = element.closest("[data-svelte-h], [data-svelte-component]");
    if (svelteEl && typeof svelteEl.getAttribute === "function") {
      framework = "svelte";
      componentName = svelteEl.getAttribute("data-svelte-component") || undefined;
    }
  }

  const reactMeta = extractReactFiberMetadata(element);
  if (
    reactMeta.componentName ||
    reactMeta.filePath ||
    reactMeta.hierarchy.length > 0
  ) {
    framework = "react";
    if (!componentName) componentName = reactMeta.componentName;
    if (!filePath) filePath = reactMeta.filePath;
    if (lineNumber === undefined) lineNumber = reactMeta.lineNumber;
    if (columnNumber === undefined) columnNumber = reactMeta.columnNumber;
    if (!propsSummary) propsSummary = reactMeta.propsSummary;
    hierarchy = reactMeta.hierarchy;
  }

  if (hierarchy.length === 0) {
    hierarchy = [tagName];
  }

  let innerText = (element.innerText || element.textContent || "").trim();
  if (innerText.length > 200) {
    innerText = `${innerText.slice(0, 197)}...`;
  }

  let htmlSnippet = element.outerHTML || "";
  if (htmlSnippet.length > 350) {
    const openTagMatch = htmlSnippet.match(/^<[a-zA-Z0-9_-]+[^>]*>/);
    const openTag = openTagMatch ? openTagMatch[0] : `<${tagName}>`;
    const closeTag = `</${tagName}>`;
    const snippetContent = innerText ? ` ${innerText} ` : "...";
    htmlSnippet = `${openTag}${snippetContent}${closeTag}`;
  }

  let rect: ComponentRect | undefined;
  if (typeof element.getBoundingClientRect === "function") {
    const r = element.getBoundingClientRect();
    rect = {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      left: r.left,
    };
  }

  const computedStyle =
    typeof window !== "undefined" && window.getComputedStyle
      ? window.getComputedStyle(element as unknown as Element)
      : null;

  const styles: Record<string, string> = {};
  if (computedStyle) {
    const sampleProps = [
      "display",
      "position",
      "flexDirection",
      "justifyContent",
      "alignItems",
      "gap",
      "gridTemplateColumns",
      "width",
      "height",
      "color",
      "backgroundColor",
      "fontSize",
      "fontWeight",
      "fontFamily",
      "lineHeight",
      "zIndex",
      "borderRadius",
      "border",
    ];
    for (const prop of sampleProps) {
      const val = computedStyle[prop as keyof CSSStyleDeclaration];
      if (val && typeof val === "string") {
        styles[prop] = val;
      }
    }
  }

  const boxModel = extractBoxModel(computedStyle);
  const breadcrumbs = buildBreadcrumbs(element);

  const parentClasses: string[] = [];
  let currParent = element.parentElement;
  let depth = 0;
  while (currParent && depth < 3) {
    if (currParent.id) parentClasses.push(`#${currParent.id}`);
    if (currParent.classList) {
      Array.from(currParent.classList).forEach((c) => {
        if (!c.startsWith("voktty-") && !c.includes(":") && !c.includes("/")) {
          parentClasses.push(c);
        }
      });
    }
    currParent = currParent.parentElement;
    depth++;
  }

  return {
    id: `comp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    url,
    componentName,
    filePath,
    lineNumber,
    columnNumber,
    framework,
    selector,
    tagName,
    idAttr,
    classList,
    parentClasses: parentClasses.length > 0 ? parentClasses : undefined,
    htmlSnippet,
    innerText,
    attributes,
    propsSummary,
    hierarchy,
    breadcrumbs,
    rect,
    boundingBox: rect,
    styles,
    boxModel,
  };
}

export type InspectorUiStrings = {
  copied: string;
  copyError: string;
  inspectElement: string;
  elementSelected: string;
  jumpToCode: string;
  openingEditor: string;
  copyReference: string;
  referenceCopied: string;
  copyDebugPrompt: string;
  debugPromptCopied: string;
  copyModifyPrompt: string;
  modifyPromptCopied: string;
  copyCssSelector: string;
  cssCopied: string;
  copyHtml: string;
  htmlCopied: string;
  reloadPreview: string;
  nativeMenuHint: string;
};

const DEFAULT_INSPECTOR_UI: InspectorUiStrings = {
  copied: "Copied to clipboard",
  copyError: "Failed to copy",
  inspectElement: "Inspect element (AI)",
  elementSelected: "Element selected",
  jumpToCode: "Jump to source in the editor",
  openingEditor: "Opening in editor...",
  copyReference: "Copy reference (@component)",
  referenceCopied: "Reference copied",
  copyDebugPrompt: "Copy debug prompt",
  debugPromptCopied: "Debug prompt copied",
  copyModifyPrompt: "Copy modify prompt",
  modifyPromptCopied: "Modify prompt copied",
  copyCssSelector: "Copy CSS selector",
  cssCopied: "CSS selector copied",
  copyHtml: "Copy HTML snippet",
  htmlCopied: "HTML copied",
  reloadPreview: "Reload preview",
  nativeMenuHint: "Shift + right-click for the native menu",
};

export function resolveInspectorUiStrings(
  translate: (key: string) => string,
): InspectorUiStrings {
  return {
    copied: translate("common.textCopied"),
    copyError: translate("preview.copyError"),
    inspectElement: translate("preview.inspectElement"),
    elementSelected: translate("preview.elementSelected"),
    jumpToCode: translate("preview.jumpToCode"),
    openingEditor: translate("preview.jumpingToCode"),
    copyReference: translate("preview.copyReferenceMenu"),
    referenceCopied: translate("preview.referenceCopied"),
    copyDebugPrompt: translate("preview.copyDebugPromptMenu"),
    debugPromptCopied: translate("preview.debugPromptCopied"),
    copyModifyPrompt: translate("preview.copyModifyPromptMenu"),
    modifyPromptCopied: translate("preview.modifyPromptCopied"),
    copyCssSelector: translate("preview.copyCssSelector"),
    cssCopied: translate("preview.badge.cssSelectorCopiedToast"),
    copyHtml: translate("preview.copyHtmlSnippet"),
    htmlCopied: translate("preview.htmlCopied"),
    reloadPreview: translate("preview.reloadPreview"),
    nativeMenuHint: translate("preview.nativeMenuHint"),
  };
}

export function getInspectorInjectedScript(
  hostOrigin: string,
  ui: InspectorUiStrings = DEFAULT_INSPECTOR_UI,
): string {
  return `(function() {
  if (window.__VOKTTY_INSPECTOR_INSTALLED__) return;
  window.__VOKTTY_INSPECTOR_INSTALLED__ = true;
  var __VOKTTY_HOST_ORIGIN__ = ${JSON.stringify(hostOrigin)};
  var I18N = ${JSON.stringify(ui)};
  function postToHost(msg) {
    try {
      window.parent.postMessage(msg, __VOKTTY_HOST_ORIGIN__);
    } catch(_) {}
  }

  // Console & Runtime Error Interception
  (function initConsoleBridge() {
    if (window.__voktty_console_inited) return;
    window.__voktty_console_inited = true;

    function formatArg(arg) {
      if (arg === null) return "null";
      if (arg === undefined) return "undefined";
      if (typeof arg === "string") return arg;
      if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
      if (arg instanceof Error) return (arg.name ? arg.name + ": " : "") + arg.message + (arg.stack ? "\\n" + arg.stack : "");
      try {
        return JSON.stringify(arg, null, 2);
      } catch(_) {
        return String(arg);
      }
    }

    function emitLog(level, args, stack) {
      try {
        var msg = Array.prototype.map.call(args, formatArg).join(" ");
        var entry = {
          id: "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          level: level,
          message: msg,
          stack: stack || undefined,
          timestamp: Date.now()
        };
        postToHost({
          type: "VOKTTY_CONSOLE_ENTRY",
          payload: entry
        });
      } catch(_) {}
    }

    var originalLog = console.log;
    var originalInfo = console.info;
    var originalWarn = console.warn;
    var originalError = console.error;

    console.log = function() {
      originalLog.apply(console, arguments);
      emitLog("log", arguments);
    };
    console.info = function() {
      originalInfo.apply(console, arguments);
      emitLog("info", arguments);
    };
    console.warn = function() {
      originalWarn.apply(console, arguments);
      var stack = (new Error()).stack;
      emitLog("warn", arguments, stack);
    };
    console.error = function() {
      originalError.apply(console, arguments);
      var stack = (new Error()).stack;
      emitLog("error", arguments, stack);
    };

    window.addEventListener("error", function(e) {
      var msg = e.message || "Uncaught runtime error";
      var stack = e.error && e.error.stack ? e.error.stack : (e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : "");
      emitLog("error", [msg], stack);
    });

    window.addEventListener("unhandledrejection", function(e) {
      var reason = e.reason;
      var msg = reason instanceof Error ? (reason.name ? reason.name + ": " : "") + reason.message : String(reason || "Unhandled Promise Rejection");
      var stack = reason instanceof Error && reason.stack ? reason.stack : undefined;
      emitLog("error", [msg], stack);
    });
  })();

  (function initNetworkBridge() {
    if (window.__voktty_network_inited) return;
    window.__voktty_network_inited = true;
    var BODY_CAP = 2048;

    function truncateBody(value) {
      if (value == null) return undefined;
      var text = typeof value === "string" ? value : "";
      if (typeof value !== "string") {
        try { text = JSON.stringify(value); } catch (_) { text = String(value); }
      }
      if (text.length > BODY_CAP) return text.slice(0, BODY_CAP) + "...";
      return text;
    }

    function emitNetwork(entry) {
      postToHost({ type: "VOKTTY_NETWORK_ENTRY", payload: entry });
    }

    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function() {
        var input = arguments[0];
        var init = arguments[1] || {};
        var method = String(init.method || (input && input.method) || "GET").toUpperCase();
        var url = typeof input === "string" ? input : (input && input.url) ? input.url : String(input);
        var started = Date.now();
        var id = "net_" + started + "_" + Math.random().toString(36).slice(2, 6);
        return origFetch.apply(this, arguments).then(function(res) {
          var clone = res.clone();
          var sizeHeader = Number(res.headers.get("content-length")) || 0;
          clone.text().then(function(text) {
            emitNetwork({
              id: id,
              method: method,
              url: url,
              status: res.status,
              durationMs: Date.now() - started,
              size: sizeHeader || text.length,
              body: truncateBody(text),
              timestamp: started
            });
          }).catch(function() {
            emitNetwork({
              id: id,
              method: method,
              url: url,
              status: res.status,
              durationMs: Date.now() - started,
              size: sizeHeader,
              timestamp: started
            });
          });
          return res;
        }, function(err) {
          emitNetwork({
            id: id,
            method: method,
            url: url,
            status: 0,
            durationMs: Date.now() - started,
            size: 0,
            error: String(err && err.message ? err.message : err),
            timestamp: started
          });
          throw err;
        });
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__voktty_method = method;
      this.__voktty_url = url;
      this.__voktty_start = Date.now();
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var xhr = this;
      xhr.addEventListener("loadend", function() {
        var bodyText = "";
        try { bodyText = xhr.responseText || ""; } catch (_) {}
        emitNetwork({
          id: "net_" + (xhr.__voktty_start || Date.now()) + "_" + Math.random().toString(36).slice(2, 6),
          method: String(xhr.__voktty_method || "GET").toUpperCase(),
          url: xhr.__voktty_url || "",
          status: xhr.status || 0,
          durationMs: Date.now() - (xhr.__voktty_start || Date.now()),
          size: bodyText.length,
          body: truncateBody(bodyText),
          timestamp: xhr.__voktty_start || Date.now()
        });
      });
      return origSend.apply(this, arguments);
    };
  })();

  ${generateCssSelector.toString()}
  ${extractReactFiberMetadata.toString()}
  ${extractBoxModel.toString()}
  ${buildBreadcrumbs.toString()}
  ${extractDomMetadata.toString()}

  let active = false;
  let hoveredEl = null;

  const overlayHost = document.createElement("div");
  overlayHost.id = "voktty-inspector-root";
  overlayHost.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  const shadow = overlayHost.attachShadow({ mode: "open" });

  const box = document.createElement("div");
  box.style.cssText = "position:absolute;display:none;pointer-events:none;border:2px solid #06b6d4;background:rgba(6,182,212,0.12);border-radius:4px;box-shadow:0 0 14px rgba(6,182,212,0.45);transition:top 60ms ease-out, left 60ms ease-out, width 60ms ease-out, height 60ms ease-out;z-index:2147483647;";

  const label = document.createElement("div");
  label.style.cssText = "position:absolute;bottom:calc(100% + 4px);left:0;background:#0f172a;color:#38bdf8;padding:2px 8px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid #0284c7;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;";
  box.appendChild(label);
  shadow.appendChild(box);

  const menu = document.createElement("div");
  menu.id = "voktty-context-menu";
  menu.style.cssText = "position:fixed;display:none;min-width:230px;max-width:320px;background:rgba(15,23,42,0.96);color:#f8fafc;border:1px solid #0284c7;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.6),0 0 16px rgba(6,182,212,0.25);padding:6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;z-index:2147483647;backdrop-filter:blur(14px);user-select:none;pointer-events:auto;";
  shadow.appendChild(menu);

  const toastEl = document.createElement("div");
  toastEl.id = "voktty-toast";
  toastEl.style.cssText = "position:fixed;bottom:20px;right:20px;display:none;background:#064e3b;color:#6ee7b7;border:1px solid #059669;padding:6px 14px;border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.5);z-index:2147483647;pointer-events:none;transition:opacity 150ms ease-out;";
  shadow.appendChild(toastEl);

  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = "✓ " + msg;
    toastEl.style.display = "block";
    toastEl.style.opacity = "1";
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = "0";
      setTimeout(() => { toastEl.style.display = "none"; }, 160);
    }, 1600);
  }

  function hideContextMenu() {
    menu.style.display = "none";
  }

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg || I18N.copied);
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) showToast(successMsg || I18N.copied);
    } catch (_) {
      showToast(I18N.copyError);
    }
  }

  function createMenuItem(icon, text, onClick, isDanger) {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;transition:background 100ms;font-size:12px;color:" + (isDanger ? "#fca5a5" : "#e2e8f0") + ";";
    item.innerHTML = "<span style=\"font-size:13px;\">" + icon + "</span><span style=\"flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">" + text + "</span>";
    item.addEventListener("mouseenter", () => {
      item.style.background = isDanger ? "rgba(239,68,68,0.2)" : "rgba(6,182,212,0.18)";
      item.style.color = isDanger ? "#fecaca" : "#38bdf8";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
      item.style.color = isDanger ? "#fca5a5" : "#e2e8f0";
    });
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      hideContextMenu();
      onClick();
    });
    return item;
  }

  function createMenuDivider() {
    const div = document.createElement("div");
    div.style.cssText = "height:1px;background:rgba(255,255,255,0.08);margin:4px 0;";
    return div;
  }

  function showContextMenu(x, y, meta) {
    if (!document.body.contains(overlayHost) && document.body) {
      document.body.appendChild(overlayHost);
    }
    menu.innerHTML = "";

    const tagTitle = "<" + (meta.componentName || meta.tagName) + (meta.idAttr ? "#" + meta.idAttr : (meta.classList && meta.classList[0] ? "." + meta.classList[0] : "")) + "/>";

    const header = document.createElement("div");
    header.style.cssText = "padding:5px 8px 6px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:#38bdf8;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;justify-content:space-between;";
    header.innerHTML = "<span style=\"overflow:hidden;text-overflow:ellipsis;\">" + tagTitle + "</span><span style=\"font-size:9px;text-transform:uppercase;color:#94a3b8;font-family:sans-serif;margin-left:6px;\">" + (meta.framework || "DOM") + "</span>";
    menu.appendChild(header);

    menu.appendChild(createMenuItem("🎯", I18N.inspectElement, () => {
      try {
        postToHost({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        });
        showToast(I18N.elementSelected);
      } catch(_) {}
    }));

    menu.appendChild(createMenuItem("💻", I18N.jumpToCode, () => {
      try {
        postToHost({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta,
          autoJump: true
        });
        showToast(I18N.openingEditor);
      } catch(_) {}
    }));

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("📋", I18N.copyReference, () => {
      const tagLabel = meta.componentName ? ("<" + meta.componentName + "/>") : (meta.idAttr ? ("<" + meta.tagName + "#" + meta.idAttr + "/>") : (meta.classList && meta.classList.length > 0 ? ("<" + meta.tagName + "." + meta.classList.join(".") + "/>") : ("<" + meta.tagName + "/>")));
      let ref = "@component " + tagLabel;
      if (meta.filePath) {
        ref += " in " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "");
      }
      if (meta.selector && meta.selector !== meta.tagName) {
        ref += " (selector: " + meta.selector + ")";
      }
      copyText(ref, I18N.referenceCopied);
    }));

    menu.appendChild(createMenuItem("🐛", I18N.copyDebugPrompt, () => {
      const prompt = [
        "### 🐛 Solicitud de Diagnóstico y Depuración",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: \"" + meta.innerText + "\"") : "",
        meta.htmlSnippet ? ("- **HTML del elemento**:\n" + meta.htmlSnippet) : "",
        "- **Problema**: [Describe aquí el error o fallo visual]"
      ].filter(Boolean).join("\n");
      copyText(prompt, I18N.debugPromptCopied);
    }));

    menu.appendChild(createMenuItem("💡", I18N.copyModifyPrompt, () => {
      const prompt = [
        "### 💡 Instrucción de Modificación de Componente",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: \"" + meta.innerText + "\"") : "",
        meta.htmlSnippet ? ("- **HTML actual**:\n" + meta.htmlSnippet) : "",
        "- **Cambios solicitados**: [Describe aquí los cambios deseados]"
      ].filter(Boolean).join("\n");
      copyText(prompt, I18N.modifyPromptCopied);
    }));

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔍", I18N.copyCssSelector, () => {
      copyText(meta.selector, I18N.cssCopied);
    }));

    if (meta.htmlSnippet) {
      menu.appendChild(createMenuItem("📄", I18N.copyHtml, () => {
        copyText(meta.htmlSnippet, I18N.htmlCopied);
      }));
    }

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔄", I18N.reloadPreview, () => {
      try {
        postToHost({ type: "VOKTTY_RELOAD_PREVIEW" });
      } catch(_) {
        window.location.reload();
      }
    }));

    const footer = document.createElement("div");
    footer.style.cssText = "padding:4px 6px 2px;font-size:10px;color:#64748b;text-align:center;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;";
    footer.textContent = I18N.nativeMenuHint;
    menu.appendChild(footer);

    menu.style.display = "block";

    let posX = x;
    let posY = y;
    const menuWidth = 230;
    const menuHeight = 270;

    if (posX + menuWidth > window.innerWidth) {
      posX = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = Math.max(8, window.innerHeight - menuHeight - 8);
    }

    menu.style.left = posX + "px";
    menu.style.top = posY + "px";
  }

  function handleContextMenu(e) {
    if (e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target && e.target !== overlayHost && !overlayHost.contains(e.target)
      ? e.target
      : document.elementFromPoint(e.clientX, e.clientY);

    if (!target || target === overlayHost || overlayHost.contains(target) || target === document.documentElement) return;

    const meta = extractDomMetadata(target, window.location.href);
    showContextMenu(e.clientX, e.clientY, meta);
  }

  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("click", (e) => {
    if (menu.style.display !== "none" && !menu.contains(e.target)) {
      hideContextMenu();
    }
  }, true);
  window.addEventListener("scroll", hideContextMenu, { passive: true });
  window.addEventListener("resize", hideContextMenu, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContextMenu();
  }, true);

  function updateHighlight(el) {
    if (!el || !active) {
      box.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.top = r.top + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";

    let title = (el.tagName || "").toLowerCase();
    if (el.id) title += "#" + el.id;
    else if (el.classList && el.classList.length > 0) {
      const cls = Array.from(el.classList).slice(0, 1)[0];
      if (cls) title += "." + cls;
    }
    label.textContent = "🎯 " + title;
  }

  function handleMouseMove(e) {
    if (!active) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      if (hoveredEl !== target) {
        hoveredEl = target;
        updateHighlight(target);
      }
    }
  }

  function handleClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = e.target && e.target !== overlayHost && !overlayHost.contains(e.target)
      ? e.target
      : document.elementFromPoint(e.clientX, e.clientY);

    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      const meta = extractDomMetadata(target, window.location.href);
      try {
        postToHost({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        });
      } catch (err) {
        console.warn("[Voktty Inspector] PostMessage failed", err);
      }
      setActive(false);
    }
  }

  function setActive(newActive) {
    active = Boolean(newActive);
    window.__VOKTTY_INSPECTOR_ACTIVE__ = active;
    if (active) {
      if (!document.body.contains(overlayHost) && document.body) {
        document.body.appendChild(overlayHost);
      }
      try {
        document.documentElement.style.setProperty("cursor", "crosshair", "important");
      } catch(_) {}
      document.addEventListener("mousemove", handleMouseMove, true);
      document.addEventListener("click", handleClick, true);
      document.addEventListener("auxclick", handleClick, true);
    } else {
      box.style.display = "none";
      try {
        document.documentElement.style.removeProperty("cursor");
      } catch(_) {}
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("auxclick", handleClick, true);
    }
  }

  window.addEventListener("scroll", function() {
    if (active && hoveredEl) updateHighlight(hoveredEl);
  }, { passive: true });

  window.addEventListener("resize", function() {
    if (active && hoveredEl) updateHighlight(hoveredEl);
  }, { passive: true });

  var SNAPSHOT_LIMIT = 300;
  var snapshotRefs = new Map();
  var snapshotRefSeq = 0;

  function resetSnapshotRefs() {
    snapshotRefs = new Map();
    snapshotRefSeq = 0;
  }

  function rememberRef(el) {
    snapshotRefSeq += 1;
    snapshotRefs.set(
      snapshotRefSeq,
      typeof WeakRef === "function" ? new WeakRef(el) : { deref: function() { return el; } }
    );
    return snapshotRefSeq;
  }

  function resolveCommandTarget(args) {
    args = args || {};
    if (args.ref != null && args.ref !== "") {
      var slot = snapshotRefs.get(Number(args.ref));
      var fromRef = slot && slot.deref ? slot.deref() : null;
      if (fromRef) return fromRef;
    }
    if (args.selector) {
      try { return document.querySelector(args.selector); } catch (_) { return null; }
    }
    return null;
  }

  function accessibleName(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      (el.innerText || el.textContent || "").trim().slice(0, 80)
    );
  }

  function isInteractive(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary") {
      return true;
    }
    if (el.getAttribute("role") || el.getAttribute("onclick") || el.tabIndex >= 0) return true;
    return false;
  }

  function nodeRecord(el) {
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 };
    return {
      ref: rememberRef(el),
      tag: (el.tagName || "").toLowerCase(),
      role: el.getAttribute("role") || undefined,
      name: accessibleName(el) || undefined,
      selector: generateCssSelector(el),
      attributes: {
        id: el.id || undefined,
        className: el.className && typeof el.className === "string" ? el.className : undefined,
        testId: el.getAttribute("data-testid") || undefined,
        href: el.getAttribute("href") || undefined,
        type: el.getAttribute("type") || undefined,
        value: el.value != null && String(el.value).length < 120 ? String(el.value) : undefined
      },
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left
      }
    };
  }

  function takeSnapshot() {
    resetSnapshotRefs();
    var all = Array.prototype.slice.call(document.querySelectorAll("body *"));
    var interactive = [];
    var rest = [];
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (!node || node.id === "voktty-inspector-root") continue;
      if (isInteractive(node) || accessibleName(node)) {
        if (isInteractive(node)) interactive.push(node);
        else rest.push(node);
      }
    }
    var picked = interactive.concat(rest).slice(0, SNAPSHOT_LIMIT);
    var nodes = [];
    for (var j = 0; j < picked.length; j++) nodes.push(nodeRecord(picked[j]));
    return { url: window.location.href, nodes: nodes };
  }

  function nativeSetValue(el, text) {
    var proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function serializeEval(value) {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) + "..." : value;
    try {
      var seen = [];
      return JSON.parse(JSON.stringify(value, function(_key, nested) {
        if (typeof nested === "function") return "[function]";
        if (typeof nested === "object" && nested !== null) {
          if (seen.indexOf(nested) >= 0) return "[cyclic]";
          seen.push(nested);
        }
        return nested;
      }));
    } catch (_) {
      return String(value);
    }
  }

  window.addEventListener("pagehide", resetSnapshotRefs);

  window.addEventListener("message", function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "VOKTTY_SET_INSPECTOR_ACTIVE") {
      setActive(Boolean(e.data.active));
      postToHost({
        type: "VOKTTY_INSPECTOR_STATE_CHANGE",
        payload: { active: active }
      });
    } else if (e.data.type === "VOKTTY_HIGHLIGHT_ELEMENT") {
      if (e.data.selector) {
        try {
          const el = document.querySelector(e.data.selector);
          if (el) updateHighlight(el);
        } catch(_) {}
      }
    } else if (e.data.type === "VOKTTY_SELECT_ELEMENT_BY_SELECTOR") {
      if (e.data.selector) {
        try {
          const el = document.querySelector(e.data.selector);
          if (el) {
            const meta = extractDomMetadata(el, window.location.href);
            postToHost({
              type: "VOKTTY_LIVE_COMPONENT_SELECTED",
              payload: meta,
              autoJump: Boolean(e.data.autoJump)
            });
          }
        } catch(_) {}
      }
    } else if (e.data.type === "VOKTTY_BROWSER_COMMAND") {
      var requestId = e.data.requestId;
      var args = e.data.args || {};
      function reply(ok, result, error) {
        postToHost({
          type: "VOKTTY_BROWSER_RESULT",
          requestId: requestId,
          ok: ok,
          result: result,
          error: error
        });
      }
      try {
        if (e.data.command === "ping") {
          reply(true, { ts: Date.now() });
        } else if (e.data.command === "snapshot") {
          reply(true, takeSnapshot());
        } else if (e.data.command === "click") {
          var clickEl = resolveCommandTarget(args);
          if (!clickEl) { reply(false, undefined, "element_not_found"); return; }
          if (clickEl.scrollIntoView) clickEl.scrollIntoView({ block: "center", inline: "nearest" });
          clickEl.click();
          reply(true, { ok: true });
        } else if (e.data.command === "type") {
          var typeEl = resolveCommandTarget(args);
          if (!typeEl) { reply(false, undefined, "element_not_found"); return; }
          if (typeEl.scrollIntoView) typeEl.scrollIntoView({ block: "center", inline: "nearest" });
          typeEl.focus();
          nativeSetValue(typeEl, args.text == null ? "" : String(args.text));
          if (args.submit) {
            var form = typeEl.form || (typeEl.closest && typeEl.closest("form"));
            if (form && typeof form.requestSubmit === "function") form.requestSubmit();
            else if (form) form.submit();
            else {
              typeEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
          }
          reply(true, { ok: true });
        } else if (e.data.command === "eval") {
          var evaluated = (0, eval)(String(args.script || ""));
          reply(true, { result: serializeEval(evaluated) });
        } else {
          reply(false, undefined, "unknown_command");
        }
      } catch (err) {
        reply(false, undefined, String(err && err.message ? err.message : err));
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body && !document.body.contains(overlayHost)) {
        document.body.appendChild(overlayHost);
      }
    });
  } else if (document.body && !document.body.contains(overlayHost)) {
    document.body.appendChild(overlayHost);
  }

  try {
    postToHost({
      type: "VOKTTY_INSPECTOR_READY",
      payload: { ready: true }
    });
  } catch(_) {}
})();`;
}
