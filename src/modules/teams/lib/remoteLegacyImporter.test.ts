// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLegacyImport,
  previewLegacyImport,
} from "@/modules/teams/lib/legacyImporter";
import { remoteTeamFile } from "@/modules/teams/lib/remoteTeamTransport";

vi.mock("@/modules/teams/lib/remoteTeamTransport", () => ({
  remoteTeamFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => {
    throw new Error("Local IO is forbidden in this test");
  }),
}));
const root = "remote://voktty-ssh-mini/srv/webserver";
const files = new Map<string, string>();
const source = `${root}/PROMPTS/sesiones/agentes.json`;
const role = `${root}/PROMPTS/sesiones/roles/orquestador.md`;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  files.clear();
  files.set(
    source,
    JSON.stringify({
      agentes: [
        {
          nombre: "orquestador",
          rol: "roles/orquestador.md",
          modelo: "claude-opus",
          inicio: "siempre",
        },
      ],
    }),
  );
  files.set(role, "# Orchestrator\nCoordinate the team.");
  vi.mocked(remoteTeamFile).mockImplementation(
    async (operation, path, content) => {
      if (operation === "read") {
        if (!files.has(path)) throw { code: "not_found" };
        return { content: files.get(path) } as never;
      }
      if (operation === "write") files.set(path, content ?? "");
      return {} as never;
    },
  );
});

describe("remote legacy import (E8.2)", () => {
  it("previews through the helper without writes, applies only under .voktty/team and preserves legacy bytes", async () => {
    const original = new Map(files);
    const preview = await previewLegacyImport(root);
    expect(preview.roster.agents[0].role).toBe("roles/orchestrator.md");
    expect(preview.roles["roles/orchestrator.md"]).toContain(
      "Coordinate the team",
    );
    expect([...files]).toEqual([...original]);
    expect(
      vi
        .mocked(remoteTeamFile)
        .mock.calls.every(([operation]) => operation === "read"),
    ).toBe(true);
    await applyLegacyImport(root, preview);
    expect(
      JSON.parse(files.get(`${root}/.voktty/team/agents.json`) ?? "").agents[0]
        .name,
    ).toBe("orquestador");
    expect(files.get(`${root}/.voktty/team/roles/orchestrator.md`)).toBe(
      original.get(role),
    );
    for (const [path, bytes] of original) expect(files.get(path)).toBe(bytes);
    expect(
      vi
        .mocked(remoteTeamFile)
        .mock.calls.filter(
          ([operation]) => operation === "write" || operation === "mkdir",
        )
        .every(([, path]) => path.startsWith(`${root}/.voktty/team`)),
    ).toBe(true);
  });

  it("backs up an existing remote roster before replacing it and aborts on backup failure", async () => {
    const roster = `${root}/.voktty/team/agents.json`;
    files.set(roster, "original roster bytes");
    const preview = await previewLegacyImport(root);
    const writer = vi.mocked(remoteTeamFile).getMockImplementation();
    vi.mocked(remoteTeamFile).mockImplementation(async (...args) => {
      if (args[0] === "write" && args[1].includes("agents.json.bak-"))
        throw new Error("Disconnected during backup");
      return writer?.(...args) as never;
    });
    await expect(applyLegacyImport(root, preview)).rejects.toThrow(
      "Failed to create backup",
    );
    expect(files.get(roster)).toBe("original roster bytes");
    vi.mocked(remoteTeamFile).mockImplementation(writer as never);
    await applyLegacyImport(root, preview);
    expect(
      [...files].some(
        ([path, content]) =>
          path.includes("agents.json.bak-") &&
          content === "original roster bytes",
      ),
    ).toBe(true);
  });

  it("preflights all role destinations before the first write and never falls back to local IO", async () => {
    const preview = await previewLegacyImport(root);
    preview.roles["../outside.md"] = "forged";
    vi.mocked(remoteTeamFile).mockClear();
    await expect(applyLegacyImport(root, preview)).rejects.toThrow(
      "inside .voktty/team/roles",
    );
    expect(remoteTeamFile).not.toHaveBeenCalled();
  });
});
