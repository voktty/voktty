import type { ThemeSkin } from "../types";
import { win31Skin } from "./win31/win31Skin";
import { mac1Skin } from "./mac1/mac1Skin";
import { kdeSkin } from "./kde/kdeSkin";
import { commanderBlueSkin } from "./commander-blue/commanderBlueSkin";
import { phosphorCrtSkin } from "./phosphor-crt/phosphorCrtSkin";
import { whistlerBlissSkin } from "./whistler-bliss/whistlerBlissSkin";
import { boingWorkbenchSkin } from "./boing-workbench/boingWorkbenchSkin";
import { cubeStepSkin } from "./cubestep/cubeStepSkin";
import { yellowTabOsSkin } from "./yellowtab-os/yellowTabOsSkin";
import { solarCdeSkin } from "./solar-cde/solarCdeSkin";
import { humanity2006Skin } from "./humanity-2006/humanity2006Skin";
import { pocket89Skin } from "./pocket-89/pocket89Skin";
import { pilotPdaSkin } from "./pilot-pda/pilotPdaSkin";
import { clickWheelPodSkin } from "./clickwheel-pod/clickWheelPodSkin";
import { station94Skin } from "./station-94/station94Skin";
import { audioAmpClassicSkin } from "./audioamp-classic/audioAmpClassicSkin";
import { cyberCafe99Skin } from "./cybercafe-99/cyberCafe99Skin";
import { tigerAquaSkin } from "./tiger-aqua/tigerAquaSkin";
import { mediaStation9Skin } from "./media-station-9/mediaStation9Skin";
import { instantChat7Skin } from "./instant-chat-7/instantChat7Skin";
import { bbsDialupSkin } from "./bbs-dialup/bbsDialupSkin";

const builtinSkins: ThemeSkin[] = [
  win31Skin,
  mac1Skin,
  kdeSkin,
  commanderBlueSkin,
  phosphorCrtSkin,
  whistlerBlissSkin,
  boingWorkbenchSkin,
  cubeStepSkin,
  yellowTabOsSkin,
  solarCdeSkin,
  humanity2006Skin,
  pocket89Skin,
  pilotPdaSkin,
  clickWheelPodSkin,
  station94Skin,
  audioAmpClassicSkin,
  cyberCafe99Skin,
  tigerAquaSkin,
  mediaStation9Skin,
  instantChat7Skin,
  bbsDialupSkin,
];
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
