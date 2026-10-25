import { expect, it, vi } from "vitest";
import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));
it("admits WSL document formatting through the command registry on Windows", () => {
  const surface = resolveActiveSurface({
    kind: "editor",
    ownerId: 1,
    folder: "/work",
    workspaceEnv: { kind: "wsl", distro: "Owned" },
  });
  expect(
    commandSurfaceUnavailableReason("editor.formatDocument", surface),
  ).toBeNull();
});
it("keeps an SSH host path unavailable on Windows", () => {
  const surface = resolveActiveSurface({
    kind: "editor",
    ownerId: 1,
    folder: "/work",
    workspaceEnv: {
      kind: "ssh",
      root: "/work",
      connection: { id: "fixture", name: "Fixture", host: "host-a" },
    },
  });
  expect(
    commandSurfaceUnavailableReason("editor.formatDocument", surface),
  ).toBe("format-filesystem-unsupported");
});
