import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const tauriConfig = JSON.parse(
  readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
) as {
  bundle: { fileAssociations: Array<{ name?: string }> };
};
const windowsConfig = JSON.parse(
  readFileSync(path.join(root, "src-tauri/tauri.windows.conf.json"), "utf8"),
) as { bundle: { resources: string[] } };
const installerHooks = readFileSync(
  path.join(root, "src-tauri/installer-hooks.nsh"),
  "utf8",
);
const documentIcon = readFileSync(
  path.join(root, "src-tauri/icons/document.ico"),
);

describe("Windows document associations", () => {
  it("bundles and registers the dedicated document icon", () => {
    expect(windowsConfig.bundle.resources).toContain("icons/document.ico");
    for (const association of tauriConfig.bundle.fileAssociations) {
      expect(association.name).toBeTruthy();
      expect(installerHooks).toContain(
        `Software\\Classes\\${association.name}\\DefaultIcon`,
      );
    }
    expect(installerHooks).toContain('"$INSTDIR\\icons\\document.ico",0');
    expect(installerHooks).toContain("!insertmacro UPDATEFILEASSOC");
  });

  it("contains crisp icon frames from 16 through 256 pixels", () => {
    expect(documentIcon.readUInt16LE(0)).toBe(0);
    expect(documentIcon.readUInt16LE(2)).toBe(1);
    const frameCount = documentIcon.readUInt16LE(4);
    const sizes = new Set<number>();
    for (let index = 0; index < frameCount; index += 1) {
      const width = documentIcon[6 + index * 16];
      sizes.add(width === 0 ? 256 : width);
    }
    expect(sizes).toEqual(new Set([16, 20, 24, 32, 40, 48, 64, 96, 128, 256]));
  });
});
