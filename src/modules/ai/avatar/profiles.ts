import type { AvatarProfileId } from "./presence";

export type AvatarBodyKind =
  | "rounded"
  | "diamond"
  | "hex"
  | "shield"
  | "orb"
  | "spark";
export type AvatarEyeKind =
  | "round"
  | "slit"
  | "square"
  | "diamond"
  | "arc"
  | "star";

export type AvatarProfile = {
  id: AvatarProfileId;
  body: AvatarBodyKind;
  eyes: AvatarEyeKind;
  primary: string;
  secondary: string;
  glow: string;
};

export const AVATAR_PROFILES: Record<AvatarProfileId, AvatarProfile> = {
  coder: {
    id: "coder",
    body: "rounded",
    eyes: "square",
    primary: "#73a7ff",
    secondary: "#bdd5ff",
    glow: "#4f7cff",
  },
  architect: {
    id: "architect",
    body: "diamond",
    eyes: "diamond",
    primary: "#b49cff",
    secondary: "#e0d7ff",
    glow: "#896dff",
  },
  reviewer: {
    id: "reviewer",
    body: "hex",
    eyes: "slit",
    primary: "#f2a6d7",
    secondary: "#ffd6ee",
    glow: "#df70b7",
  },
  security: {
    id: "security",
    body: "shield",
    eyes: "arc",
    primary: "#ff9d9d",
    secondary: "#ffd0d0",
    glow: "#f36b72",
  },
  designer: {
    id: "designer",
    body: "orb",
    eyes: "round",
    primary: "#83dec6",
    secondary: "#d0fff2",
    glow: "#43cda9",
  },
  spark: {
    id: "spark",
    body: "spark",
    eyes: "star",
    primary: "#ffd27b",
    secondary: "#fff0bd",
    glow: "#f1a942",
  },
};

export function getAvatarProfile(id: AvatarProfileId): AvatarProfile {
  return AVATAR_PROFILES[id] ?? AVATAR_PROFILES.spark;
}
