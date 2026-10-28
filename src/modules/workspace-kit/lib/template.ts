import { z } from "zod";
import {
  parseAgentRoster,
  parseKitConfig,
} from "@/modules/workspace-kit/lib/validation";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TEMPLATE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const placeholderPattern = /\{([a-z][a-z0-9_]*)\}/g;
const sourcePath = z
  .string()
  .max(256)
  .regex(/^(?:dot-voktty|root)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine((path) =>
    path.split("/").every((part) => part !== "." && part !== ".."),
  );
const manifestSchema = z
  .object({
    schema: z.literal(1),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(32),
    files: z
      .array(
        z
          .object({
            source: sourcePath,
            kind: z.enum(["base", "content", "link"]),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict();
const placeholdersSchema = z
  .object({
    version: z.literal(1),
    syntax: z.string(),
    placeholders: z
      .array(
        z
          .object({
            name: z
              .string()
              .regex(/^[a-z][a-z0-9_]*$/)
              .max(64),
            description: z.string(),
            required: z.boolean(),
            default: z.string().nullable(),
            source: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

export type KitFile = Readonly<{
  path: string;
  kind: "base" | "content" | "link";
  text: string;
}>;
export type KitTemplate = Readonly<{
  version: string;
  files: readonly KitFile[];
  placeholders: readonly Readonly<{
    name: string;
    required: boolean;
    default: string | null;
  }>[];
}>;

export function parseKitTemplate(
  resources: Readonly<Record<string, string>>,
): KitTemplate {
  for (const path of ["manifest.json", "placeholders.json"]) {
    if (
      typeof resources[path] !== "string" ||
      encoder.encode(resources[path]).byteLength > MAX_FILE_BYTES
    ) {
      throw new Error(`Missing or oversized kit metadata: ${path}`);
    }
  }
  const manifest = manifestSchema.parse(JSON.parse(resources["manifest.json"]));
  const definitions = placeholdersSchema.parse(
    JSON.parse(resources["placeholders.json"]),
  );
  const names = new Set(definitions.placeholders.map((entry) => entry.name));
  if (names.size !== definitions.placeholders.length)
    throw new Error("Duplicate kit placeholder");
  const paths = new Set<string>();
  const used = new Set<string>();
  let totalBytes = 0;
  const files = manifest.files.map((entry): KitFile => {
    const path = entry.source
      .replace(/^dot-voktty\//, ".voktty/")
      .replace(/^root\//, "");
    if (paths.has(path.toLowerCase()))
      throw new Error(`Duplicate kit path: ${path}`);
    paths.add(path.toLowerCase());
    if ((entry.kind === "link") !== entry.source.startsWith("root/")) {
      throw new Error(`Invalid kit file kind: ${path}`);
    }
    const text = resources[entry.source];
    if (typeof text !== "string")
      throw new Error(`Missing kit resource: ${entry.source}`);
    const size = encoder.encode(text).byteLength;
    totalBytes += size;
    if (
      size > MAX_FILE_BYTES ||
      totalBytes > MAX_TEMPLATE_BYTES ||
      text.includes("\0")
    ) {
      throw new Error(`Kit resource exceeds limits: ${path}`);
    }
    for (const match of text.matchAll(placeholderPattern)) {
      if (!names.has(match[1]))
        throw new Error(`Unknown kit placeholder: ${match[1]}`);
      used.add(match[1]);
    }
    return Object.freeze({ path, kind: entry.kind, text });
  });
  if (used.size !== names.size)
    throw new Error("Unused kit placeholder definition");
  const listed = new Set(manifest.files.map((entry) => entry.source));
  for (const path of [
    "INIT.md",
    "RULES.md",
    "INDEX.md",
    "PROJECT.md",
    "CONTEXT.md",
    "kit.json",
    ".gitignore",
  ]) {
    if (!listed.has(`dot-voktty/${path}`))
      throw new Error(`Missing required kit file: ${path}`);
  }
  for (const path of Object.keys(resources)) {
    if (/^(dot-voktty|root)\//.test(path) && !listed.has(path)) {
      throw new Error(`Unlisted kit resource: ${path}`);
    }
  }
  return Object.freeze({
    version: manifest.version,
    files: Object.freeze(files),
    placeholders: Object.freeze(
      definitions.placeholders.map((entry) =>
        Object.freeze({
          name: entry.name,
          required: entry.required,
          default: entry.default,
        }),
      ),
    ),
  });
}

export function renderKitTemplate(
  template: KitTemplate,
  inputs: Readonly<Record<string, unknown>>,
): readonly KitFile[] {
  const names = new Set(template.placeholders.map((entry) => entry.name));
  const suppliedNames = new Set(Object.keys(inputs));
  for (const name of suppliedNames) {
    if (!names.has(name)) throw new Error(`Unknown kit value: ${name}`);
  }
  const values = new Map<string, string>();
  for (const entry of template.placeholders) {
    const supplied = suppliedNames.has(entry.name)
      ? inputs[entry.name]
      : undefined;
    const value =
      entry.name === "kit_version"
        ? template.version
        : supplied === undefined
          ? entry.default
          : supplied;
    if (
      entry.name === "kit_version" &&
      supplied !== undefined &&
      supplied !== template.version
    ) {
      throw new Error("kit_version must match the template manifest");
    }
    if (
      typeof value !== "string" ||
      (entry.required && !value.trim()) ||
      encoder.encode(value).byteLength > 16 * 1024 ||
      value.includes("\0") ||
      /\{[a-z][a-z0-9_]*\}/.test(value)
    ) {
      throw new Error(`Invalid or missing kit value: ${entry.name}`);
    }
    values.set(entry.name, value);
  }
  let totalBytes = 0;
  const rendered = Object.freeze(
    template.files.map((file) => {
      const json = file.path.endsWith(".json");
      const text = file.text.replace(
        placeholderPattern,
        (_match, name: string) => {
          const value = values.get(name);
          if (value === undefined)
            throw new Error(`Unknown kit placeholder: ${name}`);
          return json ? JSON.stringify(value).slice(1, -1) : value;
        },
      );
      if (json) JSON.parse(text);
      const size = encoder.encode(text).byteLength;
      totalBytes += size;
      if (size > MAX_FILE_BYTES || totalBytes > MAX_TEMPLATE_BYTES) {
        throw new Error(`Rendered kit exceeds limits: ${file.path}`);
      }
      return Object.freeze({ ...file, text });
    }),
  );
  const configFile = rendered.find((file) => file.path === ".voktty/kit.json");
  if (!configFile) throw new Error("Missing rendered kit configuration");
  const config = parseKitConfig(configFile.text);
  if (config.roster) {
    const rosterFile = rendered.find(
      (file) => file.path === `.voktty/${config.roster}`,
    );
    if (!rosterFile) throw new Error("Missing rendered kit roster");
    parseAgentRoster(rosterFile.text, "insensitive");
  }
  return rendered;
}
