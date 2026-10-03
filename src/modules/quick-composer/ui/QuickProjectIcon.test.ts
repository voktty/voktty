import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  QuickProjectIcon,
  type loadQuickProjectAppearance,
} from "./QuickProjectIcon";
import { projectKey, projectName } from "@/modules/harness/lib/paths";
import { projectMascot } from "@/modules/harness/lib/projectMascots";

vi.mock("@/modules/harness/lib/projectLogos", () => ({
  projectLogoSrc: (path: string | null) => (path ? `asset://${path}` : null),
}));

describe("QuickProjectIcon", () => {
  const path = "/Users/me/code/agent-terminal";

  it("renders a mascot instead of trying to load a project directory as an image", () => {
    const appearance: ReturnType<typeof loadQuickProjectAppearance> = {
      logos: {},
      mascots: {},
      colors: {},
      customColors: {},
    };
    const markup = renderToStaticMarkup(
      createElement(QuickProjectIcon, {
        projectPath: path,
        appearance,
        className: "size-4",
      }),
    );
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<svg");
    expect(markup).toContain(projectMascot(projectName(path)).restPath);
  });

  it("uses the project's saved mascot and color", () => {
    const appearance: ReturnType<typeof loadQuickProjectAppearance> = {
      logos: {},
      mascots: { [projectKey(path)]: "cat" },
      colors: {},
      customColors: { [projectKey(path)]: "#ff0000" },
    };
    const markup = renderToStaticMarkup(
      createElement(QuickProjectIcon, {
        projectPath: path,
        appearance,
        className: "size-4",
      }),
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain(projectMascot(projectName(path), "cat").restPath);
    expect(markup).toContain("#ff0000");
  });

  it("loads saved logos when present", () => {
    const appearance: ReturnType<typeof loadQuickProjectAppearance> = {
      logos: { [projectKey(path)]: "/app-data/logos/project.png" },
      mascots: {},
      colors: {},
      customColors: {},
    };
    const markup = renderToStaticMarkup(
      createElement(QuickProjectIcon, {
        projectPath: path,
        appearance,
        className: "size-4",
      }),
    );
    expect(markup).toContain("<img");
    expect(markup).toContain('src="asset:///app-data/logos/project.png"');
  });
});
