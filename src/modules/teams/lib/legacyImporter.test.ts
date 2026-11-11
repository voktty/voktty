import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: vi.fn(async (p: string) => {
    return fs.readFileSync(p, "utf-8");
  }),
  writeTextFile: vi.fn(async (p: string, content: string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");
  }),
}));

import {
  previewLegacyImport,
  applyLegacyImport,
  sanitizePathEntries,
  resolveSafeTeamPath,
} from "./legacyImporter";
import { validateRoster } from "./rosterValidation";
import { dispatchAgentMethod } from "./agentControlBridge";
import {
  clearLiveAgentRegistry,
  generateAgentToken,
  registerLiveAgent,
} from "./agentRegistry";

function hashDirFiles(dirPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(dirPath)) return result;

  function traverse(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        result[fullPath] = hash;
      }
    }
  }

  traverse(dirPath);
  return result;
}

describe("legacyImporter", () => {
  describe("sanitizePathEntries", () => {
    it("strips comments in parentheses, splits compound entries, and expands braces", () => {
      const input = [
        "PROMPTS/ (estructura)",
        "docker-compose.yml y .env.example (compartidos)",
        "PROMPTS/dominios/{NODO,DESCARGAS}.md",
        "tmp/anuncios/ (fuera de git)",
      ];

      const { cleanPaths, unmapped } = sanitizePathEntries(input);

      expect(cleanPaths).toContain("PROMPTS/");
      expect(cleanPaths).toContain("docker-compose.yml");
      expect(cleanPaths).toContain(".env.example");
      expect(cleanPaths).toContain("PROMPTS/dominios/NODO.md");
      expect(cleanPaths).toContain("PROMPTS/dominios/DESCARGAS.md");
      expect(cleanPaths).toContain("tmp/anuncios/");
      expect(unmapped).toHaveLength(0);
    });

    it("puts paths with .. or invalid characters into unmapped", () => {
      const input = ["../secret.txt", "valid/path.md"];
      const { cleanPaths, unmapped } = sanitizePathEntries(input);

      expect(cleanPaths).toEqual(["valid/path.md"]);
      expect(unmapped).toEqual(["../secret.txt"]);
    });
  });

  describe("preview and apply on mock project", () => {
    let tmpDir: string;

    beforeEach(() => {
      clearLiveAgentRegistry();
      tmpDir = path.join(
        os.tmpdir(),
        `voktty_legacy_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      fs.mkdirSync(path.join(tmpDir, "PROMPTS", "sesiones", "roles"), {
        recursive: true,
      });

      // Write mock legacy agentes.json
      const mockAgentesJson = {
        _nota: "Legacy test config",
        base: "C:\\proyectos\\base",
        agentes: [
          {
            nombre: "orquestador",
            dir: "docker_projects\\webserver",
            modelo: "claude-opus-5-5",
            esfuerzo: "medium",
            inicio: "siempre",
            rol: "roles/orquestador.md",
            iniciar: "docker_projects\\webserver\\PROMPTS\\iniciar.txt",
            dueño_de: ["PROMPTS/", "AGENTS.md"],
            lee_tambien: ["terax-ai"],
          },
          {
            nombre: "nodo",
            dir: "docker_projects\\webserver",
            modelo: "claude-sonnet-5-5",
            esfuerzo: "medium",
            inicio: "bajo demanda",
            rol: "roles/nodo.md",
            iniciar: "docker_projects\\webserver\\PROMPTS\\iniciar.txt",
            dueño_de: ["core/", "PROMPTS/dominios/NODO.md"],
            lee_tambien: [],
          },
          {
            nombre: "app",
            dir: "forgenex-app",
            modelo: "claude-sonnet-5-5",
            esfuerzo: "high",
            inicio: "bajo demanda",
            rol: "roles/app.md",
            iniciar: "forgenex-app\\PROMPTS\\iniciar.txt",
            dueño_de: ["forgenex-app/"],
            lee_tambien: [],
          },
        ],
      };

      fs.writeFileSync(
        path.join(tmpDir, "PROMPTS", "sesiones", "agentes.json"),
        JSON.stringify(mockAgentesJson, null, 2),
      );

      fs.writeFileSync(
        path.join(tmpDir, "PROMPTS", "sesiones", "roles", "orquestador.md"),
        "# Orquestador Role\nInstructions for orchestrator.",
      );
      fs.writeFileSync(
        path.join(tmpDir, "PROMPTS", "sesiones", "roles", "nodo.md"),
        "# Nodo Role\nInstructions for nodo.",
      );
      fs.writeFileSync(
        path.join(tmpDir, "PROMPTS", "sesiones", "roles", "app.md"),
        "# App Role\nInstructions for app.",
      );
    });

    it("previewLegacyImport produces a valid roster and warns about external dirs and unmapped fields", async () => {
      const preview = await previewLegacyImport(tmpDir);

      expect(preview.roster.agents).toHaveLength(3);

      const orch = preview.roster.agents.find((a) => a.name === "orquestador");
      expect(orch).toBeDefined();
      expect(orch?.start).toBe("always");
      expect(orch?.runtime?.model).toBe("claude-opus-5-5");
      expect(orch?.runtime?.effort).toBe("medium");
      expect(orch?.owns).toContain("AGENTS.md");

      const nodo = preview.roster.agents.find((a) => a.name === "nodo");
      expect(nodo).toBeDefined();
      expect(nodo?.start).toBe("on-demand");
      expect(nodo?.runtime?.model).toBe("claude-sonnet-5-5");

      // App points to external directory forgenex-app
      const app = preview.roster.agents.find((a) => a.name === "app");
      expect(app?.workdir).toBe("forgenex-app");
      const extWarn = preview.warnings.find(
        (w) => w.type === "external_path" && w.agent === "app",
      );
      expect(extWarn).toBeDefined();

      // Overlapping ownership in nodo: PROMPTS/dominios/NODO.md overlaps with orch's PROMPTS/
      const overlapWarn = preview.warnings.find(
        (w) => w.type === "overlapping_ownership" && w.agent === "nodo",
      );
      expect(overlapWarn).toBeDefined();
      // nodo's overlapping path was moved to reads
      expect(nodo?.reads).toContain("PROMPTS/dominios/NODO.md");

      // Validate that the generated roster is 100% valid according to Voktty schema validator
      const validation = validateRoster(JSON.stringify(preview.roster));
      expect(validation.error).toBeUndefined();
      expect(validation.roster).not.toBeNull();
    });

    it("applyLegacyImport writes .voktty/team without touching PROMPTS/sesiones", async () => {
      const beforeHashes = hashDirFiles(
        path.join(tmpDir, "PROMPTS", "sesiones"),
      );

      const preview = await previewLegacyImport(tmpDir);
      await applyLegacyImport(tmpDir, preview);

      const afterHashes = hashDirFiles(
        path.join(tmpDir, "PROMPTS", "sesiones"),
      );

      // Verify PROMPTS/sesiones was not modified in any way
      expect(afterHashes).toEqual(beforeHashes);

      // Verify .voktty/team/agents.json was created
      const agentsJsonPath = path.join(
        tmpDir,
        ".voktty",
        "team",
        "agents.json",
      );
      expect(fs.existsSync(agentsJsonPath)).toBe(true);
      const parsedRoster = JSON.parse(fs.readFileSync(agentsJsonPath, "utf-8"));
      expect(parsedRoster.agents).toHaveLength(3);

      // Verify roles were written under .voktty/team/roles/
      expect(
        fs.existsSync(
          path.join(tmpDir, ".voktty", "team", "roles", "orchestrator.md"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(tmpDir, ".voktty", "team", "roles", "nodo.md"),
        ),
      ).toBe(true);

      // Verify migration report was written
      expect(
        fs.existsSync(
          path.join(tmpDir, ".voktty", "team", "MIGRATION.md"),
        ),
      ).toBe(true);
    });
  });

  describe("security validations (B2, B3)", () => {
    const root = path.join(os.tmpdir(), "voktty_sec_root");

    it("resolveSafeTeamPath confines paths inside .voktty/team and rejects .. traversal", () => {
      expect(() =>
        resolveSafeTeamPath(root, "roles/../../PROMPTS/sesiones/roles/nodo.md"),
      ).toThrow("path traversal detected");
      expect(() => resolveSafeTeamPath(root, "../agents.json")).toThrow(
        "path traversal detected",
      );
    });

    it("resolveSafeTeamPath rejects absolute paths and drive letters (C:/, /)", () => {
      expect(() => resolveSafeTeamPath(root, "/etc/passwd")).toThrow(
        "is absolute",
      );
      expect(() => resolveSafeTeamPath(root, "C:/Windows/System32")).toThrow(
        "is absolute",
      );
      expect(() => resolveSafeTeamPath(root, "\\\\server\\share")).toThrow(
        "path traversal detected",
      );
    });

    it("resolveSafeTeamPath normalizes backslashes and rejects backslash traversal", () => {
      expect(() =>
        resolveSafeTeamPath(root, "roles\\..\\..\\malicious.md"),
      ).toThrow("path traversal detected");
      const safe = resolveSafeTeamPath(root, "roles\\nodo.md");
      expect(safe.replace(/\\/g, "/")).toContain(".voktty/team/roles/nodo.md");
    });

    it("previewLegacyImport rejects agent names containing separators, .., or invalid characters", async () => {
      const testDir = path.join(
        os.tmpdir(),
        `voktty_sec_names_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      fs.mkdirSync(path.join(testDir, "PROMPTS", "sesiones"), {
        recursive: true,
      });

      const badNames = [
        "../nodo",
        "sub/agent",
        "agent\\copy",
        "C:agent",
        "agent with spaces",
        "agent:name",
      ];

      for (const badName of badNames) {
        fs.writeFileSync(
          path.join(testDir, "PROMPTS", "sesiones", "agentes.json"),
          JSON.stringify({
            agentes: [{ nombre: badName, rol: "roles/nodo.md" }],
          }),
        );
        await expect(previewLegacyImport(testDir)).rejects.toThrow(
          "Invalid agent name",
        );
      }

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("applyLegacyImport refuses to apply if roster validation fails (B3)", async () => {
      const testDir = path.join(
        os.tmpdir(),
        `voktty_sec_val_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      fs.mkdirSync(path.join(testDir, "PROMPTS", "sesiones"), {
        recursive: true,
      });

      const mockPreview = {
        sourceFile: "mock",
        roster: {
          $schema: "./team.schema.json",
          version: 1,
          defaults: {
            runtime: { adapter: "claude-code" },
          },
          agents: [
            {
              name: "agent-1",
              role: "", // Invalid empty role
              start: "on-demand" as const,
            },
          ],
        },
        roles: {},
        warnings: [],
        unmapped: [],
      };

      await expect(
        applyLegacyImport(testDir, mockPreview as any),
      ).rejects.toThrow("Cannot apply legacy import: roster validation failed");

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("applyLegacyImport creates a backup copy when agents.json already exists (B3)", async () => {
      const testDir = path.join(
        os.tmpdir(),
        `voktty_sec_bak_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      const teamDir = path.join(testDir, ".voktty", "team");
      fs.mkdirSync(teamDir, { recursive: true });

      const originalAgentsContent = JSON.stringify(
        { original: "roster" },
        null,
        2,
      );
      fs.writeFileSync(
        path.join(teamDir, "agents.json"),
        originalAgentsContent,
      );

      const mockPreview = {
        sourceFile: "mock",
        roster: {
          $schema: "./team.schema.json",
          version: 1,
          defaults: {
            runtime: { adapter: "claude-code" },
          },
          agents: [
            {
              name: "valid_agent",
              role: "roles/valid_agent.md",
              start: "on-demand" as const,
            },
          ],
        },
        roles: { "roles/valid_agent.md": "# Valid Agent" },
        warnings: [],
        unmapped: [],
      };

      await applyLegacyImport(testDir, mockPreview as any);

      // Verify agents.json was updated
      const newContent = fs.readFileSync(
        path.join(teamDir, "agents.json"),
        "utf-8",
      );
      expect(newContent).toContain("valid_agent");

      // Verify backup file exists
      const files = fs.readdirSync(teamDir);
      const backupFile = files.find((f) => f.startsWith("agents.json.bak-"));
      expect(backupFile).toBeDefined();
      const backupContent = fs.readFileSync(
        path.join(teamDir, backupFile!),
        "utf-8",
      );
      expect(backupContent).toBe(originalAgentsContent);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("applyLegacyImport aborts without writing if reading existing agents.json fails with a non-ENOENT error (R3)", async () => {
      const testDir = path.join(
        os.tmpdir(),
        `voktty_sec_read_err_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      const teamDir = path.join(testDir, ".voktty", "team");
      fs.mkdirSync(teamDir, { recursive: true });

      const originalContent = JSON.stringify({ original: "untouched" }, null, 2);
      const agentsPath = path.join(teamDir, "agents.json");
      fs.writeFileSync(agentsPath, originalContent);

      const mockPreview = {
        sourceFile: "mock",
        roster: {
          $schema: "./team.schema.json",
          version: 1,
          defaults: { runtime: { adapter: "claude-code" } },
          agents: [
            {
              name: "valid_agent",
              role: "roles/valid_agent.md",
              start: "on-demand" as const,
            },
          ],
        },
        roles: { "roles/valid_agent.md": "# Valid Agent" },
        warnings: [],
        unmapped: [],
      };

      const { readTextFile } = await import("@/modules/harness/lib/fs");
      vi.mocked(readTextFile).mockImplementationOnce(async (p: string) => {
        if (p.endsWith("agents.json")) {
          const err = new Error("EACCES: permission denied, open '" + p + "'");
          (err as any).code = "EACCES";
          throw err;
        }
        return fs.readFileSync(p, "utf-8");
      });

      await expect(applyLegacyImport(testDir, mockPreview as any)).rejects.toThrow(
        "Failed to read existing team roster",
      );

      // Verify agents.json was NOT modified
      expect(fs.readFileSync(agentsPath, "utf-8")).toBe(originalContent);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("applyLegacyImport aborts without writing agents.json if creating backup copy fails (R3)", async () => {
      const testDir = path.join(
        os.tmpdir(),
        `voktty_sec_bak_err_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      const teamDir = path.join(testDir, ".voktty", "team");
      fs.mkdirSync(teamDir, { recursive: true });

      const originalContent = JSON.stringify({ original: "preserve-me" }, null, 2);
      const agentsPath = path.join(teamDir, "agents.json");
      fs.writeFileSync(agentsPath, originalContent);

      const mockPreview = {
        sourceFile: "mock",
        roster: {
          $schema: "./team.schema.json",
          version: 1,
          defaults: { runtime: { adapter: "claude-code" } },
          agents: [
            {
              name: "valid_agent",
              role: "roles/valid_agent.md",
              start: "on-demand" as const,
            },
          ],
        },
        roles: { "roles/valid_agent.md": "# Valid Agent" },
        warnings: [],
        unmapped: [],
      };

      const { writeTextFile } = await import("@/modules/harness/lib/fs");
      vi.mocked(writeTextFile).mockImplementationOnce(async (p: string) => {
        if (p.includes("agents.json.bak-")) {
          throw new Error("ENOSPC: no space left on device");
        }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, "utf-8");
      });

      await expect(applyLegacyImport(testDir, mockPreview as any)).rejects.toThrow(
        "Failed to create backup copy of agents.json",
      );

      // Verify agents.json was NOT overwritten
      expect(fs.readFileSync(agentsPath, "utf-8")).toBe(originalContent);

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe("acceptance criterion: importing legacy webserver fixture (B5)", () => {
    const fixtureSessions = path.resolve(
      __dirname,
      "__fixtures__/legacy_webserver/PROMPTS/sesiones",
    );

    it("imports legacy fixture producing a valid roster without touching PROMPTS/sesiones", async () => {
      expect(fs.existsSync(fixtureSessions)).toBe(true);

      // Compute hashes of the fixture's PROMPTS/sesiones before anything
      const fixtureHashesBefore = hashDirFiles(fixtureSessions);
      expect(Object.keys(fixtureHashesBefore).length).toBeGreaterThan(0);

      // Create a temporary project directory for testing import using os.tmpdir() (B5)
      const testProjectDir = path.join(
        os.tmpdir(),
        `voktty_fixture_acceptance_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      const testSessionsDir = path.join(
        testProjectDir,
        "PROMPTS",
        "sesiones",
      );
      fs.mkdirSync(testSessionsDir, { recursive: true });

      // Copy ONLY PROMPTS/sesiones to the test directory
      fs.cpSync(fixtureSessions, testSessionsDir, { recursive: true });

      const testHashesBefore = hashDirFiles(testSessionsDir);

      // Perform preview and import
      const preview = await previewLegacyImport(testProjectDir);
      expect(preview.roster.agents.length).toBe(10);

      const val = validateRoster(JSON.stringify(preview.roster));
      expect(val.error).toBeUndefined();
      expect(val.roster).not.toBeNull();

      await applyLegacyImport(testProjectDir, preview);

      // Verify that neither the test sessions dir nor the fixture dir were touched
      const testHashesAfter = hashDirFiles(testSessionsDir);
      expect(testHashesAfter).toEqual(testHashesBefore);

      const fixtureHashesAfter = hashDirFiles(fixtureSessions);
      expect(fixtureHashesAfter).toEqual(fixtureHashesBefore);

      // Verify that orquestador, nodo and other roles are properly imported
      const importedRosterPath = path.join(
        testProjectDir,
        ".voktty",
        "team",
        "agents.json",
      );
      expect(fs.existsSync(importedRosterPath)).toBe(true);
      const importedRoster = JSON.parse(
        fs.readFileSync(importedRosterPath, "utf-8"),
      );

      const orch = importedRoster.agents.find(
        (a: any) => a.name === "orquestador",
      );
      const nodo = importedRoster.agents.find((a: any) => a.name === "nodo");

      expect(orch).toBeDefined();
      // I4: orchestrator role is strictly roles/orchestrator.md
      expect(orch.role).toBe("roles/orchestrator.md");
      expect(nodo).toBeDefined();
      expect(nodo.role).toBe("roles/nodo.md");

      // Verify orchestrator role file was created
      expect(
        fs.existsSync(
          path.join(testProjectDir, ".voktty", "team", "roles", "orchestrator.md"),
        ),
      ).toBe(true);

      fs.rmSync(testProjectDir, { recursive: true, force: true });
    });

    it("acceptance: orchestrator opens nodo and copy nodo-2 in its worktree, sends tasks and collects verdicts without arrancar.py", async () => {
      // Create isolated test project with imported team using os.tmpdir() (B5)
      const testProjectDir = path.join(
        os.tmpdir(),
        `voktty_flow_acceptance_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      );
      const testSessionsDir = path.join(
        testProjectDir,
        "PROMPTS",
        "sesiones",
      );
      fs.mkdirSync(testSessionsDir, { recursive: true });
      fs.cpSync(fixtureSessions, testSessionsDir, { recursive: true });

      const preview = await previewLegacyImport(testProjectDir);
      await applyLegacyImport(testProjectDir, preview);

      clearLiveAgentRegistry();

      // 1. Authenticate caller orchestrator (role is roles/orchestrator.md per I4)
      const orchLive = {
        sessionId: "s_orch_real",
        agentName: "orquestador",
        projectPath: testProjectDir,
        role: "roles/orchestrator.md",
        isOrchestrator: true,
        permissions: { canManageAgents: true },
        launchedAt: new Date().toISOString(),
        agentToken: generateAgentToken(),
      };
      await registerLiveAgent(orchLive);

      const mockTabOpener = vi
        .fn()
        .mockImplementation((_spaceId, _cwd, _sId) => 101);
      const dispatchContext = {
        onNewHarnessTab: mockTabOpener,
      };

      // 2. Orchestrator opens 'nodo'
      const startNodoRes: any = await dispatchAgentMethod(
        "agent.start",
        {
          agent: "nodo",
          mode: "new",
          task: "Run initial checks on webserver",
        },
        { agent_token: orchLive.agentToken },
        dispatchContext,
      );

      expect(startNodoRes.ok).toBe(true);
      expect(startNodoRes.agent).toBe("nodo");
      expect(startNodoRes.tabId).toBe(101);

      // 3. Orchestrator opens copy 'nodo-2' in its own worktree
      const startNodoCopyRes: any = await dispatchAgentMethod(
        "agent.start",
        {
          agent: "nodo-2",
          mode: "new",
          task: "Run parallel tests in worktree",
        },
        { agent_token: orchLive.agentToken },
        dispatchContext,
      );

      expect(startNodoCopyRes.ok).toBe(true);
      expect(startNodoCopyRes.agent).toBe("nodo-2");

      // Verify nodo-2 was opened in its own worktree outside repo
      const lastTabCall = mockTabOpener.mock.calls[mockTabOpener.mock.calls.length - 1];
      const copyCwd = lastTabCall[1];
      expect(copyCwd).toContain("nodo-2");
      expect(copyCwd).not.toContain(path.join(testProjectDir, ".voktty"));

      // 4. Send task from orchestrator to nodo
      const sendToNodoRes: any = await dispatchAgentMethod(
        "agent.send",
        {
          to: "nodo",
          kind: "task",
          text: "Analyze endpoint health",
        },
        { agent_token: orchLive.agentToken },
      );
      expect(sendToNodoRes.ok).toBe(true);

      // 5. Send task from orchestrator to copy nodo-2
      const sendToNodoCopyRes: any = await dispatchAgentMethod(
        "agent.send",
        {
          to: "nodo-2",
          kind: "task",
          text: "Verify worktree isolation",
        },
        { agent_token: orchLive.agentToken },
      );
      expect(sendToNodoCopyRes.ok).toBe(true);

      // 6. Nodo responds with verdict
      const nodoLive = {
        sessionId: startNodoRes.sessionId,
        agentName: "nodo",
        projectPath: testProjectDir,
        role: "roles/nodo.md",
        isOrchestrator: false,
        permissions: { canManageAgents: false },
        launchedAt: new Date().toISOString(),
        agentToken: generateAgentToken(),
      };
      await registerLiveAgent(nodoLive);

      const nodoVerdictRes: any = await dispatchAgentMethod(
        "agent.send",
        {
          to: "orquestador",
          kind: "verdict",
          text: "Endpoints healthy and operational.",
          reply_to: sendToNodoRes.messageId,
        },
        { agent_token: nodoLive.agentToken },
      );
      expect(nodoVerdictRes.ok).toBe(true);

      // 7. Nodo-2 responds with verdict
      const nodo2Live = {
        sessionId: startNodoCopyRes.sessionId,
        agentName: "nodo-2",
        projectPath: testProjectDir,
        role: "roles/nodo.md",
        isOrchestrator: false,
        permissions: { canManageAgents: false },
        launchedAt: new Date().toISOString(),
        agentToken: generateAgentToken(),
      };
      await registerLiveAgent(nodo2Live);

      const nodo2VerdictRes: any = await dispatchAgentMethod(
        "agent.send",
        {
          to: "orquestador",
          kind: "verdict",
          text: "Worktree isolation confirmed.",
          reply_to: sendToNodoCopyRes.messageId,
        },
        { agent_token: nodo2Live.agentToken },
      );
      expect(nodo2VerdictRes.ok).toBe(true);

      // 8. Orchestrator collects verdicts
      const waitNodoRes: any = await dispatchAgentMethod(
        "agent.wait",
        { agent: "nodo", until: "verdict" },
        { agent_token: orchLive.agentToken },
      );
      expect(waitNodoRes.ok).toBe(true);
      expect(waitNodoRes.matched).toBe(true);
      expect(waitNodoRes.verdict).toBe("Endpoints healthy and operational.");

      const waitNodo2Res: any = await dispatchAgentMethod(
        "agent.wait",
        { agent: "nodo-2", until: "verdict" },
        { agent_token: orchLive.agentToken },
      );
      expect(waitNodo2Res.ok).toBe(true);
      expect(waitNodo2Res.matched).toBe(true);
      expect(waitNodo2Res.verdict).toBe("Worktree isolation confirmed.");

      // Clean up test temp dir
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    });
  });
});
