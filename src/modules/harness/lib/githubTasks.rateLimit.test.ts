import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  listInboxItems,
  peekInboxList,
  type GithubTaskKind,
  type GithubWorkItem,
  type InboxQuery,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function workItem(kind: GithubTaskKind): GithubWorkItem {
  return {
    kind,
    number: kind === "pr" ? 2 : 1,
    title: kind === "pr" ? "Pull request" : "Issue",
    url: `https://github.com/acme/web/${kind === "pr" ? "pull" : "issues"}/1`,
    state: "open",
    updatedAt: "2026-10-06T12:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
  };
}

describe("Inbox cache during GitHub rate limits", () => {
  beforeEach(() => {
    clearInboxCache();
    vi.mocked(invoke).mockReset();
  });

  it("keeps the last GitHub snapshot until a forced refresh recovers", async () => {
    let limited = false;
    const projects = [{ path: "/tmp/web" }];
    const query: InboxQuery = {
      assignedToMe: false,
      state: "open",
      search: "",
    };

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "git_github_repo") return "acme/web";
      if (command === "git_github_work_items") {
        if (limited) throw new Error("GraphQL: API rate limit already exceeded");
        return [workItem((args as { kind: GithubTaskKind }).kind)];
      }
      return { connected: false };
    });

    const initial = await listInboxItems(projects, query);
    limited = true;
    const stale = await listInboxItems(projects, query, { force: true });

    expect(stale.items).toEqual(initial.items);
    expect(stale.errors.github).toContain("rate limit");

    limited = false;
    const recovered = await listInboxItems(projects, query, { force: true });
    expect(recovered.items).toEqual(initial.items);
    expect(recovered.errors).toEqual({});
  });

  it("does not restore a cache entry from a request invalidated while pending", async () => {
    const projects = [{ path: "/tmp/web" }];
    const query: InboxQuery = {
      assignedToMe: false,
      state: "open",
      search: "",
    };
    let resolveItems!: (items: GithubWorkItem[]) => void;
    const pendingItems = new Promise<GithubWorkItem[]>((resolve) => {
      resolveItems = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_github_repo") return "acme/web";
      if (command === "git_github_work_items") return pendingItems;
      return { connected: false };
    });

    const pending = listInboxItems(projects, query);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "git_github_work_items",
        expect.objectContaining({ cwd: "/tmp/web" }),
      ),
    );
    clearInboxCache();
    resolveItems([workItem("issue")]);
    await pending;

    expect(peekInboxList(projects, query)).toBeNull();
  });
});
