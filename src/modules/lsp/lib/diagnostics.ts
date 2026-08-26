export type PublishedDiagnostics = {
  uri: string;
  diagnostics: unknown[];
};

export function readPublishedDiagnostics(
  notification: unknown,
): PublishedDiagnostics | null {
  if (typeof notification !== "object" || notification === null) return null;
  const candidate = notification as { method?: unknown; params?: unknown };
  if (candidate.method !== "textDocument/publishDiagnostics") return null;
  if (typeof candidate.params !== "object" || candidate.params === null) {
    return null;
  }
  const params = candidate.params as {
    uri?: unknown;
    diagnostics?: unknown;
  };
  if (typeof params.uri !== "string" || !Array.isArray(params.diagnostics)) {
    return null;
  }
  return { uri: params.uri, diagnostics: params.diagnostics };
}
