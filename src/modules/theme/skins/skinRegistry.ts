import type { ThemeSkin } from "../types";

const skinRegistry = new Map<string, ThemeSkin>();

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
}
