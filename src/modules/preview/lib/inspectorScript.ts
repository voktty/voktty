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
    rect,
  };
}

export function getInspectorInjectedScript(): string {
  return `(function() {
  if (window.__VOKTTY_INSPECTOR_INSTALLED__) return;
  window.__VOKTTY_INSPECTOR_INSTALLED__ = true;

  ${generateCssSelector.toString()}
  ${extractReactFiberMetadata.toString()}
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
        showToast(successMsg || "Copiado al portapapeles");
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
      if (ok) showToast(successMsg || "Copiado al portapapeles");
    } catch (_) {
      showToast("Error al copiar");
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

    menu.appendChild(createMenuItem("🎯", "Inspeccionar elemento (IA)", () => {
      try {
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        }, "*");
        showToast("Elemento seleccionado");
      } catch(_) {}
    }));

    menu.appendChild(createMenuItem("💻", "Ir al código en el editor", () => {
      try {
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta,
          autoJump: true
        }, "*");
        showToast("Abriendo en editor...");
      } catch(_) {}
    }));

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("📋", "Copiar Referencia (@component)", () => {
      const tagLabel = meta.componentName ? ("<" + meta.componentName + "/>") : (meta.idAttr ? ("<" + meta.tagName + "#" + meta.idAttr + "/>") : (meta.classList && meta.classList.length > 0 ? ("<" + meta.tagName + "." + meta.classList.join(".") + "/>") : ("<" + meta.tagName + "/>")));
      let ref = "@component " + tagLabel;
      if (meta.filePath) {
        ref += " in " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "");
      }
      if (meta.selector && meta.selector !== meta.tagName) {
        ref += " (selector: " + meta.selector + ")";
      }
      copyText(ref, "Referencia copiada");
    }));

    menu.appendChild(createMenuItem("🐛", "Copiar Prompt para Depurar", () => {
      const prompt = [
        "### 🐛 Solicitud de Diagnóstico y Depuración",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: \"" + meta.innerText + "\"") : "",
        meta.htmlSnippet ? ("- **HTML del elemento**:\n" + meta.htmlSnippet) : "",
        "- **Problema**: [Describe aquí el error o fallo visual]"
      ].filter(Boolean).join("\n");
      copyText(prompt, "Prompt de depuración copiado");
    }));

    menu.appendChild(createMenuItem("💡", "Copiar Prompt para Modificar", () => {
      const prompt = [
        "### 💡 Instrucción de Modificación de Componente",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: \"" + meta.innerText + "\"") : "",
        meta.htmlSnippet ? ("- **HTML actual**:\n" + meta.htmlSnippet) : "",
        "- **Cambios solicitados**: [Describe aquí los cambios deseados]"
      ].filter(Boolean).join("\n");
      copyText(prompt, "Prompt de modificación copiado");
    }));

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔍", "Copiar Selector CSS", () => {
      copyText(meta.selector, "Selector CSS copiado");
    }));

    if (meta.htmlSnippet) {
      menu.appendChild(createMenuItem("📄", "Copiar Fragmento HTML", () => {
        copyText(meta.htmlSnippet, "HTML copiado");
      }));
    }

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔄", "Recargar Vista Previa", () => {
      try {
        window.parent.postMessage({ type: "VOKTTY_RELOAD_PREVIEW" }, "*");
      } catch(_) {
        window.location.reload();
      }
    }));

    const footer = document.createElement("div");
    footer.style.cssText = "padding:4px 6px 2px;font-size:10px;color:#64748b;text-align:center;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;";
    footer.textContent = "Shift + Clic derecho para menú nativo";
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
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        }, "*");
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

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "VOKTTY_SET_INSPECTOR_ACTIVE") {
      setActive(Boolean(e.data.active));
      try {
        window.parent.postMessage({
          type: "VOKTTY_INSPECTOR_STATE_CHANGE",
          payload: { active: active }
        }, "*");
      } catch (_) {}
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
    window.parent.postMessage({
      type: "VOKTTY_INSPECTOR_READY",
      payload: { ready: true }
    }, "*");
  } catch(_) {}
})();`;
}
