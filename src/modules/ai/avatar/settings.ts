import type {
  AgentAvatarAnimationIntensity,
  AgentAvatarSize,
} from "@/modules/settings/store";

const SIZE_SCALE: Record<AgentAvatarSize, number> = {
  compact: 0.86,
  standard: 1,
  large: 1.16,
};

const INTENSITY_SCALE: Record<AgentAvatarAnimationIntensity, number> = {
  low: 0.72,
  standard: 1,
  high: 1.28,
};

export function avatarSizeScale(value: AgentAvatarSize): number {
  return SIZE_SCALE[value] ?? SIZE_SCALE.standard;
}

export function avatarAnimationScale(
  value: AgentAvatarAnimationIntensity,
): number {
  return INTENSITY_SCALE[value] ?? INTENSITY_SCALE.standard;
}

export function avatarAnimationSpeed(
  intensity: number,
  preference: AgentAvatarAnimationIntensity,
): number {
  const normalizedPresence = Math.min(1, Math.max(0, intensity));
  return Math.max(
    0.45,
    avatarAnimationScale(preference) * (0.7 + normalizedPresence * 0.5),
  );
}
