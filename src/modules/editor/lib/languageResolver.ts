import type { Extension } from "@codemirror/state";
import { extensionLanguages } from "@/modules/extensions";
import {
  extensionMap,
  filenameMap,
  type LanguageDefinition,
} from "./languageDefinitions";

export interface LanguageResult {
  ext: Extension;
  name: string;
  /** Canonical language id (primary extension), in sync with the resolved mode. */
  id: string;
}

const cache = new Map<string, LanguageResult | null>();
const extensionCacheIds = new WeakMap<object, number>();
let nextExtensionCacheId = 1;

function extensionCacheKey(language: object, id: string): string {
  let cacheId = extensionCacheIds.get(language);
  if (cacheId === undefined) {
    cacheId = nextExtensionCacheId++;
    extensionCacheIds.set(language, cacheId);
  }
  return `extension:${id}:${cacheId}`;
}

function basenameOf(filename: string): string {
  const lower = filename.toLowerCase();
  return lower.split(/[\\/]/).pop() ?? lower;
}

function extOf(base: string): string | null {
  const dot = base.lastIndexOf(".");
  if (dot === -1 || dot === base.length - 1) return null;
  return base.slice(dot + 1);
}

function prefixOf(base: string): string | null {
  const dot = base.indexOf(".", base.startsWith(".") ? 1 : 0);
  return dot > 0 ? base.slice(0, dot) : null;
}

function extensionLanguage(base: string) {
  const extension = extOf(base);
  for (const language of extensionLanguages.values()) {
    const matchesFilename = language.filenames?.some(
      (filename) => filename.toLowerCase() === base,
    );
    const matchesExtension = extension
      ? language.extensions.some(
          (candidate) => candidate.replace(/^\./, "").toLowerCase() === extension,
        )
      : false;
    if (matchesFilename || matchesExtension) return language;
  }
  return null;
}

// Order: exact filename, real extension, then filename prefix scoped to
// name-based languages (so `Dockerfile.web` resolves while Go never captures
// `go.sum`). Always returns a key so misses are negative-cached too.
function match(base: string): {
  key: string;
  def: LanguageDefinition | undefined;
} {
  const byName = filenameMap.get(base);
  if (byName) return { key: `name:${base}`, def: byName };

  const ext = extOf(base);
  if (ext) {
    const byExt = extensionMap.get(ext);
    if (byExt) return { key: `ext:${ext}`, def: byExt };
  }

  const prefix = prefixOf(base);
  if (prefix) {
    const byPrefix = filenameMap.get(prefix);
    if (byPrefix) return { key: `name:${prefix}`, def: byPrefix };
  }

  return { key: ext ? `ext:${ext}` : `name:${base}`, def: undefined };
}

export function resolveDisplayName(filename: string | null): string {
  if (!filename) return "Plain Text";
  const base = basenameOf(filename);
  const { def } = match(base);
  if (def) return def.name;
  const contributed = extensionLanguage(base);
  if (contributed) return contributed.name;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function resolveLanguageSync(filename: string): LanguageResult | null {
  const base = basenameOf(filename);
  const contributed = extensionLanguage(base);
  return cache.get(
    contributed ? extensionCacheKey(contributed, contributed.id) : match(base).key,
  ) ?? null;
}

export async function resolveLanguage(
  filename: string,
): Promise<LanguageResult | null> {
  const base = basenameOf(filename);
  const contributed = extensionLanguage(base);
  if (contributed) {
    const key = extensionCacheKey(contributed, contributed.id);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = {
      ext: await contributed.load(),
      name: contributed.name,
      id: contributed.id,
    };
    cache.set(key, result);
    return result;
  }
  const { key, def } = match(base);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (!def) return null;
  const result: LanguageResult = {
    ext: await def.loader(),
    name: def.name,
    id: def.extensions[0] ?? "",
  };
  cache.set(key, result);
  return result;
}

export function preloadLanguages(filenames: string[]): void {
  for (const f of filenames) void resolveLanguage(f).catch(() => {});
}
