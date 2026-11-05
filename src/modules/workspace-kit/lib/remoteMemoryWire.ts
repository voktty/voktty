import {
  memoryFailure,
  type RemoteMemorySource,
} from "@/modules/workspace-kit/lib/remoteMemorySource";
import { parseMemoryStorageDiagnostic } from "@/modules/workspace-kit/lib/memoryStorageDiagnostic";

export function memoryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    memoryFailure("unavailable");
  return value as Record<string, unknown>;
}

export function remoteMemoryRequest(
  source: RemoteMemorySource,
  command: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  const { handle, selection, review, revision } = args;
  const selected = { handle, selection };
  switch (command) {
    case "project_memory_open":
      return { operation: "open" };
    case "project_memory_close":
      return { operation: "close", handle };
    case "project_memory_select":
      return {
        operation: "select",
        handle,
        revision,
        path: source.checkSelection(args.path, args.environment),
        ...(args.inspectAncestors === true ? { inspectAncestors: true } : {}),
      };
    case "project_memory_discover":
      if (args.inspectionOnly !== true) memoryFailure("unsupported");
      return {
        operation: "inspect",
        ...selected,
      };
    case "project_memory_documents":
      return {
        operation: "documents",
        ...selected,
        root: source.hostRoot(args.root),
      };
    case "project_memory_preview": {
      const request = memoryRecord(args.request);
      source.checkSelection(request.destination, request.environment);
      return {
        operation: "preview",
        ...selected,
        revision: request.revision,
        inputs: request.inputs,
        links: request.links,
      };
    }
    case "project_memory_confirm_preview":
      return { operation: "confirm", ...selected, review };
    case "project_memory_cancel_preview":
      return { operation: "cancel", ...selected, revision };
    case "project_memory_review_recovery": {
      const request = memoryRecord(args.request);
      source.checkSelection(request.destination, request.environment);
      return {
        operation: "reviewRecovery",
        schema: 2,
        ...selected,
        revision: request.revision,
      };
    }
    case "project_memory_confirm_recovery": {
      const confirmation = memoryRecord(args.confirmation);
      return {
        operation: "confirmRecovery",
        schema: 2,
        ...selected,
        review: confirmation.review,
        digest: confirmation.digest,
      };
    }
    case "project_memory_cancel_recovery":
      return { operation: "cancelRecovery", ...selected, revision };
    case "project_memory_context_open":
      return { operation: "contextOpen" };
    case "project_memory_context_close":
      return { operation: "contextClose", context: handle };
    case "project_memory_context_read":
      return { operation: "contextRead", context: handle };
    case "project_memory_context_bind": {
      const request = memoryRecord(args.request);
      if (
        request.schema !== 2 ||
        Object.keys(request).some((key) => key !== "schema")
      )
        memoryFailure("invalidInput");
      return {
        operation: "contextBindProject",
        schema: 2,
        ...selected,
        context: args.context,
      };
    }

    default:
      return memoryFailure("unsupported");
  }
}

const errorCodes = new Set([
  "invalidInput",
  "denied",
  "cancelled",
  "timeout",
  "busy",
  "limit",
  "unsupported",
  "missingState",
  "invalidState",
  "legacyStateRequiresReview",
  "stale",
  "unavailable",
  "scope",
  "invalidRecovery",
  "pendingRecovery",
  "migrationUnsupported",
  "recoveryRequired",
  "conflict",
]);

export function remoteMemoryError(value: unknown): Error {
  const error = memoryRecord(value);
  const code =
    typeof error.code === "string" && errorCodes.has(error.code)
      ? error.code
      : "unavailable";
  let changes: Record<string, string[]> | undefined;
  if (error.changes !== undefined) {
    const data = memoryRecord(error.changes);
    changes = {};
    let bytes = 0;
    for (const key of [
      "created",
      "migrated",
      "cleaned",
      "possibleRecoveryFiles",
    ]) {
      const paths = data[key];
      if (!Array.isArray(paths) || paths.length > 4096)
        memoryFailure("unavailable");
      changes[key] = paths.map((path) => {
        if (
          typeof path !== "string" ||
          !path ||
          path.length > 4096 ||
          /[\\:\x00-\x1f\x7f]/.test(path) ||
          path.startsWith("/") ||
          path.split("/").some((part) => !part || part === "." || part === "..")
        )
          memoryFailure("unavailable");
        bytes += path.length;
        if (bytes > 256 * 1024) memoryFailure("limit");
        return path;
      });
    }
  }
  const storage = parseMemoryStorageDiagnostic(error);
  return Object.assign(new Error(`Project memory ${code}`), {
    code,
    ...(storage ? { storage } : {}),
    ...(changes ? { changes } : {}),
  });
}

export function remoteMemoryResult(
  source: RemoteMemorySource,
  value: unknown,
): unknown {
  const reply = memoryRecord(value);
  if (reply.schema !== 1 || typeof reply.ok !== "boolean")
    memoryFailure("unavailable");
  if (!reply.ok) throw remoteMemoryError(reply.error);
  if (!("result" in reply)) memoryFailure("unavailable");
  const result = reply.result;
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "root" in result
  ) {
    const data = memoryRecord(result);
    return {
      ...data,
      root: data.root === null ? null : source.displayRoot(data.root),
    };
  }
  return result;
}
