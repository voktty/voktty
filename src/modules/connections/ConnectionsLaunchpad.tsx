import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useDockerStore } from "@/modules/docker";
import { useTranslation } from "@/modules/i18n";
import { type RdpConnectionProfile, useRdpConnections } from "@/modules/rdp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  formatSshSubtitle,
  type SshConnection,
  useSshConnections,
} from "@/modules/ssh";
import { labelFor, type Tab } from "@/modules/tabs";
import {
  type DockerWorkspaceConnection,
  useWorkspaceEnvStore,
} from "@/modules/workspace";
import {
  Add01Icon,
  ArrowRight01Icon,
  ComputerIcon,
  ComputerTerminal02Icon,
  Search01Icon,
  ServerStack01Icon,
  UsbIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConnectionItem = {
  id: string;
  section: "active" | "available";
  label: string;
  detail: string;
  type: string;
  icon: typeof ComputerTerminal02Icon;
  run: () => void;
};

export type ConnectionsLaunchpadProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: Tab[];
  activeTabId: number;
  onSelectTab: (tab: Tab) => void;
  onConnectSsh: (connection: SshConnection) => void;
  onNewSsh: () => void;
  onNewWsl: (distro: string) => void;
  onConnectDocker: (connection: DockerWorkspaceConnection) => void;
  onConnectRdp: (connection: RdpConnectionProfile) => void;
  onNewRdp: () => void;
  onNewSerial: () => void;
  onConnectGuest: () => void;
};

function activeConnection(tab: Tab): boolean {
  return (
    tab.kind === "rdp" ||
    (tab.kind === "terminal" &&
      (tab.collaboration?.mode === "guest" ||
        (tab.workspaceEnv != null && tab.workspaceEnv.kind !== "local")))
  );
}

function activeConnectionMeta(
  tab: Tab,
): Pick<ConnectionItem, "detail" | "type" | "icon"> {
  if (tab.kind === "rdp") {
    return {
      detail: `${tab.username ? `${tab.username}@` : ""}${tab.host}:${tab.port ?? 3389}`,
      type: "RDP",
      icon: ComputerIcon,
    };
  }
  if (tab.kind !== "terminal") {
    return { detail: "", type: "", icon: ComputerTerminal02Icon };
  }
  if (tab.collaboration?.mode === "guest") {
    return {
      detail: tab.cwd ?? "",
      type: "Companion",
      icon: ComputerTerminal02Icon,
    };
  }
  const env = tab.workspaceEnv;
  if (env?.kind === "ssh") {
    return {
      detail: `${env.connection.user ? `${env.connection.user}@` : ""}${env.connection.host}:${env.connection.port ?? 22}`,
      type: "SSH",
      icon: ServerStack01Icon,
    };
  }
  if (env?.kind === "wsl") {
    return { detail: env.distro, type: "WSL", icon: ComputerTerminal02Icon };
  }
  if (env?.kind === "docker") {
    return {
      detail: env.connection.image,
      type: "Docker",
      icon: ServerStack01Icon,
    };
  }
  if (env?.kind === "serial") {
    return {
      detail: `${env.portName} · ${env.baudRate} baud`,
      type: "Serial",
      icon: UsbIcon,
    };
  }
  return {
    detail: tab.cwd ?? "",
    type: "Terminal",
    icon: ComputerTerminal02Icon,
  };
}

