import type { ThemeSkin } from "../types";
import { win31Skin } from "./win31/win31Skin";

const builtinSkins: ThemeSkin[] = [win31Skin];
const skinRegistry = new Map<string, ThemeSkin>(
  builtinSkins.map((s) => [s.id, s]),
);

export function registerSkin(skin: ThemeSkin): void {
  skinRegistry.set(skin.id, skin);
}

export function unregisterSkin(id: string): boolean {
  return skinRegistry.delete(id);
}

export function getSkin(id: string): ThemeSkin | undefined {
  return skinRegistry.get(id);
}

export function listSkins(): ThemeSkin[] {
  return Array.from(skinRegistry.values());
}

export function clearSkinRegistry(): void {
  skinRegistry.clear();
  for (const s of builtinSkins) {
    skinRegistry.set(s.id, s);
  }
}
