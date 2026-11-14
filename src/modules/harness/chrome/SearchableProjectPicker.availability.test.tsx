// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SearchableProjectPicker } from "./SearchableProjectPicker";

const probed = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./Popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../hooks/useProjectAvailability", () => ({
  useProjectAvailability: (paths: string[]) => {
    probed.calls.push(paths);
    return {
      unavailableReasons: new Map<string, string>(
        paths
          .filter((p) => p.endsWith("/gone"))
          .map((p) => [p, "missing-directory"]),
      ),
    };
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  probed.calls.length = 0;
});

it("marks a project whose folder is gone, only while the dropdown is open", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SearchableProjectPicker
        cwd="C:/work/ok"
        recents={[
          { path: "C:/work/ok", openedAt: 2 },
          { path: "C:/work/gone", openedAt: 1 },
          { path: "C:/work/fine", openedAt: 0 },
        ]}
        onSelectProject={() => {}}
      />,
    );
  });
  expect(probed.calls.every((paths) => paths.length === 0)).toBe(true);

  await act(async () => {
    host.querySelector<HTMLButtonElement>("button")?.click();
  });
  const rows = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button[title]"),
  );
  const gone = rows.find((row) => row.textContent?.includes("gone"));
  expect(gone).toBeDefined();
  expect(gone?.querySelector("span.italic")).not.toBeNull();
  expect(
    gone?.querySelector("[aria-label='harness.unavailableDirShort']"),
  ).not.toBeNull();
  const ok = rows.find((row) => row.textContent?.includes("fine"));
  expect(ok).toBeDefined();
  expect(ok?.querySelector("span.italic")).toBeNull();
  await act(async () => root.unmount());
});