export function ConnectionsLaunchpad({
  open,
  onOpenChange,
  tabs,
  activeTabId,
  onSelectTab,
  onConnectSsh,
  onNewSsh,
  onNewWsl,
  onConnectDocker,
  onConnectRdp,
  onNewRdp,
  onNewSerial,
  onConnectGuest,
}: ConnectionsLaunchpadProps) {
  const { t } = useTranslation();
  const sshConnections = useSshConnections();
  const rdpConnections = useRdpConnections();
  const distros = useWorkspaceEnvStore((state) => state.distros);
  const refreshDistros = useWorkspaceEnvStore((state) => state.refreshDistros);
  const dockerEnabled = usePreferencesStore((state) => state.dockerEnabled);
  const dockerCustomHost = usePreferencesStore(
    (state) => state.dockerCustomHost,
  );
  const containers = useDockerStore((state) => state.containers);
  const refreshContainers = useDockerStore((state) => state.refreshContainers);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    if (IS_WINDOWS && distros.length === 0) void refreshDistros();
    if (dockerEnabled) void refreshContainers(dockerCustomHost);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [
    dockerCustomHost,
    dockerEnabled,
    distros.length,
    open,
    refreshContainers,
    refreshDistros,
  ]);

  const items = useMemo<ConnectionItem[]>(() => {
    const activeItems = tabs.filter(activeConnection).map((tab) => {
      const meta = activeConnectionMeta(tab);
      return {
        id: `active-${tab.id}`,
        section: "active" as const,
        label: labelFor(tab),
        ...meta,
        run: () => onSelectTab(tab),
      };
    });
    const sshItems = sshConnections.map((connection) => ({
      id: `ssh-${connection.id}`,
      section: "available" as const,
      label: connection.name,
      detail: formatSshSubtitle(connection),
      type: "SSH",
      icon: ServerStack01Icon,
      run: () => onConnectSsh(connection),
    }));
    const wslItems = distros.map((distro) => ({
      id: `wsl-${distro.name}`,
      section: "available" as const,
      label: distro.name,
      detail: distro.running
        ? t("connectionsLaunchpad.running")
        : t("connectionsLaunchpad.available"),
      type: "WSL",
      icon: ComputerTerminal02Icon,
      run: () => onNewWsl(distro.name),
    }));
    const dockerItems = dockerEnabled
      ? containers
          .filter((container) => container.state === "running")
          .map((container) => ({
            id: `docker-${container.id}`,
            section: "available" as const,
            label: container.names[0] || container.short_id,
            detail: container.image,
            type: "Docker",
            icon: ServerStack01Icon,
            run: () =>
              onConnectDocker({
                containerId: container.id,
                containerName: container.names[0] || container.short_id,
                image: container.image,
                shell: "/bin/sh",
              }),
          }))
      : [];
    const rdpItems = rdpConnections.map((connection) => ({
      id: `rdp-${connection.id}`,
      section: "available" as const,
      label: connection.name,
      detail: `${connection.username ? `${connection.username}@` : ""}${connection.host}:${connection.port}`,
      type: "RDP",
      icon: ComputerIcon,
      run: () => onConnectRdp(connection),
    }));
    return [
      ...activeItems,
      ...sshItems,
      ...wslItems,
      ...dockerItems,
      ...rdpItems,
    ];
  }, [
    containers,
    distros,
    dockerEnabled,
    onConnectDocker,
    onConnectRdp,
    onConnectSsh,
    onNewWsl,
    onSelectTab,
    rdpConnections,
    sshConnections,
    t,
    tabs,
  ]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.label} ${item.detail} ${item.type}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex((index) =>
      Math.min(index, Math.max(0, filteredItems.length - 1)),
    );
  }, [filteredItems.length]);

  useEffect(() => {
    const item = filteredItems[selectedIndex];
    if (item)
      itemRefs.current.get(item.id)?.scrollIntoView({ block: "nearest" });
  }, [filteredItems, selectedIndex]);

  const run = useCallback(
    (action: () => void) => {
      onOpenChange(false);
      action();
    },
    [onOpenChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      } else if (event.key === "ArrowDown" && filteredItems.length > 0) {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % filteredItems.length);
      } else if (event.key === "ArrowUp" && filteredItems.length > 0) {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + filteredItems.length) % filteredItems.length,
        );
      } else if (event.key === "Enter") {
        const item = filteredItems[selectedIndex];
        if (item) {
          event.preventDefault();
          run(item.run);
        }
      }
    },
    [filteredItems, onOpenChange, run, selectedIndex],
  );

  const quickActions = [
    {
      id: "ssh",
      label: t("connectionsLaunchpad.newSsh"),
      icon: ServerStack01Icon,
      run: onNewSsh,
    },
    {
      id: "rdp",
      label: t("connectionsLaunchpad.newRdp"),
      icon: ComputerIcon,
      run: onNewRdp,
    },
    {
      id: "serial",
      label: t("connectionsLaunchpad.newSerial"),
      icon: UsbIcon,
      run: onNewSerial,
    },
    {
      id: "guest",
      label: t("connectionsLaunchpad.joinCompanion"),
      icon: ComputerTerminal02Icon,
      run: onConnectGuest,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-20 left-1/2 z-50 flex max-h-[78vh] w-[92vw] max-w-2xl -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border border-white/10 bg-popover/95 p-0 shadow-2xl backdrop-blur-2xl"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">
          {t("connectionsLaunchpad.title")}
        </DialogTitle>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <HugeiconsIcon
            icon={Search01Icon}
            size={18}
            className="text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("connectionsLaunchpad.placeholder")}
            className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 border-b p-3 sm:grid-cols-4">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => run(action.run)}
              className="flex min-h-16 flex-col items-start justify-between rounded-xl border bg-background/40 p-3 text-left text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HugeiconsIcon icon={action.icon} size={18} />
              <span className="flex w-full items-center justify-between gap-1">
                <span>{action.label}</span>
                <HugeiconsIcon
                  icon={Add01Icon}
                  size={13}
                  className="text-muted-foreground"
                />
              </span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {t("connectionsLaunchpad.noResults")}
            </div>
          ) : (
            (["active", "available"] as const).map((section) => {
              const sectionItems = filteredItems.filter(
                (item) => item.section === section,
              );
              if (sectionItems.length === 0) return null;
              return (
                <section key={section} className="mb-3 last:mb-0">
                  <h3 className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`connectionsLaunchpad.${section}`)}
                  </h3>
                  {sectionItems.map((item) => {
                    const index = filteredItems.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        ref={(element) => {
                          if (element) itemRefs.current.set(item.id, element);
                          else itemRefs.current.delete(item.id);
                        }}
                        type="button"
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => run(item.run)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          index === selectedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                          <HugeiconsIcon icon={item.icon} size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {item.label}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        </span>
                        <span className="rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.type}
                        </span>
                        {item.id === `active-${activeTabId}` && (
                          <span
                            className="size-1.5 rounded-full bg-emerald-500"
                            title={t("connectionsLaunchpad.current")}
                          />
                        )}
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          size={14}
                          className="text-muted-foreground"
                        />
                      </button>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground">
          <span>{t("connectionsLaunchpad.hintNavigate")}</span>
          <span>{t("connectionsLaunchpad.hintOpen")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
