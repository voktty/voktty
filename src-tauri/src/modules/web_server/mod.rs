use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WebServerInfo {
    pub url: String,
    pub port: u16,
    pub root_path: String,
    pub server_type: String, // "static" | "php"
}

pub const INSPECTOR_BUNDLE_JS: &str = r####"(function() {
  if (window.__VOKTTY_INSPECTOR_INSTALLED__) return;
  window.__VOKTTY_INSPECTOR_INSTALLED__ = true;

  // Console & Runtime Error Interception
  (function initConsoleBridge() {
    if (window.__voktty_console_inited) return;
    window.__voktty_console_inited = true;

    function formatArg(arg) {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
      if (arg instanceof Error) return (arg.name ? arg.name + ': ' : '') + arg.message + (arg.stack ? '\n' + arg.stack : '');
      try {
        return JSON.stringify(arg, null, 2);
      } catch(_) {
        return String(arg);
      }
    }

    function emitLog(level, args, stack) {
      try {
        var msg = Array.prototype.map.call(args, formatArg).join(' ');
        var entry = {
          id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          level: level,
          message: msg,
          stack: stack || undefined,
          timestamp: Date.now()
        };
        window.parent.postMessage({
          type: 'VOKTTY_CONSOLE_ENTRY',
          payload: entry
        }, '*');
      } catch(_) {}
    }

    var originalLog = console.log;
    var originalInfo = console.info;
    var originalWarn = console.warn;
    var originalError = console.error;

    console.log = function() {
      originalLog.apply(console, arguments);
      emitLog('log', arguments);
    };
    console.info = function() {
      originalInfo.apply(console, arguments);
      emitLog('info', arguments);
    };
    console.warn = function() {
      originalWarn.apply(console, arguments);
      var stack = (new Error()).stack;
      emitLog('warn', arguments, stack);
    };
    console.error = function() {
      originalError.apply(console, arguments);
      var stack = (new Error()).stack;
      emitLog('error', arguments, stack);
    };

    window.addEventListener('error', function(e) {
      var msg = e.message || 'Uncaught runtime error';
      var stack = e.error && e.error.stack ? e.error.stack : (e.filename ? e.filename + ':' + e.lineno + ':' + e.colno : '');
      emitLog('error', [msg], stack);
    });

    window.addEventListener('unhandledrejection', function(e) {
      var reason = e.reason;
      var msg = reason instanceof Error ? (reason.name ? reason.name + ': ' : '') + reason.message : String(reason || 'Unhandled Promise Rejection');
      var stack = reason instanceof Error && reason.stack ? reason.stack : undefined;
      emitLog('error', [msg], stack);
    });
  })();

  function generateCssSelector(el) {
    if (!el) return "";
    if (el.id && /^[A-Za-z_-][\w-]*$/.test(el.id)) return "#" + el.id;
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && depth < 4) {
      var tag = (current.tagName || "").toLowerCase();
      if (tag === "body" || tag === "html" || !tag) break;
      var part = tag;
      if (current.id && /^[A-Za-z_-][\w-]*$/.test(current.id)) {
        part += "#" + current.id;
        parts.unshift(part);
        break;
      }
      var classArray = Array.from(current.classList || []).filter(function(c) {
        return !c.startsWith("voktty-") && !c.includes(":") && !c.includes("/");
      }).slice(0, 2);
      if (classArray.length > 0) part += "." + classArray.join(".");
      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ") || (el.tagName ? el.tagName.toLowerCase() : "element");
  }

  function extractReactFiberMetadata(el) {
    var hierarchy = [];
    var componentName, filePath, lineNumber, columnNumber, propsSummary;
    var fiberKey = Object.keys(el || {}).find(function(k) {
      return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
    });
    if (!fiberKey) return { hierarchy: hierarchy };
    var fiber = el[fiberKey];
    var curr = fiber;
    var depth = 0;
    while (curr && depth < 20) {
      if (curr.type) {
        var name = typeof curr.type === "string" ? curr.type : (curr.type.displayName || curr.type.name);
        if (name && typeof name === "string" && /^[A-Z]/.test(name) && !hierarchy.includes(name)) {
          hierarchy.push(name);
          if (!componentName) componentName = name;
          if (!propsSummary && curr.memoizedProps) {
            try {
              var s = {};
              for (var k in curr.memoizedProps) {
                if (k !== "children" && typeof curr.memoizedProps[k] !== "function") {
                  s[k] = curr.memoizedProps[k];
                }
              }
              propsSummary = s;
            } catch(e) {}
          }
        }
      }
      if (curr._debugSource && !filePath) {
        filePath = curr._debugSource.fileName;
        lineNumber = curr._debugSource.lineNumber;
        columnNumber = curr._debugSource.columnNumber;
      }
      curr = curr.return;
      depth++;
    }
    return {
      componentName: componentName,
      filePath: filePath,
      lineNumber: lineNumber,
      columnNumber: columnNumber,
      propsSummary: propsSummary,
      hierarchy: hierarchy
    };
  }

  function extractBoxModel(style) {
    if (!style) return undefined;
    var parse = function(v) { return parseFloat(v) || 0; };
    return {
      margin: {
        top: parse(style.marginTop),
        right: parse(style.marginRight),
        bottom: parse(style.marginBottom),
        left: parse(style.marginLeft)
      },
      padding: {
        top: parse(style.paddingTop),
        right: parse(style.paddingRight),
        bottom: parse(style.paddingBottom),
        left: parse(style.paddingLeft)
      },
      border: {
        top: parse(style.borderTopWidth),
        right: parse(style.borderRightWidth),
        bottom: parse(style.borderBottomWidth),
        left: parse(style.borderLeftWidth)
      }
    };
  }

  function buildBreadcrumbs(element) {
    var crumbs = [];
    var curr = element;
    while (curr && crumbs.length < 6) {
      var tag = (curr.tagName || "").toLowerCase();
      if (!tag || tag === "html" || tag === "#document") break;
      var id = curr.id && /^[A-Za-z_-][\w-]*$/.test(curr.id) ? curr.id : undefined;
      var classArray = Array.from(curr.classList || []).filter(function(c) {
        return !c.startsWith("voktty-") && !c.includes(":");
      });
      var cls = classArray.length > 0 ? classArray[0] : undefined;
      var reactName = undefined;
      try {
        var fMeta = extractReactFiberMetadata(curr);
        if (fMeta && fMeta.componentName) reactName = fMeta.componentName;
      } catch(_) {}
      crumbs.unshift({
        tagName: tag,
        id: id,
        className: cls,
        selector: generateCssSelector(curr),
        componentName: reactName
      });
      curr = curr.parentElement;
    }
    return crumbs;
  }

  function extractDomMetadata(element, url) {
    var tagName = (element.tagName || "").toLowerCase();
    var idAttr = element.id || undefined;
    var classList = element.classList ? Array.from(element.classList).filter(function(c) { return !c.startsWith("voktty-"); }) : [];
    var attributes = {};
    if (element.attributes) {
      for (var i = 0; i < element.attributes.length; i++) {
        var attr = element.attributes[i];
        if (attr && !attr.name.startsWith("voktty-")) {
          attributes[attr.name] = attr.value;
        }
      }
    }
    var selector = generateCssSelector(element);
    var framework = "dom-generic";
    var componentName, filePath, lineNumber, columnNumber, propsSummary, hierarchy = [];
    var parentClasses = [];

    var currP = element.parentElement;
    var pDepth = 0;
    while (currP && pDepth < 6) {
      if (currP.id && !parentClasses.includes("#" + currP.id)) {
        parentClasses.push("#" + currP.id);
      }
      if (currP.classList && currP.classList.length > 0) {
        for (var ci = 0; ci < currP.classList.length; ci++) {
          var cName = currP.classList[ci];
          if (!cName.startsWith("voktty-") && !parentClasses.includes(cName)) {
            parentClasses.push(cName);
          }
        }
      }
      if (!filePath && currP.getAttribute) {
        var dataFile = currP.getAttribute("data-file") || currP.getAttribute("data-source") || currP.getAttribute("data-template") || currP.getAttribute("data-component") || currP.getAttribute("data-blade") || currP.getAttribute("data-php-file");
        if (dataFile) {
          filePath = dataFile;
        }
      }
      currP = currP.parentElement;
      pDepth++;
    }

    if (typeof element.closest === "function") {
      var astroEl = element.closest("[data-astro-source-file]");
      if (astroEl) {
        framework = "astro";
        var src = astroEl.getAttribute("data-astro-source-file");
        if (src) {
          var p = src.split(":");
          filePath = p[0];
          lineNumber = parseInt(p[1], 10) || undefined;
          columnNumber = parseInt(p[2], 10) || undefined;
        }
      }
      var vueEl = element.closest("[data-v-inspector]");
      if (vueEl) {
        framework = "vue";
        var insp = vueEl.getAttribute("data-v-inspector");
        if (insp) {
          var vp = insp.split(":");
          filePath = vp[0];
          lineNumber = parseInt(vp[1], 10) || undefined;
          columnNumber = parseInt(vp[2], 10) || undefined;
        }
      }
      var svelteEl = element.closest("[data-svelte-h], [data-svelte-component]");
      if (svelteEl) {
        framework = "svelte";
        componentName = svelteEl.getAttribute("data-svelte-component") || undefined;
      }
    }

    var reactMeta = extractReactFiberMetadata(element);
    if (reactMeta.componentName || reactMeta.filePath || reactMeta.hierarchy.length > 0) {
      framework = "react";
      if (!componentName) componentName = reactMeta.componentName;
      if (!filePath) filePath = reactMeta.filePath;
      if (lineNumber === undefined) lineNumber = reactMeta.lineNumber;
      if (columnNumber === undefined) columnNumber = reactMeta.columnNumber;
      if (!propsSummary) propsSummary = reactMeta.propsSummary;
      if (reactMeta.hierarchy.length > 0) hierarchy = reactMeta.hierarchy;
    }

    var rect = element.getBoundingClientRect();
    var boundingBox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    };

    var computedStyle = window.getComputedStyle ? window.getComputedStyle(element) : null;
    var styles = {};
    if (computedStyle) {
      var sampleProps = [
        "display", "position", "flexDirection", "gridTemplateColumns",
        "gap", "padding", "margin", "width", "height", "color",
        "backgroundColor", "fontSize", "fontWeight", "borderRadius", "border"
      ];
      for (var j = 0; j < sampleProps.length; j++) {
        var sp = sampleProps[j];
        var val = computedStyle[sp];
        if (val) styles[sp] = val;
      }
    }

    var boxModel = extractBoxModel(computedStyle);
    var breadcrumbs = buildBreadcrumbs(element);

    var textSnippet = (element.innerText || element.textContent || "").trim();
    if (textSnippet.length > 120) {
      textSnippet = textSnippet.slice(0, 117) + "...";
    }

    var outerHtml = element.outerHTML || "";
    if (outerHtml.length > 600) {
      outerHtml = outerHtml.slice(0, 597) + "...";
    }

    return {
      id: "comp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tagName: tagName,
      idAttr: idAttr,
      classList: classList,
      parentClasses: parentClasses,
      attributes: attributes,
      selector: selector,
      componentName: componentName,
      filePath: filePath,
      lineNumber: lineNumber,
      columnNumber: columnNumber,
      propsSummary: propsSummary,
      framework: framework,
      hierarchy: hierarchy,
      breadcrumbs: breadcrumbs,
      boundingBox: boundingBox,
      rect: boundingBox,
      styles: styles,
      boxModel: boxModel,
      innerText: textSnippet || "",
      textSnippet: textSnippet || undefined,
      htmlSnippet: outerHtml || "",
      outerHtml: outerHtml || undefined,
      timestamp: Date.now(),
      url: url || window.location.href,
      pageUrl: url || window.location.href
    };
  }

  var active = false;
  var hoveredEl = null;

  var overlayHost = document.createElement("div");
  overlayHost.id = "voktty-inspector-root";
  overlayHost.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  var shadow = overlayHost.attachShadow({ mode: "open" });

  var box = document.createElement("div");
  box.style.cssText = "position:absolute;display:none;pointer-events:none;border:2px solid #06b6d4;background:rgba(6,182,212,0.14);border-radius:4px;box-shadow:0 0 16px rgba(6,182,212,0.5), inset 0 0 8px rgba(6,182,212,0.2);transition:top 50ms ease-out, left 50ms ease-out, width 50ms ease-out, height 50ms ease-out;z-index:2147483647;";

  var label = document.createElement("div");
  label.style.cssText = "position:absolute;left:0;background:rgba(15,23,42,0.95);color:#38bdf8;padding:3px 10px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid #0284c7;box-shadow:0 4px 14px rgba(0,0,0,0.5);pointer-events:none;backdrop-filter:blur(8px);display:flex;align-items:center;gap:6px;";
  box.appendChild(label);
  shadow.appendChild(box);

  var menu = document.createElement("div");
  menu.id = "voktty-context-menu";
  menu.style.cssText = "position:fixed;display:none;min-width:230px;max-width:320px;background:rgba(15,23,42,0.96);color:#f8fafc;border:1px solid #0284c7;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.6),0 0 16px rgba(6,182,212,0.25);padding:6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;z-index:2147483647;backdrop-filter:blur(14px);user-select:none;pointer-events:auto;";
  shadow.appendChild(menu);

  var toastEl = document.createElement("div");
  toastEl.id = "voktty-toast";
  toastEl.style.cssText = "position:fixed;bottom:20px;right:20px;display:none;background:#064e3b;color:#6ee7b7;border:1px solid #059669;padding:6px 14px;border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.5);z-index:2147483647;pointer-events:none;transition:opacity 150ms ease-out;";
  shadow.appendChild(toastEl);

  var toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = "✓ " + msg;
    toastEl.style.display = "block";
    toastEl.style.opacity = "1";
    toastTimer = setTimeout(function() {
      toastEl.style.opacity = "0";
      setTimeout(function() { toastEl.style.display = "none"; }, 160);
    }, 1600);
  }

  function hideContextMenu() {
    menu.style.display = "none";
  }

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast(successMsg || "Copiado al portapapeles");
      }).catch(function() {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) showToast(successMsg || "Copiado al portapapeles");
      else showToast("Error al copiar");
    } catch (_) {
      showToast("Error al copiar");
    }
  }

  function createMenuItem(icon, text, onClick, isDanger) {
    var item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;transition:background 100ms;font-size:12px;color:" + (isDanger ? "#fca5a5" : "#e2e8f0") + ";";
    item.innerHTML = "<span style='font-size:13px;'>" + icon + "</span><span style='flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'>" + text + "</span>";
    item.addEventListener("mouseenter", function() {
      item.style.background = isDanger ? "rgba(239,68,68,0.2)" : "rgba(6,182,212,0.18)";
      item.style.color = isDanger ? "#fecaca" : "#38bdf8";
    });
    item.addEventListener("mouseleave", function() {
      item.style.background = "transparent";
      item.style.color = isDanger ? "#fca5a5" : "#e2e8f0";
    });
    item.addEventListener("click", function(e) {
      e.stopPropagation();
      hideContextMenu();
      onClick();
    });
    return item;
  }

  function createMenuDivider() {
    var div = document.createElement("div");
    div.style.cssText = "height:1px;background:rgba(255,255,255,0.08);margin:4px 0;";
    return div;
  }

  function showContextMenu(x, y, meta) {
    if (!document.body.contains(overlayHost) && document.body) {
      document.body.appendChild(overlayHost);
    }
    menu.innerHTML = "";

    var tagTitle = "<" + (meta.componentName || meta.tagName) + (meta.idAttr ? "#" + meta.idAttr : (meta.classList && meta.classList[0] ? "." + meta.classList[0] : "")) + "/>";

    var header = document.createElement("div");
    header.style.cssText = "padding:5px 8px 6px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:#38bdf8;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;justify-content:space-between;";
    header.innerHTML = "<span style='overflow:hidden;text-overflow:ellipsis;'>" + tagTitle + "</span><span style='font-size:9px;text-transform:uppercase;color:#94a3b8;font-family:sans-serif;margin-left:6px;'>" + (meta.framework || "DOM") + "</span>";
    menu.appendChild(header);

    menu.appendChild(createMenuItem("🎯", "Inspeccionar elemento (IA)", function() {
      try {
        window.parent.postMessage({
          type: "VOKTTY_LIVE_COMPONENT_SELECTED",
          payload: meta
        }, "*");
        showToast("Elemento seleccionado");
      } catch(_) {}
    }));

    menu.appendChild(createMenuItem("💻", "Ir al código en el editor", function() {
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

    menu.appendChild(createMenuItem("📋", "Copiar Referencia (@component)", function() {
      var tagLabel = meta.componentName ? ("<" + meta.componentName + "/>") : (meta.idAttr ? ("<" + meta.tagName + "#" + meta.idAttr + "/>") : (meta.classList && meta.classList.length > 0 ? ("<" + meta.tagName + "." + meta.classList.join(".") + "/>") : ("<" + meta.tagName + "/>")));
      var ref = "@component " + tagLabel;
      if (meta.filePath) {
        ref += " in " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "");
      }
      if (meta.selector && meta.selector !== meta.tagName) {
        ref += " (selector: " + meta.selector + ")";
      }
      copyText(ref, "Referencia copiada");
    }));

    menu.appendChild(createMenuItem("🐛", "Copiar Prompt para Depurar", function() {
      var prompt = [
        "### 🐛 Solicitud de Diagnóstico y Depuración",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: '" + meta.innerText + "'") : "",
        meta.htmlSnippet ? ("- **HTML del elemento**:\n" + meta.htmlSnippet) : "",
        "- **Problema**: [Describe aquí el error o fallo visual]"
      ].filter(Boolean).join("\n");
      copyText(prompt, "Prompt de depuración copiado");
    }));

    menu.appendChild(createMenuItem("💡", "Copiar Prompt para Modificar", function() {
      var prompt = [
        "### 💡 Instrucción de Modificación de Componente",
        "- **Elemento**: <" + (meta.componentName || meta.tagName) + ">",
        meta.filePath ? ("- **Archivo**: " + meta.filePath + (meta.lineNumber ? ":" + meta.lineNumber : "")) : "",
        "- **Selector DOM**: " + meta.selector,
        meta.innerText ? ("- **Texto visible**: '" + meta.innerText + "'") : "",
        meta.htmlSnippet ? ("- **HTML actual**:\n" + meta.htmlSnippet) : "",
        "- **Cambios solicitados**: [Describe aquí los cambios deseados]"
      ].filter(Boolean).join("\n");
      copyText(prompt, "Prompt de modificación copiado");
    }));

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔍", "Copiar Selector CSS", function() {
      copyText(meta.selector, "Selector CSS copiado");
    }));

    if (meta.htmlSnippet) {
      menu.appendChild(createMenuItem("📄", "Copiar Fragmento HTML", function() {
        copyText(meta.htmlSnippet, "HTML copiado");
      }));
    }

    menu.appendChild(createMenuDivider());

    menu.appendChild(createMenuItem("🔄", "Recargar Vista Previa", function() {
      try {
        window.parent.postMessage({ type: "VOKTTY_RELOAD_PREVIEW" }, "*");
      } catch(_) {
        window.location.reload();
      }
    }));

    var footer = document.createElement("div");
    footer.style.cssText = "padding:4px 6px 2px;font-size:10px;color:#64748b;text-align:center;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;";
    footer.textContent = "Shift + Clic derecho para menú nativo";
    menu.appendChild(footer);

    menu.style.display = "block";

    var posX = x;
    var posY = y;
    var menuWidth = 230;
    var menuHeight = 270;

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

    var target = e.target && e.target !== overlayHost && !overlayHost.contains(e.target)
      ? e.target
      : document.elementFromPoint(e.clientX, e.clientY);

    if (!target || target === overlayHost || overlayHost.contains(target) || target === document.documentElement) return;

    var meta = extractDomMetadata(target, window.location.href);
    showContextMenu(e.clientX, e.clientY, meta);
  }

  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("click", function(e) {
    if (menu.style.display !== "none" && !menu.contains(e.target)) {
      hideContextMenu();
    }
  }, true);
  window.addEventListener("scroll", hideContextMenu, { passive: true });
  window.addEventListener("resize", hideContextMenu, { passive: true });
  window.addEventListener("keydown", function(e) {
    if (e.key === "Escape") hideContextMenu();
  }, true);

  function updateHighlight(el) {
    if (!el || !active) {
      box.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.top = r.top + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";

    if (r.top < 32) {
      label.style.top = "calc(100% + 4px)";
      label.style.bottom = "auto";
    } else {
      label.style.top = "auto";
      label.style.bottom = "calc(100% + 4px)";
    }

    var title = (el.tagName || "").toLowerCase();
    if (el.id) title += "#" + el.id;
    else if (el.classList && el.classList.length > 0) {
      var cls = Array.from(el.classList).slice(0, 1)[0];
      if (cls) title += "." + cls;
    }
    label.innerHTML = "<span>🎯</span><span>" + title + "</span><span style='font-size:10px;color:#94a3b8;font-weight:400;margin-left:4px;'>" + Math.round(r.width) + "×" + Math.round(r.height) + "</span>";
  }

  function handleMouseMove(e) {
    if (!active) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
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

    var target = e.target && e.target !== overlayHost && !overlayHost.contains(e.target)
      ? e.target
      : document.elementFromPoint(e.clientX, e.clientY);

    if (target && target !== overlayHost && !overlayHost.contains(target)) {
      var meta = extractDomMetadata(target, window.location.href);
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

  // Intercept anchor navigation inside proxied pages when inspector is idle
  document.addEventListener("click", function(e) {
    if (active) return;
    var anchor = e.target && e.target.closest ? e.target.closest("a") : null;
    if (anchor && anchor.href && !anchor.href.startsWith("javascript:") && !anchor.href.startsWith("#")) {
      if (anchor.target === "_blank") return;
      e.preventDefault();
      try {
        window.parent.postMessage({
          type: "VOKTTY_PROXY_NAVIGATE",
          payload: { url: anchor.href }
        }, "*");
      } catch(_) {
        window.location.href = "/__voktty_proxy?url=" + encodeURIComponent(anchor.href);
      }
    }
  }, true);

  window.addEventListener("scroll", function() {
    if (active && hoveredEl) updateHighlight(hoveredEl);
  }, { passive: true });

  window.addEventListener("resize", function() {
    if (active && hoveredEl) updateHighlight(hoveredEl);
  }, { passive: true });

  window.addEventListener("message", function(e) {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "VOKTTY_SET_INSPECTOR_ACTIVE") {
      setActive(Boolean(e.data.active));
      try {
        window.parent.postMessage({
          type: "VOKTTY_INSPECTOR_STATE_CHANGE",
          payload: { active: active }
        }, "*");
      } catch (_) {}
    } else if (e.data.type === "VOKTTY_HIGHLIGHT_ELEMENT") {
      if (e.data.selector) {
        try {
          var el = document.querySelector(e.data.selector);
          if (el) updateHighlight(el);
        } catch(_) {}
      }
    } else if (e.data.type === "VOKTTY_SELECT_ELEMENT_BY_SELECTOR") {
      if (e.data.selector) {
        try {
          var el = document.querySelector(e.data.selector);
          if (el) {
            var meta = extractDomMetadata(el, window.location.href);
            window.parent.postMessage({
              type: "VOKTTY_LIVE_COMPONENT_SELECTED",
              payload: meta,
              autoJump: Boolean(e.data.autoJump)
            }, "*");
          }
        } catch(_) {}
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
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
})();"####;

pub fn ensure_php_helpers() -> Result<(PathBuf, PathBuf), String> {
    let dir = std::env::temp_dir().join("voktty_web_server");
    let _ = fs::create_dir_all(&dir);

    let js_path = dir.join("voktty_inspector.js");
    let router_path = dir.join("voktty_router.php");
    let append_path = dir.join("voktty_append.php");

    let _ = fs::write(&js_path, INSPECTOR_BUNDLE_JS);

    let router_code = r#"<?php
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($uri === '/__voktty_inspector.js') {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    echo file_get_contents(__DIR__ . '/voktty_inspector.js');
    exit;
}
if (strpos($uri, '/__voktty_proxy') === 0) {
    $targetUrl = $_GET['url'] ?? '';
    if ($targetUrl) {
        $content = @file_get_contents($targetUrl);
        if ($content !== false) {
            header('Content-Type: text/html; charset=utf-8');
            header('Access-Control-Allow-Origin: *');
            $base = "<base href=\"" . htmlspecialchars($targetUrl, ENT_QUOTES) . "\">\n<script>window.__VOKTTY_IS_PROXIED__ = true;</script>";
            if (strpos($content, '<head>') !== false) {
                $content = str_replace('<head>', "<head>\n" . $base, $content);
            } else {
                $content = "<head>" . $base . "</head>" . $content;
            }
            $script = "<script src=\"/__voktty_inspector.js\"></script>";
            if (strpos($content, '__voktty_inspector.js') === false) {
                $pos = strripos($content, '</body>');
                if ($pos !== false) {
                    $content = substr_replace($content, $script . '</body>', $pos, 7);
                } else {
                    $content .= "\n" . $script;
                }
            }
            echo $content;
            exit;
        }
    }
}

$docroot = $_SERVER['DOCUMENT_ROOT'] ?? getcwd();
$filePath = $docroot . $uri;

if (is_dir($filePath)) {
    if (file_exists($filePath . '/index.php')) {
        $filePath = $filePath . '/index.php';
    } else if (file_exists($filePath . '/index.html')) {
        $filePath = $filePath . '/index.html';
    } else if (file_exists($filePath . '/index.htm')) {
        $filePath = $filePath . '/index.htm';
    }
}

if (file_exists($filePath) && !is_dir($filePath)) {
    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    if ($ext === 'html' || $ext === 'htm') {
        header('Content-Type: text/html; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        $html = file_get_contents($filePath);
        $script = "<script src=\"/__voktty_inspector.js\"></script>";
        if (strpos($html, '__voktty_inspector.js') === false) {
            $pos = strripos($html, '</body>');
            if ($pos !== false) {
                $html = substr_replace($html, $script . '</body>', $pos, 7);
            } else {
                $pos = strripos($html, '</html>');
                if ($pos !== false) {
                    $html = substr_replace($html, $script . '</html>', $pos, 7);
                } else {
                    $html .= "\n" . $script;
                }
            }
        }
        echo $html;
        exit;
    }
    if ($ext === 'php') {
        ob_start(function($buffer) {
            $script = "<script src=\"/__voktty_inspector.js\"></script>";
            if (strpos($buffer, '__voktty_inspector.js') === false) {
                $pos = strripos($buffer, '</body>');
                if ($pos !== false) {
                    return substr_replace($buffer, $script . '</body>', $pos, 7);
                }
                $pos = strripos($buffer, '</html>');
                if ($pos !== false) {
                    return substr_replace($buffer, $script . '</html>', $pos, 7);
                }
                return $buffer . "\n" . $script;
            }
            return $buffer;
        });
        include $filePath;
        ob_end_flush();
        exit;
    }
}

return false;
"#;
    let _ = fs::write(&router_path, router_code);

    let append_code = r#"<?php
if (!isset($GLOBALS['__VOKTTY_APPEND_DONE__'])) {
    $GLOBALS['__VOKTTY_APPEND_DONE__'] = true;
    echo "\n<script src=\"/__voktty_inspector.js\"></script>\n";
}
"#;
    let _ = fs::write(&append_path, append_code);

    Ok((router_path, append_path))
}

enum RunningServer {
    Static {
        port: u16,
        root_path: PathBuf,
        stop_flag: Arc<AtomicBool>,
    },
    Php {
        port: u16,
        root_path: PathBuf,
        child: Child,
    },
}

#[derive(Default)]
pub struct WebServerState {
    servers: Mutex<HashMap<String, RunningServer>>,
    proxy_server: Mutex<Option<(u16, Arc<AtomicBool>)>>,
}

impl WebServerState {
    pub fn stop_all(&self) {
        let mut map = self.servers.lock().unwrap_or_else(|e| e.into_inner());
        for (_, server) in map.drain() {
            match server {
                RunningServer::Static { stop_flag, .. } => {
                    stop_flag.store(true, Ordering::SeqCst);
                }
                RunningServer::Php { mut child, .. } => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        if let Some((_, stop_flag)) = self
            .proxy_server
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            stop_flag.store(true, Ordering::SeqCst);
        }
    }
}

pub fn clean_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p.to_path_buf()
    }
}

pub fn is_system_directory(path: &Path) -> bool {
    let p_lossy = path.to_string_lossy().to_ascii_lowercase();
    let p_win = p_lossy.replace('/', "\\");
    let p_unix = p_lossy.replace('\\', "/");

    // Windows system paths (any drive letter, e.g. C:, D:, etc.)
    let win_without_drive = if p_win.len() >= 2 && p_win.chars().nth(1) == Some(':') {
        &p_win[2..]
    } else {
        &p_win[..]
    };

    if win_without_drive.starts_with("\\windows")
        || win_without_drive.starts_with("\\program files")
        || win_without_drive.starts_with("\\program files (x86)")
        || win_without_drive.starts_with("\\programdata")
        || win_without_drive.starts_with("\\system volume information")
        || win_without_drive.starts_with("\\$recycle.bin")
    {
        return true;
    }

    // Windows Root drive itself (e.g. "C:\", "D:", etc.)
    let trimmed_win = p_win.trim_end_matches('\\');
    if trimmed_win.len() == 2 && trimmed_win.ends_with(':') {
        return true;
    }

    // Unix / macOS / Linux system paths
    if p_unix.starts_with("/bin")
        || p_unix.starts_with("/sbin")
        || p_unix.starts_with("/usr")
        || p_unix.starts_with("/etc")
        || p_unix.starts_with("/var")
        || p_unix.starts_with("/sys")
        || p_unix.starts_with("/proc")
        || p_unix.starts_with("/dev")
        || p_unix.starts_with("/boot")
        || p_unix.starts_with("/root")
        || p_unix.starts_with("/system")
        || p_unix.starts_with("/library")
        || p_unix.starts_with("/private")
        || p_unix == "/"
    {
        return true;
    }

    false
}

pub fn normalize_root_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    let mut p = if trimmed.is_empty() {
        if let Some(snapshot) = crate::modules::workspace::launch_cwd_snapshot() {
            snapshot
        } else if let Ok(cwd) = std::env::current_dir() {
            if !is_system_directory(&cwd) {
                cwd
            } else {
                return Err("Default working directory is a system path".to_string());
            }
        } else {
            return Err("No path provided and failed to get current directory".to_string());
        }
    } else {
        PathBuf::from(trimmed)
    };

    if !p.exists() {
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            p = PathBuf::from(format!("{}\\", trimmed));
        }
        if !p.exists() {
            return Err(format!("Path does not exist: {}", trimmed));
        }
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path {trimmed}: {e}"))?;
    let cleaned = clean_path(&canonical);
    if cleaned.is_file() {
        Ok(cleaned.parent().unwrap_or(&cleaned).to_path_buf())
    } else {
        Ok(cleaned)
    }
}

pub fn has_php_files(dir: &Path) -> bool {
    let clean = clean_path(dir);
    if clean.is_file() {
        if let Some(ext) = clean.extension() {
            if ext.eq_ignore_ascii_case("php") {
                return true;
            }
        }
    }
    if let Ok(entries) = fs::read_dir(&clean) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("php") {
                        return true;
                    }
                }
            } else if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let lower = name.to_ascii_lowercase();
                if matches!(
                    lower.as_str(),
                    "public" | "src" | "app" | "www" | "web" | "html"
                ) {
                    if let Ok(sub_entries) = fs::read_dir(&path) {
                        for sub in sub_entries.flatten() {
                            if sub
                                .path()
                                .extension()
                                .map(|e| e.eq_ignore_ascii_case("php"))
                                .unwrap_or(false)
                            {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

pub fn is_php_available() -> bool {
    which::which("php").is_ok()
}

pub fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn url_decode(s: &str) -> String {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(val);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn sanitize_request_path(request_uri: &str) -> &str {
    let uri = request_uri.split('?').next().unwrap_or(request_uri);
    uri.split('#').next().unwrap_or(uri)
}

fn handle_connection(mut stream: TcpStream, root: &Path) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_uri = parts.next().unwrap_or("/");

    if method != "GET" && method != "HEAD" && method != "OPTIONS" {
        let resp =
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let clean_uri = sanitize_request_path(raw_uri);
    let decoded = url_decode(clean_uri);
    let relative = decoded.trim_start_matches('/');

    if relative == "__voktty_inspector.js" {
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/javascript; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n{}",
            INSPECTOR_BUNDLE_JS.len(),
            INSPECTOR_BUNDLE_JS
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if raw_uri.starts_with("/__voktty_proxy") || relative.starts_with("__voktty_proxy") {
        handle_proxy_request(&mut stream, raw_uri);
        return;
    }

    let clean_root = clean_path(&root.canonicalize().unwrap_or_else(|_| root.to_path_buf()));
    let target_path = if relative.is_empty() {
        clean_root.clone()
    } else {
        clean_root.join(relative)
    };

    // Path traversal check
    let canonical = target_path.canonicalize().unwrap_or(target_path);
    let clean_target = clean_path(&canonical);

    if !clean_target.starts_with(&clean_root) {
        let resp = "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let file_to_serve = if clean_target.is_dir() {
        let index_html = clean_target.join("index.html");
        let index_htm = clean_target.join("index.htm");
        let index_php = clean_target.join("index.php");

        if index_html.is_file() {
            index_html
        } else if index_htm.is_file() {
            index_htm
        } else if index_php.is_file() {
            send_php_fallback(&mut stream, &clean_target);
            return;
        } else {
            send_directory_listing(&mut stream, &clean_target, &clean_root, &decoded);
            return;
        }
    } else {
        clean_target
    };

    // If requested a PHP file directly under static server
    if file_to_serve
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("php"))
        .unwrap_or(false)
    {
        send_php_fallback(&mut stream, &file_to_serve);
        return;
    }

    let mime = guess_mime(&file_to_serve);
    if mime.starts_with("text/html") {
        if let Ok(mut html_content) = fs::read_to_string(&file_to_serve) {
            let script_tag = "<script src=\"/__voktty_inspector.js\"></script>";
            if !html_content.contains("__voktty_inspector.js") {
                if let Some(pos) = html_content.rfind("</body>") {
                    html_content.insert_str(pos, script_tag);
                } else if let Some(pos) = html_content.rfind("</html>") {
                    html_content.insert_str(pos, script_tag);
                } else {
                    html_content.push_str(script_tag);
                }
            }
            let bytes = html_content.as_bytes();
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                mime,
                bytes.len()
            );
            let _ = stream.write_all(header.as_bytes());
            if method == "GET" {
                let _ = stream.write_all(bytes);
            }
            return;
        }
    }

    match File::open(&file_to_serve) {
        Ok(mut f) => {
            let metadata = f.metadata().ok();
            let len = metadata.map(|m| m.len()).unwrap_or(0);

            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                mime, len
            );

            if stream.write_all(header.as_bytes()).is_ok() && method == "GET" {
                let mut buffer = [0u8; 8192];
                while let Ok(read_bytes) = f.read(&mut buffer) {
                    if read_bytes == 0 {
                        break;
                    }
                    if stream.write_all(&buffer[..read_bytes]).is_err() {
                        break;
                    }
                }
            }
        }
        Err(_) => {
            send_404(&mut stream, &decoded);
        }
    }
}

fn send_404(stream: &mut TcpStream, path: &str) {
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>404 Not Found</title><style>body{{font-family:system-ui,-apple-system,sans-serif;padding:3rem;background:#0f172a;color:#f8fafc}}h1{{color:#ef4444}}code{{background:#1e293b;padding:0.2rem 0.4rem;border-radius:4px}}</style></head><body><h1>404 Not Found</h1><p>The requested path <code>{}</code> was not found on this Voktty Live Server.</p></body></html>",
        path
    );
    let resp = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn send_php_fallback(stream: &mut TcpStream, file_path: &Path) {
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("index.php");
    let body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PHP Script Detected - Voktty Live Server</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; padding: 3rem; background: #0f172a; color: #f8fafc; line-height: 1.6; max-width: 680px; margin: 0 auto; }}
    .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }}
    h2 {{ margin-top: 0; color: #60a5fa; display: flex; align-items: center; gap: 0.5rem; }}
    code {{ background: #0f172a; color: #38bdf8; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.9em; }}
    .tip {{ background: #1e3a8a25; border-left: 4px solid #3b82f6; padding: 0.8rem 1rem; border-radius: 4px; margin-top: 1.5rem; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>🐘 PHP Script Detected: <code>{}</code></h2>
    <p>This workspace contains PHP files. Voktty started in Static Web Server mode because the <code>php</code> CLI binary was not found in the local PATH.</p>
    <div class="tip">
      <strong>To run PHP code natively:</strong>
      <p style="margin: 0.5rem 0 0 0;">Install PHP (or activate it in your environment/Docker). Once PHP is in your PATH, Voktty will automatically launch the native PHP Server (<code>php -S</code>) for full dynamic execution.</p>
    </div>
  </div>
</body>
</html>"#,
        name
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn send_directory_listing(stream: &mut TcpStream, dir: &Path, root: &Path, request_path: &str) {
    let clean_dir = clean_path(dir);
    let clean_root = clean_path(root);
    let mut entries_html = String::new();
    let rel_parent = if clean_dir != clean_root {
        let parent = clean_dir.parent().unwrap_or(&clean_root);
        let rel = parent
            .strip_prefix(&clean_root)
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .replace('\\', "/");
        format!(
            "<li>📁 <a href=\"/{}\">.. (Parent Directory)</a></li>",
            rel.trim_start_matches('/')
        )
    } else {
        String::new()
    };

    if let Ok(read) = fs::read_dir(&clean_dir) {
        let mut items: Vec<_> = read.flatten().collect();
        items.sort_by_key(|e| (e.path().is_file(), e.file_name()));

        for item in items {
            let p = clean_path(&item.path());
            let is_d = p.is_dir();
            let name = item.file_name().to_string_lossy().to_string();
            let rel = p
                .strip_prefix(&clean_root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let icon = if is_d { "📁" } else { "📄" };
            entries_html.push_str(&format!(
                "<li>{} <a href=\"/{}\">{}</a></li>\n",
                icon,
                rel.trim_start_matches('/'),
                name
            ));
        }
    }

    let body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Directory Index - Voktty Live Server</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; line-height: 1.6; }}
    h1 {{ font-size: 1.5rem; color: #38bdf8; margin-bottom: 1rem; }}
    ul {{ list-style: none; padding: 0; }}
    li {{ padding: 0.4rem 0.6rem; border-radius: 6px; }}
    li:hover {{ background: #1e293b; }}
    a {{ color: #93c5fd; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <h1>📂 Index of /{}</h1>
  <ul>
    {}{}
  </ul>
  <script src="/__voktty_inspector.js"></script>
</body>
</html>"#,
        request_path.trim_start_matches('/'),
        rel_parent,
        entries_html
    );

    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn start_static_server_thread(
    root: PathBuf,
    preferred_port: Option<u16>,
) -> Result<(u16, Arc<AtomicBool>), String> {
    let port = preferred_port.unwrap_or(0);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(e) if port != 0 => {
            log::warn!(
                "Static server port {} in use ({}), allocating random port",
                port,
                e
            );
            TcpListener::bind("127.0.0.1:0")
                .map_err(|e2| format!("Failed to bind web server port: {e2}"))?
        }
        Err(e) => return Err(format!("Failed to bind web server port: {e}")),
    };
    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    let _ = listener.set_nonblocking(true);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop_flag);

    thread::spawn(move || {
        while !stop_clone.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let root_clone = root.clone();
                    thread::spawn(move || {
                        handle_connection(stream, &root_clone);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    });

    Ok((actual_port, stop_flag))
}

fn start_php_server(root: &Path, preferred_port: Option<u16>) -> Result<(u16, Child), String> {
    let port = if let Some(p) = preferred_port {
        if p != 0 {
            if let Ok(test_bind) = TcpListener::bind(format!("127.0.0.1:{}", p)) {
                drop(test_bind);
                p
            } else {
                log::warn!("Preferred PHP port {} in use, allocating random port", p);
                let temp_listener = TcpListener::bind("127.0.0.1:0")
                    .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
                let allocated = temp_listener
                    .local_addr()
                    .map_err(|e| e.to_string())?
                    .port();
                drop(temp_listener);
                allocated
            }
        } else {
            let temp_listener = TcpListener::bind("127.0.0.1:0")
                .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
            let allocated = temp_listener
                .local_addr()
                .map_err(|e| e.to_string())?
                .port();
            drop(temp_listener);
            allocated
        }
    } else {
        let temp_listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to allocate port for PHP server: {e}"))?;
        let allocated = temp_listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();
        drop(temp_listener);
        allocated
    };

    let bind_target = format!("127.0.0.1:{}", port);
    let clean_root = clean_path(root);
    let mut doc_root = clean_root.clone();
    let public_dir = clean_root.join("public");
    if public_dir.join("index.php").is_file() {
        doc_root = public_dir;
    }
    let root_str = doc_root.to_string_lossy().to_string();

    let (router_path, append_path) =
        ensure_php_helpers().unwrap_or_else(|_| (PathBuf::new(), PathBuf::new()));

    let mut cmd = Command::new("php");
    cmd.args(["-S", &bind_target, "-t", &root_str]);
    if append_path.exists() {
        cmd.arg("-d")
            .arg(format!("auto_append_file={}", append_path.to_string_lossy()));
    }
    if router_path.exists() {
        cmd.arg(router_path.to_string_lossy().to_string());
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    crate::modules::proc::hide_console(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn PHP server: {e}"))?;

    thread::sleep(Duration::from_millis(60));

    Ok((port, child))
}

#[tauri::command]
pub async fn web_server_start(
    state: State<'_, WebServerState>,
    path: String,
    port: Option<u16>,
) -> Result<WebServerInfo, String> {
    let canonical = normalize_root_path(&path)?;
    let key = canonical.to_string_lossy().to_string();

    let mut map = state.servers.lock().map_err(|e| e.to_string())?;

    if let Some(running) = map.get(&key) {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => {
                return Ok(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "static".to_string(),
                });
            }
            RunningServer::Php {
                port, root_path, ..
            } => {
                return Ok(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "php".to_string(),
                });
            }
        }
    }

    let is_php = has_php_files(&canonical) && is_php_available();

    if is_php {
        match start_php_server(&canonical, port) {
            Ok((actual_port, child)) => {
                let info = WebServerInfo {
                    url: format!("http://127.0.0.1:{}", actual_port),
                    port: actual_port,
                    root_path: key.clone(),
                    server_type: "php".to_string(),
                };
                map.insert(
                    key,
                    RunningServer::Php {
                        port: actual_port,
                        root_path: canonical,
                        child,
                    },
                );
                return Ok(info);
            }
            Err(e) => {
                log::warn!("Failed to start PHP server, falling back to static: {}", e);
            }
        }
    }

    let (actual_port, stop_flag) = start_static_server_thread(canonical.clone(), port)?;
    let info = WebServerInfo {
        url: format!("http://127.0.0.1:{}", actual_port),
        port: actual_port,
        root_path: key.clone(),
        server_type: "static".to_string(),
    };

    map.insert(
        key,
        RunningServer::Static {
            port: actual_port,
            root_path: canonical,
            stop_flag,
        },
    );

    Ok(info)
}

#[tauri::command]
pub async fn web_server_stop(
    state: State<'_, WebServerState>,
    path: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    let mut map = state.servers.lock().map_err(|e| e.to_string())?;

    if let Some(p) = port {
        let key_to_remove = map.iter().find_map(|(k, s)| match s {
            RunningServer::Static { port: sp, .. } if *sp == p => Some(k.clone()),
            RunningServer::Php { port: pp, .. } if *pp == p => Some(k.clone()),
            _ => None,
        });
        if let Some(key) = key_to_remove {
            if let Some(server) = map.remove(&key) {
                match server {
                    RunningServer::Static { stop_flag, .. } => {
                        stop_flag.store(true, Ordering::SeqCst);
                    }
                    RunningServer::Php { mut child, .. } => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
        return Ok(());
    }

    if let Some(path_str) = path {
        let canonical = match normalize_root_path(&path_str) {
            Ok(p) => p,
            Err(_) => PathBuf::from(&path_str),
        };
        let key = canonical.to_string_lossy().to_string();
        if let Some(server) = map.remove(&key) {
            match server {
                RunningServer::Static { stop_flag, .. } => {
                    stop_flag.store(true, Ordering::SeqCst);
                }
                RunningServer::Php { mut child, .. } => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn web_server_get_for_path(
    state: State<'_, WebServerState>,
    path: String,
) -> Result<Option<WebServerInfo>, String> {
    let canonical = match normalize_root_path(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let key = canonical.to_string_lossy().to_string();

    let map = state.servers.lock().map_err(|e| e.to_string())?;
    if let Some(running) = map.get(&key) {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => Ok(Some(WebServerInfo {
                url: format!("http://127.0.0.1:{}", port),
                port: *port,
                root_path: root_path.to_string_lossy().to_string(),
                server_type: "static".to_string(),
            })),
            RunningServer::Php {
                port, root_path, ..
            } => Ok(Some(WebServerInfo {
                url: format!("http://127.0.0.1:{}", port),
                port: *port,
                root_path: root_path.to_string_lossy().to_string(),
                server_type: "php".to_string(),
            })),
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn web_server_list(
    state: State<'_, WebServerState>,
) -> Result<Vec<WebServerInfo>, String> {
    let map = state.servers.lock().map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for running in map.values() {
        match running {
            RunningServer::Static {
                port, root_path, ..
            } => {
                list.push(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "static".to_string(),
                });
            }
            RunningServer::Php {
                port, root_path, ..
            } => {
                list.push(WebServerInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port: *port,
                    root_path: root_path.to_string_lossy().to_string(),
                    server_type: "php".to_string(),
                });
            }
        }
    }
    Ok(list)
}

pub fn url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

static LAST_PROXIED_URL: Mutex<Option<String>> = Mutex::new(None);

pub fn record_last_proxied_url(target: &str) {
    if let Ok(mut lock) = LAST_PROXIED_URL.lock() {
        *lock = Some(target.to_string());
    }
}

pub fn get_last_proxied_url() -> Option<String> {
    LAST_PROXIED_URL.lock().ok().and_then(|g| g.clone())
}

pub fn handle_proxy_request(stream: &mut TcpStream, raw_uri: &str) {
    let query_str = raw_uri.split('?').nth(1).unwrap_or("");
    let mut target_url = String::new();
    for pair in query_str.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "url" {
                target_url = url_decode(v);
                break;
            }
        }
    }

    if target_url.is_empty() {
        let body = "<!DOCTYPE html><html><body><h3>Voktty Preview Proxy</h3><p>Missing <code>url</code> parameter.</p></body></html>";
        let resp = format!(
            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    record_last_proxied_url(&target_url);

    let result = ureq::get(&target_url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .set(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        )
        .set("Accept-Language", "en-US,en;q=0.9,es;q=0.8")
        .timeout(Duration::from_secs(15))
        .call();

    match result {
        Ok(response) => {
            let status = response.status();
            let status_text = response.status_text().to_string();
            let content_type = response.content_type().to_string();

            if content_type.contains("text/html") || content_type.contains("application/xhtml+xml")
            {
                let mut html = response.into_string().unwrap_or_default();
                let base_url = if let Ok(parsed) = url::Url::parse(&target_url) {
                    let mut base = parsed.clone();
                    let path = base.path().to_string();
                    if !path.ends_with('/') && !path.contains('.') {
                        base.set_path(&format!("{}/", path));
                    }
                    base.to_string()
                } else {
                    target_url.clone()
                };

                let base_tag = format!(
                    "<base href=\"{}\">\n<meta name=\"referrer\" content=\"no-referrer-when-downgrade\">\n<script>window.__VOKTTY_IS_PROXIED__ = true;</script>",
                    base_url
                );
                if let Some(pos) = html.find("<head>") {
                    html.insert_str(pos + 6, &format!("\n{}", base_tag));
                } else if let Some(pos) = html.find("<HEAD>") {
                    html.insert_str(pos + 6, &format!("\n{}", base_tag));
                } else if let Some(pos) = html.find("<html>") {
                    html.insert_str(pos + 6, &format!("<head>{}</head>", base_tag));
                } else {
                    html.insert_str(0, &format!("<head>{}</head>", base_tag));
                }

                let script_tag = format!("\n<script>\n{}\n</script>\n", INSPECTOR_BUNDLE_JS);
                if !html.contains("voktty-injected-inspector") && !html.contains("__voktty_inspector_active") {
                    if let Some(pos) = html.rfind("</body>") {
                        html.insert_str(pos, &script_tag);
                    } else if let Some(pos) = html.rfind("</html>") {
                        html.insert_str(pos, &script_tag);
                    } else {
                        html.push_str(&script_tag);
                    }
                }

                let bytes = html.as_bytes();
                let header = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                    status, status_text, bytes.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(bytes);
            } else {
                let header = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                    status, status_text, content_type
                );
                if stream.write_all(header.as_bytes()).is_ok() {
                    let mut reader = response.into_reader();
                    let mut buf = [0u8; 16384];
                    while let Ok(n) = reader.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        if stream.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                }
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            let body = format!(
                r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Proxy Error - Voktty Preview</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; padding: 3rem; background: #0f172a; color: #f8fafc; line-height: 1.6; max-width: 680px; margin: 0 auto; }}
    .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }}
    h2 {{ margin-top: 0; color: #ef4444; display: flex; align-items: center; gap: 0.5rem; }}
    code {{ background: #0f172a; color: #38bdf8; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.9em; word-break: break-all; }}
    .url {{ color: #94a3b8; font-size: 0.85em; margin-bottom: 1.5rem; word-break: break-all; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>⚠️ Unable to load remote URL</h2>
    <div class="url"><code>{}</code></div>
    <p>Failed to retrieve response from the remote server:</p>
    <p><code>{}</code></p>
  </div>
</body>
</html>"#,
                target_url, err_msg
            );
            let resp = format!(
                "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    }
}

pub fn handle_proxy_connection(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_uri = parts.next().unwrap_or("/");

    if method != "GET" && method != "HEAD" && method != "OPTIONS" {
        let resp =
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let clean_uri = sanitize_request_path(raw_uri);
    let decoded = url_decode(clean_uri);
    let relative = decoded.trim_start_matches('/');

    if relative == "__voktty_inspector.js" {
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/javascript; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n{}",
            INSPECTOR_BUNDLE_JS.len(),
            INSPECTOR_BUNDLE_JS
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if raw_uri.starts_with("/__voktty_proxy") || relative.starts_with("__voktty_proxy") {
        handle_proxy_request(&mut stream, raw_uri);
        return;
    }

    // Subresource forwarding for images, stylesheets, fonts, JS chunks, and media
    let mut referer_val: Option<String> = None;
    let mut accept_val: Option<String> = None;

    for line in lines {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("referer:") {
            let val = line["referer:".len()..].trim().to_string();
            if !val.is_empty() {
                referer_val = Some(val);
            }
        } else if lower.starts_with("accept:") {
            let val = line["accept:".len()..].trim().to_string();
            if !val.is_empty() {
                accept_val = Some(val);
            }
        }
    }

    let parent_target_url = referer_val
        .as_deref()
        .and_then(|r| {
            if let Some(pos) = r.find("/__voktty_proxy?url=") {
                let enc = &r[pos + "/__voktty_proxy?url=".len()..];
                let decoded_url = url_decode(enc.split('&').next().unwrap_or(enc));
                if !decoded_url.is_empty() {
                    return Some(decoded_url);
                }
            }
            if (r.starts_with("http://") || r.starts_with("https://"))
                && !r.contains("127.0.0.1")
                && !r.contains("localhost")
            {
                return Some(r.to_string());
            }
            None
        })
        .or_else(get_last_proxied_url);

    if let Some(parent_url) = parent_target_url {
        if let Ok(parent_parsed) = url::Url::parse(&parent_url) {
            let joined_res = if raw_uri.starts_with('/') {
                parent_parsed.join(raw_uri)
            } else {
                parent_parsed.join(&format!("/{}", raw_uri))
            };

            if let Ok(resolved_url) = joined_res {
                let target_sub_str = resolved_url.to_string();
                let mut req = ureq::get(&target_sub_str)
                    .set(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    )
                    .set("Referer", &parent_url)
                    .set("Accept-Language", "en-US,en;q=0.9,es;q=0.8")
                    .timeout(Duration::from_secs(12));

                if let Some(ref acc) = accept_val {
                    req = req.set("Accept", acc);
                }

                if let Ok(response) = req.call() {
                    let status = response.status();
                    let status_text = response.status_text().to_string();
                    let content_type = response.content_type().to_string();

                    let header = format!(
                        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n",
                        status, status_text, content_type
                    );

                    if stream.write_all(header.as_bytes()).is_ok() && method != "HEAD" {
                        let mut reader = response.into_reader();
                        let mut sbuf = [0u8; 16384];
                        while let Ok(read_n) = reader.read(&mut sbuf) {
                            if read_n == 0 {
                                break;
                            }
                            if stream.write_all(&sbuf[..read_n]).is_err() {
                                break;
                            }
                        }
                    }
                    return;
                }
            }
        }
    }

    let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(resp.as_bytes());
}

pub fn start_proxy_server_thread() -> Result<(u16, Arc<AtomicBool>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind preview proxy port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    let _ = listener.set_nonblocking(true);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop_flag);

    thread::spawn(move || {
        while !stop_clone.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    thread::spawn(move || {
                        handle_proxy_connection(stream);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    });

    Ok((port, stop_flag))
}

pub fn get_or_start_proxy_server(state: &WebServerState) -> Result<u16, String> {
    let mut guard = state.proxy_server.lock().map_err(|e| e.to_string())?;
    if let Some((port, stop_flag)) = &*guard {
        if !stop_flag.load(Ordering::Relaxed) {
            return Ok(*port);
        }
    }
    let (port, stop_flag) = start_proxy_server_thread()?;
    *guard = Some((port, stop_flag));
    Ok(port)
}

#[tauri::command]
pub async fn web_server_proxy_url(
    state: State<'_, WebServerState>,
    target_url: String,
) -> Result<String, String> {
    let port = get_or_start_proxy_server(&state)?;
    let encoded = url_encode(&target_url);
    Ok(format!(
        "http://127.0.0.1:{}/__voktty_proxy?url={}",
        port, encoded
    ))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ResolvedElementSource {
    pub file_path: String,
    pub relative_path: String,
    pub line_number: u64,
    pub column_number: usize,
    pub framework: String,
    pub matched_by: String,
}

fn is_generic_utility_class(class_name: &str) -> bool {
    let lower = class_name.to_ascii_lowercase();
    let lower = lower.trim();
    if lower.is_empty() || lower.starts_with("voktty-") {
        return true;
    }
    if matches!(
        lower,
        "row"
            | "col"
            | "container"
            | "container-fluid"
            | "flex"
            | "d-flex"
            | "block"
            | "inline-block"
            | "inline"
            | "grid"
            | "hidden"
            | "active"
            | "show"
            | "fade"
            | "clearfix"
            | "wrapper"
            | "content"
            | "main"
            | "box"
            | "card"
            | "card-body"
            | "btn"
            | "btn-primary"
            | "btn-secondary"
            | "btn-success"
            | "btn-danger"
            | "text-center"
            | "text-left"
            | "text-right"
            | "w-full"
            | "h-full"
            | "relative"
            | "absolute"
            | "fixed"
            | "static"
    ) {
        return true;
    }
    if lower.starts_with("col-")
        || lower.starts_with("aos-")
        || lower.starts_with("animate__")
        || lower.starts_with("p-")
        || lower.starts_with("m-")
        || lower.starts_with("pt-")
        || lower.starts_with("pb-")
        || lower.starts_with("pl-")
        || lower.starts_with("pr-")
        || lower.starts_with("px-")
        || lower.starts_with("py-")
        || lower.starts_with("mx-")
        || lower.starts_with("my-")
        || lower.starts_with("mt-")
        || lower.starts_with("mb-")
        || lower.starts_with("ml-")
        || lower.starts_with("mr-")
        || lower.starts_with("w-")
        || lower.starts_with("h-")
        || lower.starts_with("gap-")
        || lower.starts_with("space-")
        || lower.starts_with("justify-")
        || lower.starts_with("items-")
        || lower.starts_with("border-")
        || lower.starts_with("rounded-")
        || lower.starts_with("shadow-")
    {
        return true;
    }
    false
}

fn is_generic_ui_keyword(s: &str) -> bool {
    matches!(
        s.trim().to_ascii_lowercase().as_str(),
        "placeholder"
            | "loading"
            | "select"
            | "submit"
            | "button"
            | "title"
            | "text"
            | "content"
            | "item"
            | "items"
            | "value"
            | "label"
            | "icon"
            | "input"
            | "search"
            | "close"
            | "cancel"
            | "ok"
    )
}

fn detect_framework_from_extension(ext: &str) -> &'static str {
    match ext {
        "php" => "php",
        "blade" => "blade",
        "astro" => "astro",
        "vue" => "vue",
        "svelte" => "svelte",
        "tsx" | "jsx" => "react",
        "html" | "htm" => "html",
        "twig" => "twig",
        "liquid" => "liquid",
        "erb" => "erb",
        "ejs" => "ejs",
        "hbs" => "handlebars",
        _ => "template",
    }
}

pub fn parse_url_port_and_path(raw_url: &str) -> (Option<u16>, Option<String>) {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let without_scheme = if let Some(idx) = trimmed.find("://") {
        &trimmed[idx + 3..]
    } else {
        trimmed
    };

    let (host_port, path_and_query) = match without_scheme.find('/') {
        Some(idx) => (&without_scheme[..idx], &without_scheme[idx..]),
        None => (without_scheme, ""),
    };

    let port = if let Some(colon_idx) = host_port.find(':') {
        host_port[colon_idx + 1..].parse::<u16>().ok()
    } else {
        None
    };

    let path_clean = path_and_query
        .split('?')
        .next()
        .unwrap_or("")
        .split('#')
        .next()
        .unwrap_or("")
        .trim_start_matches('/');

    let path_opt = if path_clean.is_empty() {
        None
    } else {
        Some(path_clean.to_string())
    };

    (port, path_opt)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn web_server_resolve_element_source(
    state: State<'_, WebServerState>,
    root: Option<String>,
    url: Option<String>,
    tag_name: String,
    id_attr: Option<String>,
    classes: Vec<String>,
    parent_classes: Option<Vec<String>>,
    text_snippet: Option<String>,
) -> Result<Option<ResolvedElementSource>, String> {
    let (url_port, url_path) = url
        .as_deref()
        .map(parse_url_port_and_path)
        .unwrap_or((None, None));

    // 1. Try explicit root parameter if valid and not system path
    let mut resolved_root: Option<PathBuf> = None;
    if let Some(ref r) = root {
        let trimmed = r.trim();
        if !trimmed.is_empty() {
            if let Ok(clean) = normalize_root_path(trimmed) {
                if clean.is_dir() && !is_system_directory(&clean) {
                    resolved_root = Some(clean);
                }
            }
        }
    }

    // 2. If root not provided, resolve from active Web Server state using the port
    if resolved_root.is_none() {
        if let Some(port) = url_port {
            if let Ok(map) = state.servers.lock() {
                for server in map.values() {
                    match server {
                        RunningServer::Static {
                            port: sp,
                            root_path,
                            ..
                        } if *sp == port
                            && !is_system_directory(root_path)
                            && root_path.is_dir() =>
                        {
                            resolved_root = Some(root_path.clone());
                            break;
                        }
                        RunningServer::Php {
                            port: pp,
                            root_path,
                            ..
                        } if *pp == port
                            && !is_system_directory(root_path)
                            && root_path.is_dir() =>
                        {
                            resolved_root = Some(root_path.clone());
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // 3. Fallback to workspace launch snapshot if valid and not a system directory
    if resolved_root.is_none() {
        if let Some(snapshot) = crate::modules::workspace::launch_cwd_snapshot() {
            if snapshot.is_dir() && !is_system_directory(&snapshot) {
                resolved_root = Some(snapshot);
            }
        }
    }

    let clean_root = match resolved_root {
        Some(r) => r,
        None => return Ok(None),
    };

    let template_extensions = [
        "html", "htm", "php", "blade.php", "astro", "vue", "svelte", "tsx", "jsx",
        "twig", "liquid", "erb", "ejs", "hbs", "njk", "pug",
    ];

    let walker = ignore::WalkBuilder::new(&clean_root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .max_depth(Some(8))
        .follow_links(false)
        .build();

    let mut candidate_files: Vec<PathBuf> = Vec::new();
    for entry in walker.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let path = entry.into_path();
            let path_lower = path.to_string_lossy().to_ascii_lowercase();
            if template_extensions.iter().any(|ext| path_lower.ends_with(ext)) {
                candidate_files.push(path);
            }
        }
    }

    if candidate_files.is_empty() {
        return Ok(None);
    }

    // Sort candidate files to check direct URL target and index files first
    candidate_files.sort_by(|a, b| {
        let a_rel = a
            .strip_prefix(&clean_root)
            .unwrap_or(a)
            .to_string_lossy()
            .replace('\\', "/");
        let b_rel = b
            .strip_prefix(&clean_root)
            .unwrap_or(b)
            .to_string_lossy()
            .replace('\\', "/");

        let a_is_url = url_path
            .as_ref()
            .map(|u| a_rel.eq_ignore_ascii_case(u))
            .unwrap_or(false);
        let b_is_url = url_path
            .as_ref()
            .map(|u| b_rel.eq_ignore_ascii_case(u))
            .unwrap_or(false);

        if a_is_url && !b_is_url {
            std::cmp::Ordering::Less
        } else if !a_is_url && b_is_url {
            std::cmp::Ordering::Greater
        } else {
            let a_is_index = a_rel == "index.html" || a_rel == "index.php";
            let b_is_index = b_rel == "index.html" || b_rel == "index.php";
            if a_is_index && !b_is_index {
                std::cmp::Ordering::Less
            } else if !a_is_index && b_is_index {
                std::cmp::Ordering::Greater
            } else {
                a_rel.cmp(&b_rel)
            }
        }
    });

    let tag_lower = tag_name.to_ascii_lowercase();
    let mut best_score: u32 = 0;
    let mut best_result: Option<ResolvedElementSource> = None;

    for path in &candidate_files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let rel = path
            .strip_prefix(&clean_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        let is_target_url_file = if let Some(ref target) = url_path {
            rel.eq_ignore_ascii_case(target)
                || path
                    .file_name()
                    .and_then(|f| f.to_str())
                    .map(|f| f.eq_ignore_ascii_case(target))
                    .unwrap_or(false)
        } else {
            rel == "index.html" || rel == "index.php" || rel == "index.htm"
        };

        let url_bonus: u32 = if is_target_url_file { 30 } else { 0 };

        for (line_idx, line) in content.lines().enumerate() {
            let line_num = (line_idx + 1) as u64;
            let line_lower = line.to_ascii_lowercase();

            let mut line_score: u32 = 0;
            let mut matched_reason = String::new();
            let mut match_col: usize = 1;

            // 1. Exact / attribute ID match
            if let Some(ref id) = id_attr {
                let trimmed_id = id.trim();
                if trimmed_id.len() >= 2 {
                    let id_pat1 = format!("id=\"{}\"", trimmed_id.to_ascii_lowercase());
                    let id_pat2 = format!("id='{}'", trimmed_id.to_ascii_lowercase());
                    if let Some(pos) = line_lower.find(&id_pat1).or_else(|| line_lower.find(&id_pat2)) {
                        line_score += 100;
                        match_col = pos + 1;
                        matched_reason = format!("id:#{}", trimmed_id);
                    } else if line_lower.contains(&trimmed_id.to_ascii_lowercase()) {
                        line_score += 35;
                        match_col = line_lower.find(&trimmed_id.to_ascii_lowercase()).unwrap_or(0) + 1;
                        if matched_reason.is_empty() {
                            matched_reason = format!("id_approx:#{}", trimmed_id);
                        }
                    }
                }
            }

            // 2. Visible text snippet match
            if let Some(ref text) = text_snippet {
                let trimmed_text = text.trim();
                if trimmed_text.len() >= 4 {
                    let clean_text = trimmed_text.to_ascii_lowercase();
                    let is_generic = is_generic_ui_keyword(&clean_text);
                    if let Some(pos) = line_lower.find(&clean_text) {
                        let text_score = if is_generic { 15 } else { 80 };
                        line_score += text_score;
                        if match_col == 1 {
                            match_col = pos + 1;
                        }
                        if matched_reason.is_empty() {
                            matched_reason = if is_generic {
                                format!("text_kw:{}", clean_text)
                            } else {
                                "text_match".to_string()
                            };
                        }
                    }
                }
            }

            // 3. Classes match
            for c in &classes {
                if is_generic_utility_class(c) || c.len() < 3 {
                    continue;
                }
                let c_lower = c.to_ascii_lowercase();
                if let Some(pos) = line_lower.find(&c_lower) {
                    let has_tag = !tag_lower.is_empty() && line_lower.contains(&tag_lower);
                    let class_score = if has_tag { 50 } else { 30 };
                    line_score += class_score;
                    if match_col == 1 {
                        match_col = pos + 1;
                    }
                    if matched_reason.is_empty() {
                        matched_reason = format!("class:.{}", c);
                    }
                }
            }

            // 4. Parent classes match
            if let Some(ref parents) = parent_classes {
                for pc in parents {
                    let clean_pc = pc.trim_start_matches('#');
                    if is_generic_utility_class(clean_pc) || clean_pc.len() < 3 {
                        continue;
                    }
                    if line_lower.contains(&clean_pc.to_ascii_lowercase()) {
                        line_score += 15;
                        if matched_reason.is_empty() {
                            matched_reason = format!("parent_class:{}", clean_pc);
                        }
                    }
                }
            }

            if line_score > 0 {
                let total_score = line_score + url_bonus;
                if total_score > best_score {
                    best_score = total_score;
                    let ext = if rel.ends_with(".blade.php") {
                        "blade"
                    } else {
                        path.extension().and_then(|e| e.to_str()).unwrap_or("")
                    };
                    let framework = detect_framework_from_extension(ext).to_string();
                    best_result = Some(ResolvedElementSource {
                        file_path: path.to_string_lossy().to_string(),
                        relative_path: rel.clone(),
                        line_number: line_num,
                        column_number: match_col,
                        framework,
                        matched_by: matched_reason,
                    });
                }
            }
        }
    }

    if best_score >= 30 {
        Ok(best_result)
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_mime_detection() {
        assert_eq!(
            guess_mime(Path::new("index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            guess_mime(Path::new("style.css")),
            "text/css; charset=utf-8"
        );
        assert_eq!(
            guess_mime(Path::new("app.js")),
            "application/javascript; charset=utf-8"
        );
        assert_eq!(guess_mime(Path::new("icon.svg")), "image/svg+xml");
        assert_eq!(guess_mime(Path::new("image.webp")), "image/webp");
        assert_eq!(guess_mime(Path::new("font.woff2")), "font/woff2");
        assert_eq!(
            guess_mime(Path::new("unknown.xyz")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("a+b"), "a b");
        assert_eq!(url_decode("%2Fpath%2Fto%2Ffile"), "/path/to/file");
    }

    #[test]
    fn test_sanitize_request_path() {
        assert_eq!(sanitize_request_path("/index.html?v=123"), "/index.html");
        assert_eq!(sanitize_request_path("/page#section"), "/page");
    }

    #[test]
    fn test_static_server_serves_html() {
        let dir = tempdir().unwrap();
        let html_file = dir.path().join("index.html");
        fs::write(&html_file, "<h1>Hello Voktty</h1>").unwrap();

        let (port, stop_flag) = start_static_server_thread(dir.path().to_path_buf(), None).unwrap();
        assert!(port > 0);
        thread::sleep(Duration::from_millis(50));

        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        stream.read_to_string(&mut res).unwrap();

        assert!(res.starts_with("HTTP/1.1 200 OK"));
        assert!(res.contains("Content-Type: text/html; charset=utf-8"));
        assert!(res.contains("<h1>Hello Voktty</h1>"));

        stop_flag.store(true, Ordering::SeqCst);
    }

    #[test]
    fn test_is_system_directory() {
        assert!(is_system_directory(Path::new("C:\\Windows")));
        assert!(is_system_directory(Path::new("C:\\Windows\\System32")));
        assert!(is_system_directory(Path::new("D:\\Program Files")));
        assert!(is_system_directory(Path::new("C:\\")));
        assert!(is_system_directory(Path::new("C:")));
        assert!(is_system_directory(Path::new("/bin")));
        assert!(is_system_directory(Path::new("/usr/bin")));
        assert!(is_system_directory(Path::new("/etc")));
        assert!(is_system_directory(Path::new("/System/Library")));
        assert!(is_system_directory(Path::new("/")));

        assert!(!is_system_directory(Path::new("C:\\projects\\my-app")));
        assert!(!is_system_directory(Path::new("/workspace/project")));
        assert!(!is_system_directory(Path::new("/srv/http/site")));
    }

    #[test]
    fn test_parse_url_port_and_path() {
        let (port, path) = parse_url_port_and_path("http://127.0.0.1:2045/index.html");
        assert_eq!(port, Some(2045));
        assert_eq!(path.as_deref(), Some("index.html"));

        let (port, path) = parse_url_port_and_path("http://localhost:3000/pages/about.php?v=1#hash");
        assert_eq!(port, Some(3000));
        assert_eq!(path.as_deref(), Some("pages/about.php"));

        let (port, path) = parse_url_port_and_path("http://127.0.0.1:8080/");
        assert_eq!(port, Some(8080));
        assert_eq!(path, None);
    }
}
