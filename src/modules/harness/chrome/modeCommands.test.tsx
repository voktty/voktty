import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
  ModeCommandText,
} from "./modeCommands";
import { PLAN_COMMAND, consumePlanCommand } from "../lib/plan";
import {
  ORCHESTRATOR_COMMAND,
  consumeOrchestratorCommand,
} from "../lib/orchestratorCommand";
import { DRAFT_COMMAND, consumeDraftCommand } from "../lib/draftCommand";

describe("modeCommands", () => {
  const allNames = new Set(["plan", "orchestrator", "draft", "btw", "operator"]);

  describe("leadingModeCommand", () => {
    it("recognizes leading /plan command", () => {
      const result = leadingModeCommand("/plan create an architecture", allNames);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("plan");
      expect(result?.end).toBe(5);
    });

    it("recognizes leading /orchestrator command", () => {
      const result = leadingModeCommand("/orchestrator deploy services", allNames);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("orchestrator");
      expect(result?.end).toBe(13);
    });

    it("recognizes leading /draft command", () => {
      const result = leadingModeCommand("/draft note for tomorrow", allNames);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("draft");
      expect(result?.end).toBe(6);
    });

    it("ignores non-leading mode command", () => {
      const result = leadingModeCommand("please check /plan tomorrow", allNames);
      expect(result).toBeNull();
    });

    it("ignores unrecognized slash command", () => {
      const result = leadingModeCommand("/unknown do something", allNames);
      expect(result).toBeNull();
    });

    it("ignores mode commands not in the allowed names set", () => {
      const result = leadingModeCommand("/plan create plan", new Set(["draft"]));
      expect(result).toBeNull();
    });
  });

  describe("consume commands", () => {
    it("consumes /plan command", () => {
      const result = consumePlanCommand("/plan   build the feature");
      expect(result.planning).toBe(true);
      expect(result.text).toBe("build the feature");

      const noMatch = consumePlanCommand("build without plan");
      expect(noMatch.planning).toBe(false);
      expect(noMatch.text).toBe("build without plan");
    });

    it("consumes /orchestrator command", () => {
      const result = consumeOrchestratorCommand("/orchestrator run tasks");
      expect(result.matched).toBe(true);
      expect(result.text).toBe("run tasks");

      const noMatch = consumeOrchestratorCommand("run tasks directly");
      expect(noMatch.matched).toBe(false);
      expect(noMatch.text).toBe("run tasks directly");
    });

    it("consumes /draft command", () => {
      const result = consumeDraftCommand("/draft save this message");
      expect(result.matched).toBe(true);
      expect(result.text).toBe("save this message");

      const noMatch = consumeDraftCommand("send this message");
      expect(noMatch.matched).toBe(false);
      expect(noMatch.text).toBe("send this message");
    });
  });

  describe("UI Components", () => {
    it("renders ModeCommandPill with label and title", () => {
      const onClear = vi.fn();
      const markup = renderToStaticMarkup(
        createElement(ModeCommandPill, {
          name: PLAN_COMMAND.name,
          onClear,
        }),
      );
      expect(markup).toContain("Plan");
      expect(markup).toContain('aria-label="Turn off Plan mode"');
    });

    it("renders ModeCommandText with indent and shimmer", () => {
      const token = leadingModeCommand("/orchestrator test", allNames);
      expect(token).not.toBeNull();
      if (!token) return;

      const markup = renderToStaticMarkup(
        createElement(ModeCommandText, {
          text: "/orchestrator test",
          mode: token,
          indent: MODE_COMMAND_INDENT,
        }),
      );
      expect(markup).toContain("composer-mode-shimmer");
      expect(markup).toContain("orchestrator");
    });
  });
});
