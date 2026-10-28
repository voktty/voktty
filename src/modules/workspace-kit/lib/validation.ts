import { z } from "zod";
import kitSchemaText from "@/../templates/workspace-kit/dot-voktty/kit.schema.json?raw";
import rosterSchemaText from "@/../templates/workspace-kit/dot-voktty/team/agents.schema.json?raw";
import lockSchemaText from "@/../templates/workspace-kit/contracts/kit-lock.schema.json?raw";
import type {
  AgentRoster,
  KitConfig,
  KitLock,
} from "@/modules/workspace-kit/lib/configTypes";

const kitSchema = z.fromJSONSchema(JSON.parse(kitSchemaText));
const rosterContract = JSON.parse(rosterSchemaText);
const lockSchema = z.fromJSONSchema(JSON.parse(lockSchemaText));
const rosterSchema = z.fromJSONSchema(rosterContract);
const adapterSchema = z.fromJSONSchema(rosterContract.$defs.adapter);
const encoder = new TextEncoder();
const MAX_JSON_BYTES = 256 * 1024;
export type KitValidationCode =
  | "KIT_DOCUMENT_TOO_LARGE"
  | "KIT_DOCUMENT_INVALID_JSON"
  | "KIT_DOCUMENT_NODE_LIMIT"
  | "KIT_DOCUMENT_INVALID_UNICODE"
  | "KIT_PROJECT_BLANK"
  | "KIT_PROJECT_INVALID"
  | "KIT_ADAPTER_UNKNOWN"
  | "KIT_VALUE_INVALID"
  | "KIT_VALUE_MISMATCH"
  | "KIT_PATH_CASE_REQUIRED"
  | "KIT_AGENT_DUPLICATE_NAME"
  | "KIT_AGENT_ADAPTER_REQUIRED"
  | "KIT_GENERIC_COMMAND_REQUIRED"
  | "KIT_COMMAND_FOR_GENERIC_ONLY"
  | "KIT_RUNTIME_CONTROL_CHAR"
  | "KIT_PATH_CONTROL_CHAR"
  | "KIT_OWNERSHIP_OVERLAP"
  | "KIT_MESSAGES_DUPLICATE"
  | "KIT_LOCK_PATH_INVALID"
  | "KIT_LOCK_PATH_DUPLICATE";

type Issue = { code: "custom"; path: (string | number)[]; message: string };

function makeIssue(code: KitValidationCode, path: (string | number)[]): Issue {
  return { code: "custom", path, message: code };
}

export function isUnicodeScalarText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function parseDocument(text: string): unknown {
  if (
    text.length > MAX_JSON_BYTES ||
    encoder.encode(text).byteLength > MAX_JSON_BYTES
  ) {
    throw new z.ZodError([makeIssue("KIT_DOCUMENT_TOO_LARGE", [])]);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new z.ZodError([makeIssue("KIT_DOCUMENT_INVALID_JSON", [])]);
  }
  const pending: unknown[] = [document];
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 16384)
      throw new z.ZodError([makeIssue("KIT_DOCUMENT_NODE_LIMIT", [])]);
    const current = pending.pop();
    if (typeof current === "string" && !isUnicodeScalarText(current)) {
      throw new z.ZodError([makeIssue("KIT_DOCUMENT_INVALID_UNICODE", [])]);
    }
    if (current !== null && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        if (!isUnicodeScalarText(key))
          throw new z.ZodError([makeIssue("KIT_DOCUMENT_INVALID_UNICODE", [])]);
        pending.push(value);
      }
    }
  }
  return document;
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function parseKitConfig(text: string): KitConfig {
  const config = kitSchema.parse(parseDocument(text)) as KitConfig;
  const issues: Issue[] = [];
  if (!config.project.trim())
    issues.push(makeIssue("KIT_PROJECT_BLANK", ["project"]));
  if (
    config.project.includes("\0") ||
    /\{[a-z][a-z0-9_]*\}/.test(config.project)
  )
    issues.push(makeIssue("KIT_PROJECT_INVALID", ["project"]));
  if (config.values) {
    if (!adapterSchema.safeParse(config.values.default_runtime).success) {
      issues.push(
        makeIssue("KIT_ADAPTER_UNKNOWN", ["values", "default_runtime"]),
      );
    }
    for (const [key, value] of Object.entries(config.values)) {
      if (
        encoder.encode(value).byteLength > 16 * 1024 ||
        value.includes("\0") ||
        /\{[a-z][a-z0-9_]*\}/.test(value)
      ) {
        issues.push(makeIssue("KIT_VALUE_INVALID", ["values", key]));
      }
    }
    for (const [key, expected] of [
      ["project_name", config.project],
      ["language", config.language],
      ["created_at", config.createdAt],
      ["kit_version", config.kitVersion],
    ] as const) {
      if (config.values[key] !== expected)
        issues.push(makeIssue("KIT_VALUE_MISMATCH", ["values", key]));
    }
  }
  if (issues.length) throw new z.ZodError(issues);
  return freezeJson(config);
}

