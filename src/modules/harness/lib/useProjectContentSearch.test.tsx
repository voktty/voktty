// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectContentSearch } from "@/modules/harness/lib/useProjectContentSearch";

const io = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/modules/harness/lib/search", () => ({ searchProject: io.search }));
const index = {
  files: [],
  loading: false,
  error: null,
  source: undefined,
  isCurrent: () => true,
};
let root: Root;
let container: HTMLDivElement;
let finish: Array<(value: unknown) => void>;

function Probe({ query }: { query: string }) {
  const result = useProjectContentSearch(
    "/fixtures/project",
    query,
    true,
    index,
  );
  return createElement(
    "span",
    null,
    result.isCurrent()
      ? (result.error ?? result.matches.map((match) => match.preview).join(","))
      : "",
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  finish = [];
  io.search.mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const resolve of finish) resolve({ matches: [], truncated: false });
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retains the shared search quota across unmount until every request settles", async () => {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        Array.from({ length: 256 }, (_, id) =>
          createElement(Probe, { key: id, query: `query-${id}` }),
        ),
      ),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(io.search).toHaveBeenCalledTimes(256);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(Probe, { query: "current" })),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(io.search).toHaveBeenCalledTimes(256);
  expect(container.textContent).toContain("capacity");
  await act(async () => {
    for (const resolve of finish) resolve({ matches: [], truncated: false });
  });
  io.search.mockResolvedValue({
    matches: [
      {
        path: "/fixtures/project/file",
        relative: "file",
        line: 1,
        column: 1,
        preview: "current result",
      },
    ],
    truncated: false,
  });
  await act(async () => root.render(createElement(Probe, { query: "retry" })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(io.search).toHaveBeenCalledTimes(257);
  expect(container.textContent).toBe("current result");
});

it("does not publish an older local query after its replacement completed", async () => {
  await act(async () => root.render(createElement(Probe, { query: "first" })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await act(async () => root.render(createElement(Probe, { query: "second" })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const response = (preview: string) => ({
    matches: [
      {
        path: "/fixtures/project/file",
        relative: "file",
        line: 1,
        column: 1,
        preview,
      },
    ],
    truncated: false,
  });
  await act(async () => finish[1](response("current")));
  expect(container.textContent).toBe("current");
  await act(async () => finish[0](response("retired")));
  expect(container.textContent).toBe("current");
});
