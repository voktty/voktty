import { expect, it } from "vitest";
import { fileDestinationLabel } from "@/modules/workspace/fileDestinationLabel";

it("identifies the SSH destination without displaying authentication configuration", () => {
  const label = fileDestinationLabel(
    "/fixture/file.ts",
    {
      kind: "ssh",
      root: "/fixture",
      sessionId: 7,
      connection: {
        id: "fixture",
        name: "Fixture",
        host: "::1",
        user: "fixture",
        port: 2022,
        identityFile: "/private/fixture-identity",
        extraArgs: "private-configuration",
      },
    },
    "Local",
    "Serial",
  );
  expect(label).toBe("SSH · Fixture · fixture@[::1]:2022");
  expect(label).not.toContain("private");
});

it("distinguishes WSL from native Windows destinations with the same caller", () => {
  const workspace = { kind: "wsl" as const, distro: "fixture" };
  expect(
    fileDestinationLabel("/fixture/file.ts", workspace, "Local", "Serial"),
  ).toBe("WSL · fixture");
  expect(
    fileDestinationLabel("C:\\fixture\\file.ts", workspace, "Local", "Serial"),
  ).toBe("Local");
});
