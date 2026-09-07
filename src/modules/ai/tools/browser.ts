import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";
import {
  formatCandidateGrepQuery,
  formatComponentPromptDirective,
  getBrowserNetworkLog,
  getBrowserSelected,
  runBrowserClick,
  runBrowserEval,
  runBrowserNavigate,
  runBrowserSnapshot,
  runBrowserType,
  useLiveComponentStore,
} from "@/modules/preview";

const targetSchema = {
  ref: z.number().int().positive().optional(),
  selector: z.string().min(1).optional(),
  tabId: z.number().int().optional(),
};

export function buildBrowserTools(_ctx: ToolContext) {
  return {
    browser_get_selected_component: tool({
      description:
        "Retrieve the currently inspected component from the live web browser, including component name, exact file path, line number, CSS selector, DOM signature, text content, and framework.",
      inputSchema: z.object({}),
      execute: async () => {
        const selected = getBrowserSelected();
        if (!selected.selected) return selected;
        return {
          ...selected,
          directive: formatComponentPromptDirective(selected.component),
          candidateGrepQueries: formatCandidateGrepQuery(selected.component),
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

    browser_snapshot: tool({
      description:
        "Capture a compact accessibility snapshot of the active in-app preview. Use this to verify UI after a change.",
      inputSchema: z.object({
        tabId: z.number().int().optional(),
      }),
      execute: async ({ tabId }) => runBrowserSnapshot(tabId),
    }),

    browser_click: tool({
      description:
        "Click an element in the active preview, identified by a snapshot ref or CSS selector.",
      inputSchema: z.object({
        ...targetSchema,
      }),
      needsApproval: true,
      execute: async ({ ref, selector, tabId }) =>
        runBrowserClick({ ref, selector, tabId }),
    }),

    browser_type: tool({
      description:
        "Type into an input in the active preview. Optionally submit the nearest form.",
      inputSchema: z.object({
        ...targetSchema,
        text: z.string(),
        submit: z.boolean().optional(),
      }),
      needsApproval: true,
      execute: async ({ ref, selector, tabId, text, submit }) =>
        runBrowserType({ ref, selector, tabId, text, submit }),
    }),

    browser_navigate: tool({
      description:
        "Navigate the active preview iframe to a localhost URL. External URLs are rejected.",
      inputSchema: z.object({
        url: z.string().url(),
        tabId: z.number().int().optional(),
      }),
      execute: async ({ url, tabId }) => runBrowserNavigate(url, tabId),
    }),

    browser_eval: tool({
      description:
        "Evaluate a JavaScript expression in the active preview page context.",
      inputSchema: z.object({
        script: z.string().min(1),
        tabId: z.number().int().optional(),
      }),
      needsApproval: true,
      execute: async ({ script, tabId }) => runBrowserEval(script, tabId),
    }),

    browser_get_network_log: tool({
      description:
        "Return the recent truncated network log captured from the active preview (fetch and XHR).",
      inputSchema: z.object({}),
      execute: async () => getBrowserNetworkLog(),
    }),
  };
}
