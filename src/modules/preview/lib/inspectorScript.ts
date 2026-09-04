import type {
  ComponentRect,
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
    htmlSnippet,
    innerText,
    attributes,
    propsSummary,
    hierarchy,
    rect,
  };
}

export function getInspectorInjectedScript(): string {
  return `(function() {
  if (window.__VOKTTY_INSPECTOR_INSTALLED__) return;
  window.__VOKTTY_INSPECTOR_INSTALLED__ = true;

  let active = false;
  let hoveredEl = null;

  const overlayHost = document.createElement("div");
  overlayHost.id = "voktty-inspector-root";
  overlayHost.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  const shadow = overlayHost.attachShadow({ mode: "open" });

  const box = document.createElement("div");
  box.style.cssText = "position:absolute;display:none;pointer-events:none;border:2px solid #06b6d4;background:rgba(6,182,212,0.12);border-radius:4px;box-shadow:0 0 12px rgba(6,182,212,0.35);transition:all 60ms ease-out;z-index:2147483647;";

  const label = document.createElement("div");
  label.style.cssText = "position:absolute;bottom:calc(100% + 4px);left:0;background:#0f172a;color:#38bdf8;padding:2px 8px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid #0284c7;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;";
  box.appendChild(label);
  shadow.appendChild(box);

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
    box.style.top = (r.top + window.scrollY) + "px";
    box.style.left = (r.left + window.scrollX) + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";

    let title = el.tagName.toLowerCase();
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
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const meta = ${extractDomMetadata.toString()}(target, window.location.href);
      try {
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        }, "*");
      } catch (err) {
        console.warn("[Voktty Inspector] PostMessage failed", err);
      }
    }
  }

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "VOKTTY_SET_INSPECTOR_ACTIVE") {
      active = Boolean(e.data.active);
      if (active) {
        if (!document.body.contains(overlayHost)) {
          document.body.appendChild(overlayHost);
        }
        document.addEventListener("mousemove", handleMouseMove, true);
        document.addEventListener("click", handleClick, true);
      } else {
        box.style.display = "none";
        document.removeEventListener("mousemove", handleMouseMove, true);
        document.removeEventListener("click", handleClick, true);
      }
      try {
        window.parent.postMessage({
          type: "VOKTTY_INSPECTOR_STATE_CHANGE",
          payload: { active: active }
        }, "*");
      } catch (_) {}
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(overlayHost));
  } else if (document.body) {
    document.body.appendChild(overlayHost);
  }
})();`;
}
