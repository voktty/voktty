// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryInitialCapture } from "@/modules/workspace-kit/components/MemoryInitialCapture";
import { initialMemoryPrompt } from "@/modules/workspace-kit/lib/initialMemoryPrompt";

const { writeText } = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let container: HTMLDivElement;
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("offers the actual save guide as a manual alternative without starting an agent", async () => {
  await act(async () => root.render(<MemoryInitialCapture root="/project" />));
  expect(writeText).not.toHaveBeenCalled();
  expect(container.textContent).toContain("contracts with their consumers");
  expect(container.textContent).toContain("continuity/handoffs/");
  expect(container.textContent).not.toContain("common.open");
  await act(async () => {
    button("common.copy").click();
    await vi.dynamicImportSettled();
  });
  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    initialMemoryPrompt("/project"),
  );
  expect(container.textContent).toContain("common.copied");
});

it("does not claim successful preparation when the original conversation refuses it", async () => {
  const prepare = vi.fn(() => false);
  await act(async () =>
    root.render(<MemoryInitialCapture root="/project" prepare={prepare} />),
  );
  expect(prepare).not.toHaveBeenCalled();
  await act(async () => button("common.open").click());
  expect(prepare).toHaveBeenCalledExactlyOnceWith(
    initialMemoryPrompt("/project"),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "common.error",
  );
  expect(container.textContent).not.toContain(
    "projectMemory.conversationPrepared",
  );
});

it("coalesces copies and forbids later clipboard fallbacks after its presentation retires", async () => {
  let reject!: (error: Error) => void;
  writeText.mockReturnValue(
    new Promise<void>((_resolve, no) => {
      reject = no;
    }),
  );
  const web = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await act(async () => root.render(<MemoryInitialCapture root="/original" />));
  await act(async () => {
    button("common.copy").click();
    button("common.copy").click();
    await vi.dynamicImportSettled();
  });
  expect(writeText).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => reject(new Error("clipboard fixture unavailable")));
  expect(web).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
});
