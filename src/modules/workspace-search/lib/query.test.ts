import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  createWorkspaceSearchRequest,
  DEFAULT_WORKSPACE_SEARCH_OPTIONS,
  splitGlobList,
} from "@/modules/workspace-search/lib/query";
import { describe, expect, it } from "vitest";

describe("workspace search query", () => {
  it("preserves commas inside brace globs and removes duplicate filters", () => {
    expect(
      splitGlobList("src/**, {test,spec}/**/*.ts, src/**, **/*.tsx"),
    ).toEqual(["src/**", "{test,spec}/**/*.ts", "**/*.tsx"]);
  });

  it("does not search until the query contains non-whitespace text", () => {
    expect(
      createWorkspaceSearchRequest(
        "C:/project",
        LOCAL_WORKSPACE,
        { ...DEFAULT_WORKSPACE_SEARCH_OPTIONS, query: "   " },
        false,
      ),
    ).toBeNull();
  });

  it("maps user controls to the native search contract", () => {
    expect(
      createWorkspaceSearchRequest(
        "/srv/app",
        LOCAL_WORKSPACE,
        {
          query: "  widget  ",
          regex: true,
          caseSensitive: true,
          wholeWord: true,
          include: "src/**, **/*.tsx",
          exclude: "dist/**, **/*.snap",
        },
        true,
      ),
    ).toMatchObject({
      pattern: "widget",
      root: "/srv/app",
      include: ["src/**", "**/*.tsx"],
      exclude: ["dist/**", "**/*.snap"],
      regex: true,
      caseSensitive: true,
      wholeWord: true,
      showHidden: true,
      workspace: LOCAL_WORKSPACE,
    });
  });
});
