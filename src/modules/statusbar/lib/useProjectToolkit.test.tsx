// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectToolkit } from "@/modules/statusbar/lib/useProjectToolkit";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import type { ConfigurableTool } from "@/modules/statusbar/lib/toolsConfigFile";
import type { ToolkitFileTarget } from "@/modules/statusbar/lib/toolkitFilesystem";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  target: vi.fn(),
  ensure: vi.fn(),
  skills: vi.fn(),
  detect: vi.fn(),
}));
vi.mock("@/modules/statusbar/lib/toolsConfigFile", () => ({
  DEFAULT_PROJECT_TOOLS: [],
  loadToolsConfigSnapshot: async (...args: unknown[]) => ({
    tools: await mocks.load(...args),
    target: await mocks.target(...args),
  }),
  ensureToolsConfigTarget: mocks.ensure,
}));
vi.mock("@/modules/harness/lib/fs", () => ({ listSkills: mocks.skills }));
vi.mock("@/modules/statusbar/lib/detectProjectStack", () => ({
  detectProjectStack: mocks.detect,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(
  enabled = true,
  strict = false,
  initialLoad?: Promise<ConfigurableTool[]>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const target = { path: "/config/tools.json", workspace: LOCAL_WORKSPACE };
  mocks.target.mockResolvedValue(target);
  mocks.ensure.mockResolvedValue(target);
  mocks.load.mockResolvedValue([]);
  if (initialLoad) mocks.load.mockReturnValueOnce(initialLoad);
  mocks.skills.mockResolvedValue([]);
  mocks.detect.mockResolvedValue(null);
  const input: Parameters<typeof useProjectToolkit>[0] = {
    cwd: "/project",
    workspace: LOCAL_WORKSPACE,
    sourceKey: "first",
    customServers: [],
    openFile: vi.fn(),
    onError: vi.fn(),
    enabled,
  };
  let output!: ReturnType<typeof useProjectToolkit>;
  function Reader() {
    output = useProjectToolkit(input);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () =>
      root.render(
        strict ? (
          <StrictMode>
            <Reader />
          </StrictMode>
        ) : (
          <Reader />
        ),
      ),
    );
  await render();
  return {
    input,
    output: () => output,
    render,
    close: () => act(async () => root.unmount()),
  };
}
const tool: ConfigurableTool = {
  id: "new",
  category: "custom",
  command: "echo new",
};

it("does not revive an original StrictMode read permit after effect replay", async () => {
  const first = deferred<ConfigurableTool[]>();
  const f = await setup(true, true, first.promise);
  try {
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[0][2]()).toBe(false);
    first.resolve([tool]);
    await act(async () => first.promise);
    expect(f.output().tools).toEqual([]);
  } finally {
    await f.close();
  }
});

it("performs no filesystem work until opened and retires an edit when closed", async () => {
  const f = await setup(false);
  try {
    await f.output().reloadTools();
    await f.output().reloadSkills();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.skills).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
    f.input.enabled = true;
    await f.render();
    expect(mocks.load).toHaveBeenCalledOnce();
    const pending = deferred<ToolkitFileTarget>();
    mocks.ensure.mockReturnValueOnce(pending.promise);
    const opening = f.output().editConfig();
    f.input.enabled = false;
    await f.render();
    pending.resolve({ path: "/config/tools.json", workspace: LOCAL_WORKSPACE });
    expect(await opening).toBe(false);
    expect(f.input.openFile).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("does not revive a cached edit after configuration publication changes and returns", async () => {
  const f = await setup();
  try {
    const cached = f.output().editConfig;
    mocks.target.mockResolvedValueOnce({
      path: "/project/.voktty/tools.json",
      workspace: LOCAL_WORKSPACE,
    });
    await act(async () => f.output().reloadTools());
    await act(async () => f.output().reloadTools());
    expect(f.output().configFilePath).toBe("/config/tools.json");
    expect(await cached()).toBe(false);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(await f.output().editConfig()).toBe(true);
  } finally {
    await f.close();
  }
});

it("opens global configuration with its local filesystem rather than the selected WSL context", async () => {
  const f = await setup();
  try {
    f.input.workspace = { kind: "wsl", distro: "Debian" };
    await f.render();
    expect(await f.output().editConfig()).toBe(true);
    expect(f.input.openFile).toHaveBeenCalledExactlyOnceWith(
      "/config/tools.json",
      LOCAL_WORKSPACE,
    );
    expect(mocks.ensure.mock.lastCall?.[1]).toBe(f.input.workspace);
  } finally {
    await f.close();
  }
});

it("exposes an unavailable native editor for namespace configuration without opening its URI locally", async () => {
  const f = await setup();
  try {
    mocks.target.mockResolvedValue({
      path: "remote://host/project/.voktty/tools.json",
      workspace: LOCAL_WORKSPACE,
    });
    f.input.cwd = "remote://host/project";
    await f.render();
    expect(f.output().editDisabledReason).toBe("feedback.editorUnavailable");
    expect(await f.output().editConfig()).toBe(false);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(f.input.openFile).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("retires a cached edit after another owner of the same path appears and the original returns", async () => {
  const f = await setup();
  try {
    const cached = f.output().editConfig;
    f.input.sourceKey = "second";
    await f.render();
    f.input.sourceKey = "first";
    await f.render();
    expect(await cached()).toBe(false);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(await f.output().editConfig()).toBe(true);
  } finally {
    await f.close();
  }
});

it.each(["replace", "unmount"] as const)(
  "retires pending edit delivery and its write guard after %s",
  async (reason) => {
    const f = await setup();
    const pending = deferred<ToolkitFileTarget>();
    mocks.ensure.mockReturnValueOnce(pending.promise);
    const opening = f.output().editConfig();
    const guard = mocks.ensure.mock.lastCall?.[2];
    expect(guard()).toBe(true);
    if (reason === "unmount") await f.close();
    else {
      f.input.sourceKey = "second";
      await f.render();
    }
    expect(guard()).toBe(false);
    pending.resolve({ path: "/old/tools.json", workspace: LOCAL_WORKSPACE });
    expect(await opening).toBe(false);
    expect(f.input.openFile).not.toHaveBeenCalled();
    if (reason !== "unmount") await f.close();
  },
);

it("suppresses old tools results and superseded reads in the current source", async () => {
  const f = await setup();
  try {
    const first = deferred<ConfigurableTool[]>();
    mocks.load.mockReturnValueOnce(first.promise);
    const old = f.output().reloadTools();
    mocks.load.mockResolvedValueOnce([tool]);
    await act(async () => f.output().reloadTools());
    first.resolve([{ ...tool, id: "old" }]);
    await act(async () => old);
    expect(f.output().tools).toEqual([tool]);
    const late = deferred<ConfigurableTool[]>();
    mocks.load.mockReturnValueOnce(late.promise);
    const retired = f.output().reloadTools();
    f.input.cwd = "/other";
    mocks.load.mockResolvedValueOnce([]);
    await f.render();
    late.resolve([tool]);
    await act(async () => retired);
    expect(f.output().tools).toEqual([]);
  } finally {
    await f.close();
  }
});

it.each([
  { cwd: "remote://host/project", workspace: LOCAL_WORKSPACE },
  { cwd: "/project", workspace: { kind: "wsl", distro: "Debian" } },
  {
    cwd: "/project",
    workspace: {
      kind: "ssh",
      connection: { id: "host", name: "Host", host: "example.test" },
      root: "/project",
    },
  },
] as { cwd: string; workspace: WorkspaceEnv }[])(
  "does not scan local skills for remote filesystem %#",
  async (target) => {
    const f = await setup();
    try {
      mocks.skills.mockClear();
      Object.assign(f.input, target);
      await f.render();
      expect(mocks.skills).not.toHaveBeenCalled();
      expect(f.output().skillsDisabledReason).toBe("workspace.localMachine");
      expect(f.output().openSkill("/other/SKILL.md")).toBe(false);
      expect(f.input.openFile).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it("reports a current edit failure but suppresses a retired rejection", async () => {
  const f = await setup();
  try {
    mocks.ensure.mockRejectedValueOnce(new Error("unavailable"));
    expect(await f.output().editConfig()).toBe(false);
    expect(f.input.onError).toHaveBeenCalledOnce();
    const pending = deferred<ToolkitFileTarget>();
    mocks.ensure.mockReturnValueOnce(pending.promise);
    const opening = f.output().editConfig();
    f.input.sourceKey = "second";
    await f.render();
    pending.reject(new Error("retired"));
    expect(await opening).toBe(false);
    expect(f.input.onError).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("retains cancelled requests in the shared budget until actual settlement", async () => {
  const f = await setup();
  try {
    const pending = deferred<ToolkitFileTarget>();
    mocks.ensure.mockReturnValue(pending.promise);
    const openings = Array.from({ length: 256 }, () => f.output().editConfig());
    expect(mocks.ensure).toHaveBeenCalledTimes(256);
    f.input.sourceKey = "second";
    await f.render();
    expect(await f.output().editConfig()).toBe(false);
    expect(mocks.ensure).toHaveBeenCalledTimes(256);
    pending.resolve({ path: "/old/tools.json", workspace: LOCAL_WORKSPACE });
    await Promise.all(openings);
    expect(f.input.openFile).not.toHaveBeenCalled();
    mocks.ensure.mockResolvedValue({
      path: "/new/tools.json",
      workspace: LOCAL_WORKSPACE,
    });
    await act(async () => f.output().reloadTools());
    expect(await f.output().editConfig()).toBe(true);
    expect(mocks.ensure).toHaveBeenCalledTimes(257);
  } finally {
    await f.close();
  }
});
