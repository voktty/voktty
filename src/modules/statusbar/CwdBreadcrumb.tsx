import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isPathInWorkspace, remoteReadDir } from "@/modules/remote";
import { currentWorkspaceEnv, workspaceForNativeFs } from "@/modules/workspace";
import {
  ArrowDown01Icon,
  Folder01Icon,
  Home03Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { segmentsFromCwd } from "./lib/pathUtils";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
};

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return "/";
  return path.slice(0, i);
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

export function CwdBreadcrumb({ cwd, filePath, home, onCd }: Props) {
  const { t } = useTranslation();
  // File mode: dir segments navigate; filename is the terminal leaf.
    if (filePath) {
    const dir = dirname(filePath);
    const name = basename(filePath);
    const segments = segmentsFromCwd(dir, home);
    const first = segments[0];
    const middle = segments.slice(1);
    return (
      <Breadcrumb>
        <BreadcrumbList className="gap-0.5 text-[10.5px] sm:gap-1" dir="ltr">
          {first ? (
            <BreadcrumbSegment
              label={first.label}
              isHome={first.isHome}
              onClick={() => onCd(first.fullPath)}
            />
          ) : null}
          {middle.length > 0 ? (
            <CollapsedSegments segments={middle} onCd={onCd} />
          ) : null}
          {middle.map((s) => (
            <span key={s.fullPath} className="contents max-md:hidden">
              <BreadcrumbSegment
                label={s.label}
                isHome={s.isHome}
                onClick={() => onCd(s.fullPath)}
              />
            </span>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage className="text-[10.5px] text-foreground">{name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (!cwd) {
    return (
      <span className="text-[10.5px] text-muted-foreground/70">{t("statusbar.cwd.noDirectory")}</span>
    );
  }

  const segments = segmentsFromCwd(cwd, home);
  const current = segments[segments.length - 1];
  const parents = segments.slice(0, -1);

  const firstParent = parents[0];
  const middleParents = parents.slice(1);
  return (
    <Breadcrumb>
      <BreadcrumbList className="gap-0.5 text-[10.5px] sm:gap-1" dir="ltr">
        {firstParent ? (
          <BreadcrumbSegment
            label={firstParent.label}
            isHome={firstParent.isHome}
            onClick={() => onCd(firstParent.fullPath)}
          />
        ) : null}
        {middleParents.length > 0 ? (
          <CollapsedSegments segments={middleParents} onCd={onCd} />
        ) : null}
        {middleParents.map((s) => (
          <span key={s.fullPath} className="contents max-md:hidden">
            <BreadcrumbSegment
              label={s.label}
              isHome={s.isHome}
              onClick={() => onCd(s.fullPath)}
            />
          </span>
        ))}
        <BreadcrumbItem>
          <CurrentSegmentDropdown
            label={current.label}
            path={current.fullPath}
            onCd={onCd}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbSegment({
  label,
  isHome,
  onClick,
}: {
  label: string;
  isHome: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <BreadcrumbItem>
        <BreadcrumbLink asChild>
          <button type="button" onClick={onClick} className="cursor-pointer">
            <Badge
              variant="outline"
              className="h-4.5 gap-0.5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {isHome ? (
                <HugeiconsIcon
                  icon={Home03Icon}
                  className="size-2.5"
                  strokeWidth={1.75}
                />
              ) : null}
              {isHome ? t("statusbar.cwd.home") : label}
            </Badge>
          </button>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-2.5" />
    </>
  );
}

function CurrentSegmentDropdown({
  label,
  path,
  onCd,
}: {
  label: string;
  path: string;
  onCd: (p: string) => void;
}) {
  const { t } = useTranslation();
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const workspace = currentWorkspaceEnv();
      const dirs =
        workspace.kind === "ssh" && isPathInWorkspace(workspace, path)
          ? (await remoteReadDir(workspace, path))
              .filter(
                (entry) =>
                  entry.kind === "dir" &&
                  (showHidden || !entry.name.startsWith(".")),
              )
              .map((entry) => `${path.replace(/\/+$/, "")}/${entry.name}`)
          : await invoke<string[]>("list_subdirs", {
              path,
              showHidden,
              workspace: workspaceForNativeFs(workspace, path),
            });
      setChildren(dirs);
    } catch (e) {
      setError(String(e));
      setChildren([]);
    }
  }, [path, showHidden]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <BreadcrumbPage className="flex cursor-pointer items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10.5px] text-foreground hover:bg-accent">
          {label === "~" ? (
            <>
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-2.5"
                strokeWidth={1.75}
              />
              {t("statusbar.cwd.home")}
            </>
          ) : (
            label
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-2.5 opacity-70"
            strokeWidth={2}
          />
        </BreadcrumbPage>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto text-[11px]">
        {children === null ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t("statusbar.cwd.loading")}
          </div>
        ) : children.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {error ?? t("statusbar.cwd.noSubfolders")}
          </div>
        ) : (
          children.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() =>
                onCd(path.endsWith("/") ? `${path}${name}` : `${path}/${name}`)
              }
              className="text-[11px]"
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-3 text-muted-foreground"
                strokeWidth={1.75}
              />
              {name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedSegments({
  segments,
  onCd,
}: {
  segments: { fullPath: string; label: string; isHome: boolean }[];
  onCd: (p: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="contents md:hidden">
      <BreadcrumbItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t("statusbar.cwd.showHidden")}
              className="flex items-center rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-2.5"
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44 text-[11px]">
            {segments.map((s) => (
              <DropdownMenuItem
                key={s.fullPath}
                onSelect={() => onCd(s.fullPath)}
                className="text-[11px]"
              >
                <HugeiconsIcon
                  icon={s.isHome ? Home03Icon : Folder01Icon}
                  className="size-3 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span className="truncate">{s.isHome ? t("statusbar.cwd.home") : s.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-2.5" />
    </span>
  );
}