export function parseKitLock(text: string): KitLock {
  if (encoder.encode(text).byteLength > 64 * 1024)
    throw new z.ZodError([makeIssue("KIT_DOCUMENT_TOO_LARGE", [])]);
  const lock = lockSchema.parse(parseDocument(text)) as KitLock;
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const [index, base] of lock.bases.entries()) {
    const parts = base.path.split("/");
    const path = ["bases", index, "path"];
    if (
      parts.some((part) => part === "." || part === "..") ||
      /^(?:state|mailbox|locks|sessions|tasks|tasks\.json|tools\.json|kit\.lock\.json)$/i.test(
        parts[1],
      )
    )
      issues.push(makeIssue("KIT_LOCK_PATH_INVALID", path));
    const key = base.path.toLowerCase();
    if (seen.has(key)) issues.push(makeIssue("KIT_LOCK_PATH_DUPLICATE", path));
    seen.add(key);
  }
  if (issues.length) throw new z.ZodError(issues);
  return freezeJson(lock);
}

function ownershipKey(
  path: string,
  pathCase: "sensitive" | "insensitive",
): string {
  const normalized = path
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
  return pathCase === "insensitive" ? normalized.toLowerCase() : normalized;
}

function overlaps(left: string, right: string): boolean {
  return (
    !left ||
    !right ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function parseAgentRoster(
  text: string,
  pathCase: "sensitive" | "insensitive",
): AgentRoster {
  if (pathCase !== "sensitive" && pathCase !== "insensitive")
    throw new z.ZodError([makeIssue("KIT_PATH_CASE_REQUIRED", ["pathCase"])]);
  const roster = rosterSchema.parse(parseDocument(text)) as AgentRoster;
  const issues: Issue[] = [];
  const names = new Set<string>();
  const ownership: { key: string; agent: number }[] = [];
  roster.agents.forEach((agent, index) => {
    if (names.has(agent.name))
      issues.push(
        makeIssue("KIT_AGENT_DUPLICATE_NAME", ["agents", index, "name"]),
      );
    names.add(agent.name);
    const runtime = { ...roster.defaults?.runtime, ...agent.runtime };
    if (!runtime.adapter)
      issues.push(
        makeIssue("KIT_AGENT_ADAPTER_REQUIRED", [
          "agents",
          index,
          "runtime",
          "adapter",
        ]),
      );
    if (runtime.adapter === "generic" && !runtime.command?.trim())
      issues.push(
        makeIssue("KIT_GENERIC_COMMAND_REQUIRED", [
          "agents",
          index,
          "runtime",
          "command",
        ]),
      );
    if (runtime.command !== undefined && runtime.adapter !== "generic")
      issues.push(
        makeIssue("KIT_COMMAND_FOR_GENERIC_ONLY", [
          "agents",
          index,
          "runtime",
          "command",
        ]),
      );
    for (const [key, value] of Object.entries(runtime)) {
      if (/[\u0000-\u001f\u007f]/.test(value))
        issues.push(
          makeIssue("KIT_RUNTIME_CONTROL_CHAR", [
            "agents",
            index,
            "runtime",
            key,
          ]),
        );
    }
    const paths: { path: (string | number)[]; value: string }[] = [
      ...(agent.workdir === undefined
        ? []
        : [{ path: ["agents", index, "workdir"], value: agent.workdir }]),
      ...(agent.owns ?? []).map((value, offset) => ({
        path: ["agents", index, "owns", offset],
        value,
      })),
      ...(agent.reads ?? []).map((value, offset) => ({
        path: ["agents", index, "reads", offset],
        value,
      })),
    ];
    for (const entry of paths) {
      if (/[\u0000-\u001f\u007f]/.test(entry.value))
        issues.push(makeIssue("KIT_PATH_CONTROL_CHAR", entry.path));
    }
    for (const [offset, path] of (agent.owns ?? []).entries()) {
      const key = ownershipKey(path, pathCase);
      if (
        ownership.some(
          (other) => other.agent !== index && overlaps(other.key, key),
        )
      ) {
        issues.push(
          makeIssue("KIT_OWNERSHIP_OVERLAP", ["agents", index, "owns", offset]),
        );
      }
      ownership.push({ key, agent: index });
    }
  });
  const messages = roster.policies?.messages ?? [];
  if (new Set(messages).size !== messages.length)
    issues.push(makeIssue("KIT_MESSAGES_DUPLICATE", ["policies", "messages"]));
  if (issues.length) throw new z.ZodError(issues);
  return freezeJson(roster);
}
