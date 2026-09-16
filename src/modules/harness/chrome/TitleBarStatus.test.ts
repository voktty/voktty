import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    project: "project",
    title: id,
    more: [],
    sessionCount: 1,
    harnesses: ["codex"],
    busyHarnesses: [],
    doneHarnesses: [],
    files: [],
    ...overrides,
  };
}

function renderMarkup(tabs: Tab[]) {
  return renderToStaticMarkup(
    createElement(TitleBar, {
      tabs,
      activeId: "active",
      cwd: "/project",
      sidebarOpen: false,
      onToggleSidebar: vi.fn(),
      onNew: vi.fn(),
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onCloseMany: vi.fn(),
      onReorder: vi.fn(),
    }),
  );
}

describe("title tab response status", () => {
  it("shows a teal completion check until the response is seen", () => {
    const doneMarkup = renderMarkup([
      tab("done", { doneHarnesses: ["codex"] }),
      tab("active"),
    ]);

    expect(doneMarkup).toContain('data-harness-status="done"');
    expect(doneMarkup).toContain("text-teal-400");
    expect(doneMarkup).toContain("Response complete");

    const idleMarkup = renderMarkup([tab("done"), tab("active")]);
    expect(idleMarkup).toContain('data-harness-status="idle"');
    expect(idleMarkup).not.toContain('data-harness-status="done"');
  });

  it("keeps the loading indicator ahead of completion for the same provider", () => {
    const workingMarkup = renderMarkup([
      tab("working", {
        busyHarnesses: ["codex"],
        doneHarnesses: ["codex"],
      }),
      tab("active"),
    ]);

    expect(workingMarkup).toContain('data-harness-status="busy"');
    expect(workingMarkup).not.toContain('data-harness-status="done"');
  });
});
