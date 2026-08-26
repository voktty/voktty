import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Agent } from "../lib/agents";
import { getAvatarProfile, type AvatarProfile } from "./profiles";
import {
  makePresence,
  profileForAgentIcon,
  profileForAgentName,
  type AvatarPresence,
  type AvatarPresenceState,
  type AvatarProfileId,
} from "./presence";
import { avatarAnimationSpeed, avatarSizeScale } from "./settings";
import { useId, type CSSProperties, type ReactNode } from "react";
import "./avatar.css";

type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 14,
  sm: 18,
  md: 28,
  lg: 44,
};

export type AgentAvatarProps = {
  agent?: Pick<Agent, "id" | "name" | "icon"> | null;
  agentName?: string | null;
  profile?: AvatarProfileId;
  presence?: AvatarPresence | AvatarPresenceState;
  size?: AvatarSize;
  className?: string;
  label?: string;
  decorative?: boolean;
  fallback?: ReactNode;
  enabled?: boolean;
};

function asPresence(value: AgentAvatarProps["presence"]): AvatarPresence {
  return typeof value === "string"
    ? makePresence(value)
    : value ?? makePresence("idle");
}

function profileForProps(props: AgentAvatarProps): AvatarProfile {
  const profileId =
    props.profile ??
    (props.agent
      ? props.agent.id.startsWith("builtin:")
        ? profileForAgentIcon(props.agent.icon)
        : "spark"
      : profileForAgentName(props.agentName));
  return getAvatarProfile(profileId);
}

function Body({ profile, fill }: { profile: AvatarProfile; fill: string }) {
  switch (profile.body) {
    case "diamond":
      return <path d="M24 3 43 24 24 45 5 24 24 3Z" fill={fill} />;
    case "hex":
      return (
        <path d="m13 5 22 0 9 10-4 22-16 6-16-6-4-22 9-10Z" fill={fill} />
      );
    case "shield":
      return (
        <path
          d="M24 3 42 10v13c0 10-7 18-18 22C13 41 6 33 6 23V10L24 3Z"
          fill={fill}
        />
      );
    case "orb":
      return <circle cx="24" cy="24" r="19" fill={fill} />;
    case "spark":
      return (
        <path d="m24 2 4 15 15 7-15 7-4 15-4-15-15-7 15-7 4-15Z" fill={fill} />
      );
    default:
      return <rect x="5" y="5" width="38" height="38" rx="13" fill={fill} />;
  }
}

function Eyes({ profile }: { profile: AvatarProfile }) {
  const fill = profile.secondary;
  switch (profile.eyes) {
    case "slit":
      return (
        <>
          <rect x="13" y="21" width="7" height="3" rx="1.5" fill={fill} />
          <rect x="28" y="21" width="7" height="3" rx="1.5" fill={fill} />
        </>
      );
    case "square":
      return (
        <>
          <rect x="13" y="19" width="7" height="7" rx="2" fill={fill} />
          <rect x="28" y="19" width="7" height="7" rx="2" fill={fill} />
        </>
      );
    case "diamond":
      return (
        <>
          <path d="m16 18 4 5-4 5-4-5 4-5Z" fill={fill} />
          <path d="m32 18 4 5-4 5-4-5 4-5Z" fill={fill} />
        </>
      );
    case "arc":
      return (
        <>
          <path
            d="M12 24c1-5 5-7 9-5"
            fill="none"
            stroke={fill}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M36 24c-1-5-5-7-9-5"
            fill="none"
            stroke={fill}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      );
    case "star":
      return (
        <>
          <path d="m16 18 2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill={fill} />
          <path d="m32 18 2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill={fill} />
        </>
      );
    default:
      return (
        <>
          <circle cx="16" cy="23" r="3.5" fill={fill} />
          <circle cx="32" cy="23" r="3.5" fill={fill} />
        </>
      );
  }
}

export function AgentAvatar({
  agent,
  agentName,
  profile,
  presence,
  size = "sm",
  className,
  label,
  decorative = false,
  fallback,
  enabled,
}: AgentAvatarProps) {
  const storedEnabled = usePreferencesStore((state) => state.agentAvatarEnabled);
  const storedSize = usePreferencesStore((state) => state.agentAvatarSize);
  const storedIntensity = usePreferencesStore(
    (state) => state.agentAvatarAnimationIntensity,
  );
  const storedReducedMotion = usePreferencesStore(
    (state) => state.agentAvatarReducedMotion,
  );
  const generatedId = useId().replace(/:/g, "");
  if (!(enabled ?? storedEnabled)) return fallback ?? null;

  const resolvedProfile = profileForProps({ agent, agentName, profile });
  const resolvedPresence = asPresence(presence);
  const pixelSize = Math.max(
    12,
    Math.round(SIZE_PX[size] * avatarSizeScale(storedSize)),
  );
  const animationSpeed = avatarAnimationSpeed(
    resolvedPresence.intensity,
    storedIntensity,
  );
  const gradientId = `voktty-avatar-gradient-${generatedId}`;
  const ariaLabel = label ?? resolvedProfile.id;

  return (
    <span
      className={cn("voktty-avatar inline-flex shrink-0", className)}
      data-state={resolvedPresence.state}
      data-intensity={resolvedPresence.intensity.toFixed(2)}
      data-motion={storedReducedMotion ? "reduced" : "full"}
      role="img"
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : ariaLabel}
      style={
        {
          width: pixelSize,
          height: pixelSize,
          "--voktty-avatar-animation-speed": animationSpeed,
        } as CSSProperties
      }
    >
      <svg
        viewBox="0 0 48 48"
        width={pixelSize}
        height={pixelSize}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={resolvedProfile.secondary} />
            <stop offset="0.48" stopColor={resolvedProfile.primary} />
            <stop offset="1" stopColor={resolvedProfile.glow} />
          </linearGradient>
        </defs>
        <g
          className="voktty-avatar-body"
          style={{
            filter: `drop-shadow(0 0 2px ${resolvedProfile.glow}99)`,
          }}
        >
          <Body profile={resolvedProfile} fill={`url(#${gradientId})`} />
          <path
            d="M12 14c4-5 9-7 15-7"
            fill="none"
            stroke="#ffffff88"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <g className="voktty-avatar-face">
          <Eyes profile={resolvedProfile} />
          <path
            d="M18 32c4 2 8 2 12 0"
            fill="none"
            stroke={resolvedProfile.secondary}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>
        {resolvedPresence.state === "tool-running" ||
        resolvedPresence.state === "streaming" ? (
          <circle cx="39" cy="10" r="3" fill={resolvedProfile.secondary} opacity="0.9" />
        ) : null}
        {resolvedPresence.state === "awaiting-approval" ? (
          <path
            d="M24 11v7M24 31v1"
            stroke={resolvedProfile.secondary}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </span>
  );
}
