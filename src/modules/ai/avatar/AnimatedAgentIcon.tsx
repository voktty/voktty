import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { CSSProperties } from "react";
import {
  type AvatarPresence,
  type AvatarPresenceState,
  makePresence,
} from "./presence";
import { avatarAnimationSpeed } from "./settings";
import "./avatar.css";

type AnimatedAgentIconProps = {
  agent: string;
  presence?: AvatarPresence | AvatarPresenceState;
  size?: number;
  className?: string;
  label?: string;
  decorative?: boolean;
  enabled?: boolean;
  reducedMotion?: boolean;
};

type AnimatedAgentIconStyle = CSSProperties & {
  "--voktty-agent-tab-speed": string;
  "--voktty-agent-tab-face-color": string;
};

function asPresence(value: AnimatedAgentIconProps["presence"]): AvatarPresence {
  return typeof value === "string"
    ? makePresence(value)
    : (value ?? makePresence("idle"));
}

function facePath(state: AvatarPresenceState): string {
  switch (state) {
    case "success":
      return "M4 7c2 3 6 3 8 0";
    case "error":
    case "cancelled":
      return "M4 9c2-2 6-2 8 0";
    case "thinking":
    case "planning":
      return "M5 8h6";
    case "awaiting-approval":
      return "M5 9h6";
    default:
      return "M5 8c2 1 4 1 6 0";
  }
}

function faceColor(state: AvatarPresenceState): string {
  switch (state) {
    case "awaiting-approval":
    case "warning":
      return "var(--warning, #f59e0b)";
    case "success":
      return "var(--success, #34d399)";
    case "error":
    case "cancelled":
      return "var(--destructive)";
    case "tool-running":
    case "streaming":
      return "var(--primary)";
    default:
      return "var(--muted-foreground)";
  }
}

export function AnimatedAgentIcon({
  agent,
  presence,
  size = 14,
  className,
  label,
  decorative = true,
  enabled,
  reducedMotion,
}: AnimatedAgentIconProps) {
  const storedEnabled = usePreferencesStore(
    (state) => state.agentAvatarEnabled,
  );
  const intensity = usePreferencesStore(
    (state) => state.agentAvatarAnimationIntensity,
  );
  const storedReducedMotion = usePreferencesStore(
    (state) => state.agentAvatarReducedMotion,
  );
  const resolvedEnabled = enabled ?? storedEnabled;
  const resolvedReducedMotion = reducedMotion ?? storedReducedMotion;
  const resolvedPresence = asPresence(presence);
  const ariaLabel = label ?? agent;

  const icon = (
    <AgentIcon
      agent={agent}
      size={size}
      className={cn("shrink-0", resolvedEnabled && "voktty-agent-tab-icon")}
    />
  );

  if (!resolvedEnabled) {
    return (
      <span
        className={cn("inline-flex shrink-0", className)}
        data-agent={agent}
      >
        {icon}
      </span>
    );
  }

  const faceSize = Math.max(8, Math.round(size * 0.62));
  const style: AnimatedAgentIconStyle = {
    width: size,
    height: size,
    "--voktty-agent-tab-speed": String(
      avatarAnimationSpeed(resolvedPresence.intensity, intensity),
    ),
    "--voktty-agent-tab-face-color": faceColor(resolvedPresence.state),
  };

  return (
    <span
      className={cn(
        "voktty-agent-tab relative inline-flex shrink-0",
        className,
      )}
      data-agent={agent}
      data-state={resolvedPresence.state}
      data-motion={resolvedReducedMotion ? "reduced" : "full"}
      role="img"
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : ariaLabel}
      style={style}
    >
      {icon}
      <span
        className="voktty-agent-tab-face pointer-events-none absolute"
        aria-hidden="true"
        style={{ width: faceSize, height: faceSize }}
      >
        <svg
          viewBox="0 0 16 12"
          width={faceSize}
          height={faceSize}
          aria-hidden="true"
        >
          <g className="voktty-agent-tab-eyes">
            <circle cx="4.5" cy="4.5" r="1.1" fill="currentColor" />
            <circle cx="11.5" cy="4.5" r="1.1" fill="currentColor" />
          </g>
          <path
            className="voktty-agent-tab-mouth"
            d={facePath(resolvedPresence.state)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </span>
  );
}
