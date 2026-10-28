import { z } from "zod";
import schemaText from "@/../templates/workspace-kit/contracts/memory-identity.schema.json?raw";
import {
  makeIssue,
  parseDocument,
} from "@/modules/workspace-kit/lib/validation";

const schema = z.fromJSONSchema(JSON.parse(schemaText));
const encoder = new TextEncoder();

export async function memoryProjectKey(text: string): Promise<string> {
  if (text.length > 16384 || encoder.encode(text).length > 16384)
    throw new z.ZodError([makeIssue("KIT_DOCUMENT_TOO_LARGE", [])]);
  const input = schema.parse(parseDocument(text)) as {
    kind: string;
    machineId: string;
    filesystemId: string;
    canonicalRoot: string;
  };
  const root = input.canonicalRoot;
  for (const field of ["machineId", "filesystemId"] as const) {
    if (!input[field].trim())
      throw new z.ZodError([makeIssue("KIT_IDENTITY_FIELD_INVALID", [field])]);
  }
  if (
    !(
      root.startsWith("/") ||
      root.startsWith("\\\\") ||
      /^[A-Za-z]:[/\\]/.test(root)
    )
  )
    throw new z.ZodError([
      makeIssue("KIT_IDENTITY_ROOT_INVALID", ["canonicalRoot"]),
    ]);
  const fields = [input.kind, input.machineId, input.filesystemId, root].map(
    (value) => encoder.encode(value),
  );
  if (fields.some((field) => field.length > 4096))
    throw new z.ZodError([makeIssue("KIT_IDENTITY_FIELD_TOO_LARGE", [])]);
  const domain = encoder.encode("voktty-memory-project-v1\0");
  const bytes = new Uint8Array(
    domain.length + fields.reduce((size, field) => size + 4 + field.length, 0),
  );
  bytes.set(domain);
  let offset = domain.length;
  const view = new DataView(bytes.buffer);
  for (const field of fields) {
    view.setUint32(offset, field.length, false);
    bytes.set(field, offset + 4);
    offset += 4 + field.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
