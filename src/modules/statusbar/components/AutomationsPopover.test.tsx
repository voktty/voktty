// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationsPopover } from "./AutomationsPopover";

const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    run: vi.fn(),
    toggle: vi.fn(),
  },
}));
vi.mock("@/modules/harness/lib/automations", () => ({
  peekAutomations: () => null,
  listAutomations: api.list,
  createManualAutomationRun: api.run,
  setAutomationEnabled: api.toggle,
  subscribeAutomations: () => () => {},
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = {
  id: "a1",
  name: "Nightly review",
  enabled: true,
  nextRunAt: Date.now() + 3600_000,
};

let unmount: () => Promise<void>;

async function mount(onOpenAll = vi.fn()) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(
      <TooltipProvider>
        <AutomationsPopover onOpenAll={onOpenAll} />
      </TooltipProvider>,
    ));
  unmount = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return onOpenAll;
}

async function openPanel() {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="statusbar.automations.title"]',
  );
  await act(async () => trigger?.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockReset();
  api.run.mockReset().mockResolvedValue({});
  api.toggle.mockReset().mockResolvedValue({});
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

it("lists automations and queues a manual run", async () => {
  api.list.mockResolvedValue([item]);
  await mount();
  await openPanel();
  expect(document.body.textContent).toContain("Nightly review");
  const run = document.querySelector<HTMLButtonElement>(
    'button[aria-label="statusbar.automations.runNow"]',
  );
  await act(async () => run?.click());
  expect(api.run).toHaveBeenCalledWith("a1");
});

it("shows a clear state when the list cannot load", async () => {
  api.list.mockRejectedValue(new Error("boom"));
  await mount();
  await openPanel();
  expect(document.body.textContent).toContain("statusbar.automations.loadFailed");
});

it("shows the empty state and opens the full view", async () => {
  api.list.mockResolvedValue([]);
  const onOpenAll = await mount();
  await openPanel();
  expect(document.body.textContent).toContain("statusbar.automations.empty");
  const all = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("statusbar.automations.openAll"),
  );
  await act(async () => all?.click());
  expect(onOpenAll).toHaveBeenCalledOnce();
});
