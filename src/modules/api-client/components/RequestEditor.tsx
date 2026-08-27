import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Add01Icon,
  Cancel01Icon,
  CodeIcon,
  Copy01Icon,
  FlashIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  exportToCurl,
  exportToFetch,
  exportToPython,
  parseCurlCommand,
} from "../lib/curlParser";
import { useApiClientStore } from "../store/apiClientStore";
import type { ApiMethod } from "../types";

const METHOD_COLORS: Record<ApiMethod, string> = {
  GET: "text-emerald-500 font-bold",
  POST: "text-blue-500 font-bold",
  PUT: "text-amber-500 font-bold",
  PATCH: "text-orange-500 font-bold",
  DELETE: "text-rose-500 font-bold",
  HEAD: "text-purple-500 font-bold",
  OPTIONS: "text-zinc-500 font-bold",
};

export function RequestEditor() {
  const { t } = useTranslation();
  const {
    activeRequest,
    isLoading,
    setUrl,
    setMethod,
    addHeader,
    updateHeader,
    removeHeader,
    addQueryParam,
    updateQueryParam,
    removeQueryParam,
    setBodyType,
    setBodyContent,
    setAuthType,
    setBearerToken,
    setApiKey,
    setBasicAuth,
    sendRequest,
    setActiveTab,
    setDiscoveryUrl,
    runDiscovery,
  } = useApiClientStore();

  const [activeSubTab, setActiveSubTab] = useState<
    "params" | "headers" | "auth" | "body" | "code"
  >("params");
  const [codeLanguage, setCodeLanguage] = useState<"curl" | "fetch" | "python">("curl");
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlImportText, setCurlImportText] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void sendRequest();
    }
  };

  const handleImportCurl = () => {
    const parsed = parseCurlCommand(curlImportText);
    if (!parsed || !parsed.url) {
      toast.error(t("common.error") || "Invalid cURL command");
      return;
    }
    if (parsed.url) setUrl(parsed.url);
    if (parsed.method) setMethod(parsed.method);
    if (parsed.headers && parsed.headers.length > 0) {
      for (const h of parsed.headers) {
        useApiClientStore.getState().activeRequest.headers.push(h);
      }
    }
    if (parsed.bodyType) setBodyType(parsed.bodyType);
    if (parsed.bodyContent) setBodyContent(parsed.bodyContent);
    setCurlImportOpen(false);
    setCurlImportText("");
    toast.success("cURL command imported successfully!");
  };

  const generatedCode =
    codeLanguage === "curl"
      ? exportToCurl(activeRequest)
      : codeLanguage === "fetch"
        ? exportToFetch(activeRequest)
        : exportToPython(activeRequest);

  return (
    <div className="flex h-full flex-col border-r border-border/40 bg-background/50" onKeyDown={handleKeyDown}>
      {/* Top Bar: Method + URL + Send */}
      <div className="flex items-center gap-2 border-b border-border/50 p-2.5">
        <Select
          value={activeRequest.method}
          onValueChange={(val) => setMethod(val as ApiMethod)}
        >
          <SelectTrigger className={cn("w-28 font-mono text-xs", METHOD_COLORS[activeRequest.method])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as ApiMethod[]).map((m) => (
              <SelectItem key={m} value={m} className={cn("font-mono text-xs", METHOD_COLORS[m])}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Input
            value={activeRequest.url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/v1/resource"
            className="font-mono text-xs"
          />
        </div>

        <Button
          size="sm"
          disabled={isLoading || !activeRequest.url.trim()}
          onClick={() => void sendRequest()}
          className="h-8 gap-1.5 px-3.5 text-xs font-semibold"
        >
          <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
          <span>{isLoading ? "Sending..." : "Send"}</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 px-2.5 text-xs text-primary hover:bg-primary/10"
          title="Auto-Discover routes from this Base URL"
          onClick={() => {
            setDiscoveryUrl(activeRequest.url);
            setActiveTab("browser");
            void runDiscovery(activeRequest.url);
          }}
        >
          <HugeiconsIcon icon={FlashIcon} size={13} />
          <span>Discover</span>
        </Button>

        <Button
          size="icon"
          variant="outline"
          className="size-8"
          title="Import cURL"
          onClick={() => setCurlImportOpen(!curlImportOpen)}
        >
          <HugeiconsIcon icon={CodeIcon} size={13} strokeWidth={1.75} />
        </Button>
      </div>

      {/* cURL Import Drawer */}
      {curlImportOpen && (
        <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/20 p-2.5 text-xs">
          <span className="font-semibold text-muted-foreground">Import from cURL Command:</span>
          <textarea
            value={curlImportText}
            onChange={(e) => setCurlImportText(e.target.value)}
            placeholder="curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{...}'"
            className="h-16 w-full rounded border border-border/60 bg-background p-2 font-mono text-[11px] outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCurlImportOpen(false)} className="h-6 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleImportCurl} className="h-6 text-xs font-medium">
              Import
            </Button>
          </div>
        </div>
      )}

      {/* Request Configuration Sub-tabs */}
      <Tabs
        value={activeSubTab}
        onValueChange={(v) => setActiveSubTab(v as typeof activeSubTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b border-border/40 px-2 pt-1">
          <TabsList className="h-8 bg-transparent p-0">
            <TabsTrigger value="params" className="h-7 text-xs data-[state=active]:bg-muted">
              Params {activeRequest.queryParams.filter((q) => q.enabled && q.key).length > 0 && `(${activeRequest.queryParams.filter((q) => q.enabled && q.key).length})`}
            </TabsTrigger>
            <TabsTrigger value="headers" className="h-7 text-xs data-[state=active]:bg-muted">
              Headers {activeRequest.headers.filter((h) => h.enabled && h.key).length > 0 && `(${activeRequest.headers.filter((h) => h.enabled && h.key).length})`}
            </TabsTrigger>
            <TabsTrigger value="auth" className="h-7 text-xs data-[state=active]:bg-muted">
              Auth {activeRequest.authType !== "none" && "•"}
            </TabsTrigger>
            <TabsTrigger value="body" className="h-7 text-xs data-[state=active]:bg-muted">
              Body {activeRequest.bodyType !== "none" && "•"}
            </TabsTrigger>
            <TabsTrigger value="code" className="h-7 text-xs data-[state=active]:bg-muted">
              Code
            </TabsTrigger>
          </TabsList>
        </div>

        {/* PARAMS TAB */}
        <TabsContent value="params" className="m-0 flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Query Parameters</span>
            <Button size="sm" variant="ghost" onClick={addQueryParam} className="h-6 gap-1 text-[10.5px]">
              <HugeiconsIcon icon={Add01Icon} size={11} /> Add Param
            </Button>
          </div>
          {activeRequest.queryParams.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/60">
              No query parameters. Click Add Param to append parameters to the URL.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activeRequest.queryParams.map((qp, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={qp.enabled}
                    onChange={(e) => updateQueryParam(idx, { enabled: e.target.checked })}
                    className="size-3.5 rounded"
                  />
                  <Input
                    value={qp.key}
                    onChange={(e) => updateQueryParam(idx, { key: e.target.value })}
                    placeholder="Key"
                    className="h-7 flex-1 font-mono text-xs"
                  />
                  <Input
                    value={qp.value}
                    onChange={(e) => updateQueryParam(idx, { value: e.target.value })}
                    placeholder="Value"
                    className="h-7 flex-1 font-mono text-xs"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeQueryParam(idx)}
                    className="size-7 text-muted-foreground hover:text-destructive"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* HEADERS TAB */}
        <TabsContent value="headers" className="m-0 flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">HTTP Headers</span>
            <Button size="sm" variant="ghost" onClick={addHeader} className="h-6 gap-1 text-[10.5px]">
              <HugeiconsIcon icon={Add01Icon} size={11} /> Add Header
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {activeRequest.headers.map((h, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => updateHeader(idx, { enabled: e.target.checked })}
                  className="size-3.5 rounded"
                />
                <Input
                  value={h.key}
                  onChange={(e) => updateHeader(idx, { key: e.target.value })}
                  placeholder="Header Name"
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Input
                  value={h.value}
                  onChange={(e) => updateHeader(idx, { value: e.target.value })}
                  placeholder="Value"
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeHeader(idx)}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* AUTH TAB */}
        <TabsContent value="auth" className="m-0 flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Auth Type:</span>
            <Select
              value={activeRequest.authType}
              onValueChange={(val) => setAuthType(val as typeof activeRequest.authType)}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Auth</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="apiKey">API Key</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {activeRequest.authType === "bearer" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-muted-foreground">Token:</span>
              <Input
                type="password"
                value={activeRequest.bearerToken ?? ""}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="sk_test_..."
                className="font-mono text-xs"
              />
            </div>
          )}

          {activeRequest.authType === "apiKey" && (
            <div className="flex flex-col gap-2">
              <div>
                <span className="text-[11px] text-muted-foreground">Key:</span>
                <Input
                  value={activeRequest.apiKey?.key ?? ""}
                  onChange={(e) => setApiKey(e.target.value, activeRequest.apiKey?.value ?? "", activeRequest.apiKey?.inHeader ?? true)}
                  placeholder="X-API-Key"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <span className="text-[11px] text-muted-foreground">Value:</span>
                <Input
                  type="password"
                  value={activeRequest.apiKey?.value ?? ""}
                  onChange={(e) => setApiKey(activeRequest.apiKey?.key ?? "", e.target.value, activeRequest.apiKey?.inHeader ?? true)}
                  placeholder="Value"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          {activeRequest.authType === "basic" && (
            <div className="flex flex-col gap-2">
              <div>
                <span className="text-[11px] text-muted-foreground">Username:</span>
                <Input
                  value={activeRequest.basicAuth?.username ?? ""}
                  onChange={(e) => setBasicAuth(e.target.value, activeRequest.basicAuth?.password ?? "")}
                  placeholder="user"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <span className="text-[11px] text-muted-foreground">Password:</span>
                <Input
                  type="password"
                  value={activeRequest.basicAuth?.password ?? ""}
                  onChange={(e) => setBasicAuth(activeRequest.basicAuth?.username ?? "", e.target.value)}
                  placeholder="password"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}
        </TabsContent>

        {/* BODY TAB */}
        <TabsContent value="body" className="m-0 flex min-h-0 flex-1 flex-col p-2">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Content Type:</span>
            <Select
              value={activeRequest.bodyType}
              onValueChange={(val) => setBodyType(val as typeof activeRequest.bodyType)}
            >
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="json">JSON (application/json)</SelectItem>
                <SelectItem value="text">Text (text/plain)</SelectItem>
                <SelectItem value="form-urlencoded">Form URL-encoded</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {activeRequest.bodyType !== "none" && (
            <textarea
              value={activeRequest.bodyContent}
              onChange={(e) => setBodyContent(e.target.value)}
              placeholder={activeRequest.bodyType === "json" ? '{\n  "key": "value"\n}' : "key=value"}
              className="flex-1 resize-none rounded-md border border-border/60 bg-muted/20 p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground outline-none focus:border-primary"
            />
          )}
        </TabsContent>

        {/* CODE EXPORT TAB */}
        <TabsContent value="code" className="m-0 flex min-h-0 flex-1 flex-col p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1.5">
              {(["curl", "fetch", "python"] as const).map((lang) => (
                <Badge
                  key={lang}
                  variant={codeLanguage === lang ? "default" : "outline"}
                  onClick={() => setCodeLanguage(lang)}
                  className="cursor-pointer text-[10px] capitalize"
                >
                  {lang === "fetch" ? "JavaScript fetch" : lang}
                </Badge>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(generatedCode);
                toast.success("Snippet copied to clipboard!");
              }}
              className="h-6 gap-1 text-[10.5px]"
            >
              <HugeiconsIcon icon={Copy01Icon} size={11} /> Copy
            </Button>
          </div>
          <pre className="flex-1 overflow-auto rounded border border-border/60 bg-muted/30 p-2.5 font-mono text-[11px] text-foreground">
            {generatedCode}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}
