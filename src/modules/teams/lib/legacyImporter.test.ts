import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
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
        "/tmp",
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
          path.join(tmpDir, ".voktty", "team", "roles", "orquestador.md"),
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

  describe("acceptance criterion: importing docker_projects/webserver", () => {
    const realWebserverSessions = path.resolve(
      __dirname,
      "../../../../../docker_projects/webserver/PROMPTS/sesiones",
    );

    it("imports docker_projects/webserver producing a valid roster without touching PROMPTS/sesiones", async () => {
      expect(fs.existsSync(realWebserverSessions)).toBe(true);

      // Compute hashes of the real repository's PROMPTS/sesiones before anything
      const realHashesBefore = hashDirFiles(realWebserverSessions);
      expect(Object.keys(realHashesBefore).length).toBeGreaterThan(0);

      // Create a temporary project directory for testing import to protect source tree
      const testProjectDir = path.join(
        "/tmp",
        `voktty_webserver_acceptance_${Date.now()}`,
      );
      const testSessionsDir = path.join(
        testProjectDir,
        "PROMPTS",
        "sesiones",
      );
      fs.mkdirSync(testSessionsDir, { recursive: true });

      // Copy ONLY PROMPTS/sesiones to the test directory
      fs.cpSync(realWebserverSessions, testSessionsDir, { recursive: true });

      const testHashesBefore = hashDirFiles(testSessionsDir);

      // Perform preview and import
      const preview = await previewLegacyImport(testProjectDir);
      expect(preview.roster.agents.length).toBeGreaterThanOrEqual(10);

      const val = validateRoster(JSON.stringify(preview.roster));
      expect(val.error).toBeUndefined();
      expect(val.roster).not.toBeNull();

      await applyLegacyImport(testProjectDir, preview);

      // Verify that neither the test sessions dir nor the real sessions dir were touched
      const testHashesAfter = hashDirFiles(testSessionsDir);
      expect(testHashesAfter).toEqual(testHashesBefore);

      const realHashesAfter = hashDirFiles(realWebserverSessions);
      expect(realHashesAfter).toEqual(realHashesBefore);

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
      expect(orch.role).toBe("roles/orquestador.md");
      expect(nodo).toBeDefined();
      expect(nodo.role).toBe("roles/nodo.md");
    });

    it("acceptance: orchestrator opens nodo and copy nodo-2 in its worktree, sends tasks and collects verdicts without arrancar.py", async () => {
      // Create isolated test project with imported team
      const testProjectDir = path.join(
        "/tmp",
        `voktty_flow_acceptance_${Date.now()}`,
      );
      const testSessionsDir = path.join(
        testProjectDir,
        "PROMPTS",
        "sesiones",
      );
      fs.mkdirSync(testSessionsDir, { recursive: true });
      fs.cpSync(realWebserverSessions, testSessionsDir, { recursive: true });

      const preview = await previewLegacyImport(testProjectDir);
      await applyLegacyImport(testProjectDir, preview);

      clearLiveAgentRegistry();

      // 1. Authenticate caller orchestrator
      const orchLive = {
        sessionId: "s_orch_real",
        agentName: "orquestador",
        projectPath: testProjectDir,
        role: "roles/orquestador.md",
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
