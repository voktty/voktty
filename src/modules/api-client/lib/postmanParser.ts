import type { ApiAuthType, ApiMethod, ApiRequest, ApiRequestBodyType, KeyValueParam } from "../types";

export type PostmanImportResult = {
  collectionName: string;
  requests: ApiRequest[];
  error?: string;
};

type PostmanHeader = {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
};

type PostmanQuery = {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
};

type PostmanUrl =
  | string
  | {
      raw?: string;
      query?: PostmanQuery[];
    };

type PostmanBody = {
  mode?: "raw" | "urlencoded" | "formdata" | "file";
  raw?: string;
  urlencoded?: { key: string; value: string; disabled?: boolean }[];
  options?: {
    raw?: {
      language?: string;
    };
  };
};

type PostmanAuth = {
  type?: string;
  bearer?: { key: string; value: string }[];
  basic?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
};

type PostmanItem = {
  name?: string;
  request?: {
    method?: string;
    url?: PostmanUrl;
    header?: PostmanHeader[];
    body?: PostmanBody;
    auth?: PostmanAuth;
    description?: string;
  };
  item?: PostmanItem[];
};

type PostmanCollection = {
  info?: {
    name?: string;
    schema?: string;
  };
  item?: PostmanItem[];
};

export function parsePostmanCollection(content: string): PostmanImportResult {
  let parsed: PostmanCollection;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      collectionName: "Import Error",
      requests: [],
      error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const collectionName = parsed.info?.name || "Imported Collection";
  const requests: ApiRequest[] = [];

  function processItems(items: PostmanItem[] | undefined, prefix = "") {
    if (!items || !Array.isArray(items)) return;

    for (const item of items) {
      if (item.item && Array.isArray(item.item)) {
        const folderName = item.name ? `${prefix}${item.name} / ` : prefix;
        processItems(item.item, folderName);
      } else if (item.request) {
        const req = item.request;
        const name = `${prefix}${item.name || "Untitled Request"}`;

        let rawUrl = "";
        const queryParams: KeyValueParam[] = [];

        if (typeof req.url === "string") {
          rawUrl = req.url;
        } else if (req.url && typeof req.url === "object") {
          rawUrl = req.url.raw || "";
          if (Array.isArray(req.url.query)) {
            for (const q of req.url.query) {
              if (q.key) {
                queryParams.push({
                  key: q.key,
                  value: q.value || "",
                  enabled: !q.disabled,
                  description: q.description,
                });
              }
            }
          }
        }

        const method = (req.method?.toUpperCase() || "GET") as ApiMethod;

        const headers: KeyValueParam[] = [];
        if (Array.isArray(req.header)) {
          for (const h of req.header) {
            if (h.key) {
              headers.push({
                key: h.key,
                value: h.value || "",
                enabled: !h.disabled,
                description: h.description,
              });
            }
          }
        }

        let bodyType: ApiRequestBodyType = "none";
        let bodyContent = "";

        if (req.body) {
          if (req.body.mode === "raw") {
            bodyContent = req.body.raw || "";
            const isJson =
              req.body.options?.raw?.language === "json" ||
              headers.some(
                (h) =>
                  h.key.toLowerCase() === "content-type" &&
                  h.value.toLowerCase().includes("application/json"),
              );
            bodyType = isJson ? "json" : "text";
          } else if (req.body.mode === "urlencoded" && Array.isArray(req.body.urlencoded)) {
            bodyType = "form-urlencoded";
            bodyContent = req.body.urlencoded
              .filter((p) => !p.disabled && p.key)
              .map((p) => `${p.key}=${p.value || ""}`)
              .join("\n");
          }
        }

        let authType: ApiAuthType = "none";
        let bearerToken: string | undefined;
        let apiKey: { key: string; value: string; inHeader: boolean } | undefined;
        let basicAuth: { username: string; password: string } | undefined;

        if (req.auth) {
          if (req.auth.type === "bearer" && Array.isArray(req.auth.bearer)) {
            authType = "bearer";
            const tokenEntry = req.auth.bearer.find((b) => b.key === "token");
            bearerToken = tokenEntry?.value;
          } else if (req.auth.type === "basic" && Array.isArray(req.auth.basic)) {
            authType = "basic";
            const user = req.auth.basic.find((b) => b.key === "username")?.value || "";
            const pass = req.auth.basic.find((b) => b.key === "password")?.value || "";
            basicAuth = { username: user, password: pass };
          } else if (req.auth.type === "apikey" && Array.isArray(req.auth.apikey)) {
            authType = "apiKey";
            const key = req.auth.apikey.find((b) => b.key === "key")?.value || "";
            const val = req.auth.apikey.find((b) => b.key === "value")?.value || "";
            const where = req.auth.apikey.find((b) => b.key === "where")?.value;
            apiKey = {
              key,
              value: val,
              inHeader: where !== "query",
            };
          }
        }

        requests.push({
          id: `postman_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          url: rawUrl,
          method,
          headers,
          queryParams,
          bodyType,
          bodyContent,
          authType,
          bearerToken,
          apiKey,
          basicAuth,
        });
      }
    }
  }

  processItems(parsed.item);

  return {
    collectionName,
    requests,
  };
}
