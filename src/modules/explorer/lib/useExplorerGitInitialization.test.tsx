// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExplorerGitInitialization } from "@/modules/explorer/lib/useExplorerGitInitialization";

let root: Root;
let initialize: () => Promise<void>;
const run = vi.fn<() => Promise<boolean>>();
const success = vi.fn();
const error = vi.fn();
function Probe({
  scope,
  callback = run,
}: {
  scope: object;
  callback?: () => Promise<boolean>;
}) {
  initialize = useExplorerGitInitialization({
    scope,
    rootPath: "/project",
    initialize: callback,
    onSuccess: success,
    onError: error,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockReset().mockResolvedValue(true);
  success.mockReset();
  error.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "announces only accepted Explorer initialization (%s)",
  async (accepted) => {
    run.mockResolvedValue(accepted);
    await act(async () => root.render(<Probe scope={{}} />));
    await act(async () => initialize());
    expect(run).toHaveBeenCalledExactlyOnceWith("/project");
    expect(success).toHaveBeenCalledTimes(accepted ? 1 : 0);
  },
);
it.each([false, true])(
  "retires pending Explorer feedback on scope replacement (reject=%s)",
  async (reject) => {
    let done!: (accepted: boolean) => void;
    let fail!: (reason: Error) => void;
    run.mockImplementation(
      () =>
        new Promise<boolean>((resolve, error) => {
          done = resolve;
          fail = error;
        }),
    );
    await act(async () => root.render(<Probe scope={{}} />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = initialize();
    });
    await act(async () => root.render(<Probe scope={{}} />));
    await act(async () => {
      if (reject) fail(new Error("Retired"));
      else done(true);
      await pending;
    });
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  },
);
it("refuses cached calls after unmount", async () => {
  await act(async () => root.render(<Probe scope={{}} />));
  const old = initialize;
  await act(async () => root.render(null));
  await act(async () => old());
  expect(run).not.toHaveBeenCalled();
});
it("coalesces current calls while retaining a replacement's pending state", async () => {
  const completions: ((value: boolean) => void)[] = [];
  run.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        completions.push(resolve);
      }),
  );
  await act(async () => root.render(<Probe scope={{}} />));
  let first!: Promise<void>;
  await act(async () => {
    first = initialize();
    void initialize();
  });
  expect(run).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe scope={{}} />));
  let next!: Promise<void>;
  await act(async () => {
    next = initialize();
  });
  await act(async () => {
    completions[0](true);
    await first;
    void initialize();
  });
  expect(run).toHaveBeenCalledTimes(2);
  await act(async () => {
    completions[1](true);
    await next;
  });
  expect(success).toHaveBeenCalledTimes(1);
});
it("retains the existing current error callback", async () => {
  const reason = new Error("Current failure");
  run.mockRejectedValue(reason);
  await act(async () => root.render(<Probe scope={{}} />));
  await act(async () => initialize());
  expect(error).toHaveBeenCalledExactlyOnceWith(reason);
});
it("keeps retired requests within the bounded unsettled budget", async () => {
  const completions: ((value: boolean) => void)[] = [];
  const operations: Promise<void>[] = [];
  run.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        completions.push(resolve);
      }),
  );
  for (let index = 0; index <= 256; index++) {
    await act(async () => root.render(<Probe scope={{ index }} />));
    await act(async () => {
      operations.push(initialize());
    });
  }
  expect(run).toHaveBeenCalledTimes(256);
  await act(async () => {
    for (const done of completions) done(true);
    await Promise.all(operations);
  });
  run.mockResolvedValueOnce(true);
  await act(async () => initialize());
  expect(run).toHaveBeenCalledTimes(257);
});
it("does not revive a cached call when its exact scope object returns", async () => {
  const scope = {};
  await act(async () => root.render(<Probe scope={scope} />));
  const old = initialize;
  await act(async () => root.render(<Probe scope={{}} />));
  await act(async () => root.render(<Probe scope={scope} />));
  await act(async () => old());
  expect(run).not.toHaveBeenCalled();
  await act(async () => initialize());
  expect(run).toHaveBeenCalledTimes(1);
});
