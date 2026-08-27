import type { ApiMethod, ApiRequest, KeyValueParam } from "../types";

export function parseCurlCommand(raw: string): Partial<ApiRequest> | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("curl")) return null;

  // Simple token parser handling quotes
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && i + 1 < trimmed.length && trimmed[i + 1] === "\n") {
      i++; // skip escaped newline
      continue;
    }

    if ((ch === '"' || ch === "'") && (i === 0 || trimmed[i - 1] !== "\\")) {
      if (inQuotes && quoteChar === ch) {
        inQuotes = false;
      } else if (!inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else {
        current += ch;
      }
    } else if (/\s/.test(ch) && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);

  let method: ApiMethod = "GET";
  let url = "";
  const headers: KeyValueParam[] = [];
  let bodyContent = "";
  let bodyType: ApiRequest["bodyType"] = "none";
  let authType: ApiRequest["authType"] = "none";
  let bearerToken: string | undefined;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "-X" || token === "--request") {
      const next = tokens[++i];
      if (next) method = next.toUpperCase() as ApiMethod;
    } else if (token === "-H" || token === "--header") {
      const next = tokens[++i];
      if (next) {
        const colonIdx = next.indexOf(":");
        if (colonIdx > -1) {
          const key = next.slice(0, colonIdx).trim();
          const value = next.slice(colonIdx + 1).trim();
          if (key.toLowerCase() === "authorization" && value.toLowerCase().startsWith("bearer ")) {
            authType = "bearer";
            bearerToken = value.slice(7).trim();
          } else {
            headers.push({
              key,
              value,
              enabled: true,
            });
          }
        }
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw") {
      const next = tokens[++i];
      if (next) {
        bodyContent = next;
        bodyType = next.startsWith("{") ? "json" : "text";
        if (method === "GET") method = "POST";
      }
    } else if (!token.startsWith("-") && !url) {
      url = token;
    }
  }

  return {
    url,
    method,
    headers,
    bodyType,
    bodyContent,
    authType,
    bearerToken,
  };
}

export function exportToCurl(req: ApiRequest): string {
  let fullUrl = req.url;
  const activeParams = (req.queryParams ?? []).filter((p) => p.enabled && p.key);
  if (activeParams.length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    fullUrl += sep + activeParams.map((p) => `${p.key}=${p.value}`).join("&");
  }

  const parts = [`curl -X ${req.method} "${fullUrl}"`];

  for (const h of req.headers ?? []) {
    if (h.enabled && h.key) {
      parts.push(`  -H "${h.key}: ${h.value}"`);
    }
  }

  if (req.authType === "bearer" && req.bearerToken) {
    parts.push(`  -H "Authorization: Bearer ${req.bearerToken}"`);
  }

  if (req.bodyType === "json" && req.bodyContent?.trim()) {
    const hasContentType = (req.headers ?? []).some(
      (h) => h.enabled && h.key.toLowerCase() === "content-type",
    );
    if (!hasContentType) {
      parts.push(`  -H "Content-Type: application/json"`);
    }
    parts.push(`  -d '${req.bodyContent.replace(/'/g, "\\'")}'`);
  } else if (req.bodyType === "text" && req.bodyContent?.trim()) {
    parts.push(`  -d '${req.bodyContent.replace(/'/g, "\\'")}'`);
  }

  return parts.join(" \\\n");
}

export function exportToFetch(req: ApiRequest): string {
  let fullUrl = req.url;
  const activeParams = (req.queryParams ?? []).filter((p) => p.enabled && p.key);
  if (activeParams.length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    fullUrl += sep + activeParams.map((p) => `${p.key}=${p.value}`).join("&");
  }

  const headersObj: Record<string, string> = {};
  for (const h of req.headers ?? []) {
    if (h.enabled && h.key) headersObj[h.key] = h.value;
  }
  if (req.authType === "bearer" && req.bearerToken) {
    headersObj["Authorization"] = `Bearer ${req.bearerToken}`;
  }
  if (req.bodyType === "json" && !headersObj["Content-Type"]) {
    headersObj["Content-Type"] = "application/json";
  }

  const options: Record<string, unknown> = {
    method: req.method,
    headers: headersObj,
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.bodyContent) {
    options.body = req.bodyType === "json" ? JSON.parse(req.bodyContent || "{}") : req.bodyContent;
  }

  return `const response = await fetch("${fullUrl}", ${JSON.stringify(options, null, 2)});
const data = await response.json();
console.log(data);`;
}

export function exportToPython(req: ApiRequest): string {
  let fullUrl = req.url;
  const activeParams = (req.queryParams ?? []).filter((p) => p.enabled && p.key);
  if (activeParams.length > 0) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    fullUrl += sep + activeParams.map((p) => `${p.key}=${p.value}`).join("&");
  }

  const headersObj: Record<string, string> = {};
  for (const h of req.headers ?? []) {
    if (h.enabled && h.key) headersObj[h.key] = h.value;
  }
  if (req.authType === "bearer" && req.bearerToken) {
    headersObj["Authorization"] = `Bearer ${req.bearerToken}`;
  }

  return `import requests

url = "${fullUrl}"
headers = ${JSON.stringify(headersObj, null, 2)}
${
  req.bodyType === "json" && req.bodyContent
    ? `json_data = ${req.bodyContent}\nresponse = requests.${req.method.toLowerCase()}(url, headers=headers, json=json_data)`
    : `response = requests.${req.method.toLowerCase()}(url, headers=headers)`
}

print(response.status_code)
print(response.text)`;
}

export const generateCurlCommand = exportToCurl;
export const generateJsFetch = exportToFetch;
export const generatePythonRequests = exportToPython;
