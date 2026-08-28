import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  FolderOpenIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useApiClientStore } from "../store/apiClientStore";
import type { ApiMethod, ApiRequest } from "../types";

export const METHOD_BADGES: Record<
  ApiMethod,
  { bg: string; text: string; label: string }
> = {
  GET: { bg: "bg-blue-500/10", text: "text-blue-400", label: "GET" },
  POST: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "POST" },
  PUT: { bg: "bg-amber-500/10", text: "text-amber-400", label: "PUT" },
  PATCH: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "PATCH" },
  DELETE: { bg: "bg-rose-500/10", text: "text-rose-400", label: "DEL" },
  HEAD: { bg: "bg-purple-500/10", text: "text-purple-400", label: "HEAD" },
  OPTIONS: { bg: "bg-zinc-500/10", text: "text-zinc-400", label: "OPT" },
  GQL: { bg: "bg-violet-500/10", text: "text-violet-400", label: "GQL" },
  SSE: { bg: "bg-teal-500/10", text: "text-teal-400", label: "SSE" },
  GRPC: { bg: "bg-indigo-500/10", text: "text-indigo-400", label: "gRPC" },
  WS: { bg: "bg-sky-500/10", text: "text-sky-400", label: "WS" },
};

export function ApiCollectionExplorer() {
  const {
    collections,
    activeCollectionId,
    activeRequest,
    setActiveCollection,
    createCollection,
    deleteCollection,
    createFolder,
    toggleFolder,
    deleteFolder,
    createRequest,
    selectRequest,
    deleteRequest,
  } = useApiClientStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [newColName, setNewColName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingCol, setIsCreatingCol] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const activeCollection =
    collections.find((c) => c.id === activeCollectionId) || collections[0];

  const handleCreateCollection = () => {
    if (!newColName.trim()) return;
    createCollection(newColName.trim());
    setNewColName("");
    setIsCreatingCol(false);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim() || !activeCollection) return;
    createFolder(activeCollection.id, newFolderName.trim());
    setNewFolderName("");
    setIsCreatingFolder(false);
  };

  const filterMatches = (req: ApiRequest) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      req.name.toLowerCase().includes(q) ||
      req.url.toLowerCase().includes(q) ||
      req.method.toLowerCase().includes(q)
    );
  };

  return (
    <div className="flex h-full w-full flex-col border-r border-border/50 bg-background/60 select-none">
      {/* Workspace / Collection Selector Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-[160px] justify-between gap-1 px-2 text-xs font-semibold hover:bg-muted/40"
            >
              <span className="truncate">{activeCollection?.name || "Collections"}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} className="shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 text-xs">
            <div className="px-2 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Collections
            </div>
            {collections.map((col) => (
              <DropdownMenuItem
                key={col.id}
                onClick={() => setActiveCollection(col.id)}
                className="group/item flex items-center justify-between"
              >
                <span className="truncate">{col.name}</span>
                <div className="flex items-center gap-1">
                  {col.id === activeCollection?.id && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                  {collections.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCollection(col.id);
                      }}
                      className="hidden size-3.5 items-center justify-center text-muted-foreground/60 hover:text-destructive group-hover/item:flex"
                      title="Delete Collection"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={10} />
                    </button>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsCreatingCol(true)}>
              <HugeiconsIcon icon={Add01Icon} size={13} className="mr-1.5" />
              <span>New Collection...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Quick Add Menu */}
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7" title="Add Request or Folder">
                <HugeiconsIcon icon={Add01Icon} size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 text-xs">
              <DropdownMenuItem onClick={() => createRequest(activeCollection?.id)}>
                <span>New Request</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsCreatingFolder(true)}>
                <span>New Folder</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Inline Create Collection Input */}
      {isCreatingCol && (
        <div className="flex items-center gap-1 border-b border-border/40 bg-muted/20 p-2">
          <Input
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder="Collection Name..."
            className="h-6 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateCollection();
              if (e.key === "Escape") setIsCreatingCol(false);
            }}
          />
          <Button size="sm" onClick={handleCreateCollection} className="h-6 px-2 text-[11px]">
            Save
          </Button>
        </div>
      )}

      {/* Inline Create Folder Input */}
      {isCreatingFolder && (
        <div className="flex items-center gap-1 border-b border-border/40 bg-muted/20 p-2">
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder Name (e.g. Auth, REST)..."
            className="h-6 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setIsCreatingFolder(false);
            }}
          />
          <Button size="sm" onClick={handleCreateFolder} className="h-6 px-2 text-[11px]">
            Add
          </Button>
        </div>
      )}

      {/* Search / Filter Filter */}
      <div className="relative border-b border-border/40 p-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={12}
          className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter requests..."
          className="h-6 pl-6 text-[11px]"
        />
      </div>

      {/* Tree Explorer Content */}
      <div className="flex-1 overflow-y-auto p-1.5 text-xs">
        {activeCollection?.folders.map((folder) => {
          const matchingRequests = folder.requests.filter(filterMatches);
          if (searchQuery.trim() && matchingRequests.length === 0) return null;

          return (
            <div key={folder.id} className="mb-1">
              {/* Folder Header */}
              <div
                onClick={() => toggleFolder(activeCollection.id, folder.id)}
                className="group flex cursor-pointer items-center justify-between rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
              >
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <HugeiconsIcon
                    icon={folder.isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                    size={11}
                    className="text-muted-foreground/70"
                  />
                  <HugeiconsIcon
                    icon={folder.isExpanded ? FolderOpenIcon : Folder01Icon}
                    size={13}
                    className="text-muted-foreground"
                  />
                  <span className="truncate font-semibold tracking-tight text-[11.5px]">
                    {folder.name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground/60">
                    {folder.requests.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFolder(activeCollection.id, folder.id);
                    }}
                    className="hidden size-4 items-center justify-center rounded text-muted-foreground/50 hover:text-destructive group-hover:flex"
                    title="Delete Folder"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={11} />
                  </button>
                </div>
              </div>

              {/* Folder Items */}
              {folder.isExpanded && (
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border/30 pl-1.5">
                  {matchingRequests.map((req) => {
                    const badge = METHOD_BADGES[req.method] || METHOD_BADGES.GET;
                    const isActive = activeRequest.id === req.id;

                    return (
                      <div
                        key={req.id}
                        onClick={() => selectRequest(req)}
                        className={cn(
                          "group relative flex cursor-pointer items-center justify-between rounded px-2 py-1 transition-all",
                          isActive
                            ? "bg-primary/10 text-foreground font-medium"
                            : "text-muted-foreground hover:bg-muted/25 hover:text-foreground",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "w-9 shrink-0 font-mono text-[9.5px] font-bold text-center rounded px-1 py-0.5",
                              badge.bg,
                              badge.text,
                            )}
                          >
                            {badge.label}
                          </span>
                          <span className="truncate text-[11px] leading-tight">
                            {req.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isActive && (
                            <span className="size-1.5 rounded-full bg-primary" />
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRequest(req.id);
                            }}
                            className="hidden size-4 items-center justify-center rounded text-muted-foreground/50 hover:text-destructive group-hover:flex"
                            title="Delete Request"
                          >
                            <HugeiconsIcon icon={Delete02Icon} size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Top-Level Requests */}
        {activeCollection?.requests.filter(filterMatches).map((req) => {
          const badge = METHOD_BADGES[req.method] || METHOD_BADGES.GET;
          const isActive = activeRequest.id === req.id;

          return (
            <div
              key={req.id}
              onClick={() => selectRequest(req)}
              className={cn(
                "group relative flex cursor-pointer items-center justify-between rounded px-2 py-1 transition-all",
                isActive
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/25 hover:text-foreground",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "w-9 shrink-0 font-mono text-[9.5px] font-bold text-center rounded px-1 py-0.5",
                    badge.bg,
                    badge.text,
                  )}
                >
                  {badge.label}
                </span>
                <span className="truncate text-[11px] leading-tight">
                  {req.name}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isActive && <span className="size-1.5 rounded-full bg-primary" />}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRequest(req.id);
                  }}
                  className="hidden size-4 items-center justify-center rounded text-muted-foreground/50 hover:text-destructive group-hover:flex"
                  title="Delete Request"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
