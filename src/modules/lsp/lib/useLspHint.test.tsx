// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLspHint } from "@/modules/lsp/lib/useLspHint";
import { LspStatusPill } from "@/modules/lsp/components/LspStatusPill";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useLspRuntimeStore } from "@/modules/lsp/lib/runtimeStore";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
const io = vi.hoisted(() => ({ detect: vi.fn(), language: vi.fn() }));
vi.mock("@/modules/lsp/lib/detect", () => ({
  detectBinary: io.detect,
  redetectBinary: io.detect,
}));
vi.mock("@/modules/editor/lib/languageResolver", () => ({
  resolveLanguage: io.language,
}));
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/work",
  connection: { id: "a", name: "A", host: "host-a" },
};
let node: HTMLDivElement;
let root: Root;
let hint: ReturnType<typeof useLspHint>;
function Reader({
  workspace,
  path = "/work/file.ts",
}: {
  workspace: WorkspaceEnv | undefined;
  path?: string;
}) {
  hint = useLspHint(path, workspace);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.language.mockResolvedValue({ id: "ts" });
  io.detect.mockResolvedValue(null);
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  usePreferencesStore.setState({ lspActivation: {}, lspCustomServers: [] });
  useLspRuntimeStore.setState({ detected: {}, sessions: {}, failed: {} });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("uses the local document while the global environment is SSH", async () => {
  useWorkspaceEnvStore.setState({ env: ssh });
  await act(async () => root.render(<Reader workspace={LOCAL_WORKSPACE} />));
  expect(io.detect).toHaveBeenCalledWith("typescript-language-server");
});
it.each([ssh, { kind: "wsl", distro: "fixture" } as const, undefined])(
  "never probes local binaries for an unsupported source",
  async (workspace) => {
    await act(async () => root.render(<Reader workspace={workspace} />));
    expect(hint?.kind).toBe("unsupported");
    expect(io.detect).not.toHaveBeenCalled();
    expect(io.language).not.toHaveBeenCalled();
  },
);
it("rejects an unresolved remote namespace despite a local descriptor", async () => {
  await act(async () =>
    root.render(
      <Reader
        workspace={LOCAL_WORKSPACE}
        path="remote://voktty-ssh-a/work/file.ts"
      />,
    ),
  );
  expect(hint?.kind).toBe("unsupported");
  expect(io.detect).not.toHaveBeenCalled();
});
it("exposes a disabled indicator with a reason and no local enable or install action", async () => {
  await act(async () =>
    root.render(<LspStatusPill filePath="/work/file.ts" workspaceEnv={ssh} />),
  );
  const indicator = node.querySelector('[aria-disabled="true"]');
  expect(indicator?.textContent).toContain("TypeScript LSP");
  expect(indicator?.getAttribute("title")).toBeTruthy();
  expect(node.querySelector("button")).toBeNull();
  expect(io.detect).not.toHaveBeenCalled();
});
