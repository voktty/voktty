import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";
import {
  useLiveComponentStore,
  formatComponentPromptDirective,
  formatCandidateGrepQuery,
} from "@/modules/preview";

export function buildBrowserTools(_ctx: ToolContext) {
  return {
    browser_get_selected_component: tool({
      description:
        "Retrieve the currently inspected component from the live web browser, including component name, exact file path, line number, CSS selector, DOM signature, text content, and framework.",
      inputSchema: z.object({}),
      execute: async () => {
        const comp = useLiveComponentStore.getState().selectedComponent;
        if (!comp) {
          return {
            selected: false,
            message:
              "No live component is currently selected in the browser. Toggle inspection with Ctrl+G and click an element.",
          };
        }
        return {
          selected: true,
          component: comp,
          directive: formatComponentPromptDirective(comp),
          candidateGrepQueries: formatCandidateGrepQuery(comp),
        };
      },
    }),

    browser_inspect: tool({
      description:
        "Activate or deactivate live component inspection in the web browser preview.",
      inputSchema: z.object({
        active: z
          .boolean()
          .describe(
            "True to activate visual inspector, false to deactivate",
          ),
      }),
      execute: async ({ active }) => {
        useLiveComponentStore.getState().setInspectorActive(active);
        return {
          ok: true,
          active,
          message: active
            ? "Visual component inspector activated. Elements in the browser preview can now be clicked to capture metadata."
            : "Visual component inspector deactivated.",
        };
      },
    }),

    browser_clear_selection: tool({
      description:
        "Clear the currently selected component in the live browser inspector.",
      inputSchema: z.object({}),
      execute: async () => {
        useLiveComponentStore.getState().clearSelection();
        return {
          ok: true,
          message: "Cleared selected live component.",
        };
      },
    }),
  };
}
