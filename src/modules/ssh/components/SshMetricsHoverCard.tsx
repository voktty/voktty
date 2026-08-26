import { type ReactNode, useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { SshConnectionConfig, WorkspaceEnv } from "@/modules/workspace";
import { t } from "@/modules/i18n";
import { IS_WINDOWS } from "@/lib/platform";
import { useEnvironmentMetrics } from "../useSshMetrics";
import { SshServerMetricsCard } from "./SshServerMetricsCard";

type Props = {
  env?: WorkspaceEnv;
  connection?: SshConnectionConfig & { name: string };
  serverName?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  openDelay?: number;
  closeDelay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function SshMetricsHoverCard({
  env,
  connection,
  serverName,
  children,
  side = "bottom",
  align = "start",
  openDelay = 250,
  closeDelay = 150,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    controlledOnOpenChange?.(nextOpen);
  };

  const targetEnv = env ?? (connection ? { kind: "ssh" as const, connection } : null);
  const resolvedName =
    serverName ??
    (connection?.name ||
      (env?.kind === "ssh"
        ? env.connection.name
        : env?.kind === "wsl"
        ? `WSL: ${env.distro}`
        : IS_WINDOWS
        ? t("workspace.windowsLocal")
        : t("workspace.localMachine")));

  const { metrics, loading, error, refresh } = useEnvironmentMetrics(
    isOpen ? targetEnv : null,
    { enabled: isOpen, autoRefresh: true, intervalMs: 5000 },
  );

  return (
    <HoverCard
      open={isOpen}
      openDelay={openDelay}
      closeDelay={closeDelay}
      onOpenChange={handleOpenChange}
    >
      <HoverCardTrigger asChild>
        <div
          className="inline-flex h-full items-center"
          onFocusCapture={(e) => e.stopPropagation()}
          onPointerDownCapture={() => {
            handleOpenChange(false);
          }}
        >
          {children}
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={6}
        className="w-auto p-0 border-0 bg-transparent shadow-none"
      >
        <SshServerMetricsCard
          serverName={resolvedName}
          metrics={metrics}
          loading={loading}
          error={error}
          onRefresh={() => void refresh()}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

export const EnvMetricsHoverCard = SshMetricsHoverCard;

