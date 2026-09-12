import { EXT_TO_LANGUAGE_ID } from "./constants";
import * as fileIconsMod from "./fileIcons";
import * as folderIconsMod from "./folderIcons";

const catFileNames = fileIconsMod.fileNames as Record<string, string>;
const catFileExtensions = fileIconsMod.fileExtensions as Record<string, string>;
const catLanguageIds = fileIconsMod.languageIds as Record<string, string>;
const catFolderNames = folderIconsMod.folderNames as Record<string, string>;

type IconifySet = {
  icons: Record<string, { body: string }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
};

let cat: IconifySet | null = null;
let iconLoad: Promise<void> | null = null;
let catWidth = 16;
let catHeight = 16;

const DEFAULT_FILE = "file";
const DEFAULT_FOLDER = "folder";
const DEFAULT_FOLDER_OPEN = "folder-open";

export const FILE_ICON_CATALOG_READY_EVENT = "voktty:file-icons-ready";

const dataUrlCache = new Map<string, string>();

const FALLBACK_BODIES: Record<string, string> = {
  file: '<path fill="currentColor" d="M3 1h6l4 4v10H3V1Zm6 1.5V6h3.5L9 2.5Z"/>',
  folder: '<path fill="currentColor" d="M1 4h5l2 2h7v9H1V4Zm1 2v7h12V7H7L5 5H2v1Z"/>',
  "folder-open": '<path fill="currentColor" d="M1 5h5l2 2h7l-2 7H1l2-9Zm2.6 2L2.1 13h10l1.4-6H3.6Z"/>',
};

function loadIconCatalog(): void {
  if (cat || iconLoad) return;
  iconLoad = import("@iconify-json/catppuccin/icons.json")
    .then((module) => {
      const loaded = module.default as IconifySet;
      cat = loaded;
      catWidth = loaded.width ?? 16;
      catHeight = loaded.height ?? 16;
      dataUrlCache.clear();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(FILE_ICON_CATALOG_READY_EVENT));
      }
    })
    .catch(() => undefined);
}

// Catppuccin's manifest emits names like `folder_src`/`typescript-react`, but
// the iconify export normalizes everything to hyphenated slugs.
function toIconifySlug(name: string): string {
  return name.replace(/_/g, "-");
}

function catBody(iconName: string): string | null {
  if (!cat) return FALLBACK_BODIES[iconName] ?? null;
  const slug = toIconifySlug(iconName);
  const direct = cat.icons[slug];
  if (direct) return direct.body;
  const alias = cat.aliases?.[slug];
  if (alias) {
    const parent = cat.icons[alias.parent];
    if (parent) return parent.body;
  }
  return null;
}

function buildDataUrl(iconName: string): string | null {
  const cached = dataUrlCache.get(iconName);
  if (cached !== undefined) return cached || null;
  const body = catBody(iconName);
  if (!body) {
    dataUrlCache.set(iconName, "");
    return null;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${catWidth} ${catHeight}">${body}</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  dataUrlCache.set(iconName, url);
  return url;
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.indexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

export function fileIconUrl(name: string): string {
  loadIconCatalog();
  const lower = name.toLowerCase();

  const byName = catFileNames[lower];
  if (byName) {
    const url = buildDataUrl(byName);
    if (url) return url;
  }

  let ext = extOf(lower);
  while (ext) {
    const iconName = catFileExtensions[ext];
    if (iconName) {
      const url = buildDataUrl(iconName);
      if (url) return url;
    }
    const langId = EXT_TO_LANGUAGE_ID[ext];
    if (langId) {
      const iconByLang = catLanguageIds[langId];
      if (iconByLang) {
        const url = buildDataUrl(iconByLang);
        if (url) return url;
      }
    }
    const nextDot = ext.indexOf(".");
    if (nextDot === -1) break;
    ext = ext.slice(nextDot + 1);
  }

  return buildDataUrl(DEFAULT_FILE) ?? "";
}

export function folderIconUrl(name: string, expanded: boolean): string {
  loadIconCatalog();
  const lower = name.toLowerCase();

  const mapped = catFolderNames[lower];
  if (mapped) {
    const slug = toIconifySlug(mapped);
    const target = expanded ? `${slug}-open` : slug;
    const url = buildDataUrl(target);
    if (url) return url;
  }

  return buildDataUrl(expanded ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER) ?? "";
}
