import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

describe("AgentMarkdown text direction", () => {
  it("detects direction independently for RTL and LTR blocks", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: [
          "# راهنمای تنظیمات",
          "",
          "این متن فارسی است.",
          "",
          "1. مرحله اول",
          "2. مرحله دوم",
          "",
          "English remains left to right.",
        ].join("\n"),
      }),
    );

    expect(markup).toMatch(/dir="rtl"[^>]*><h1/);
    expect(markup).toMatch(/dir="rtl"[^>]*><p/);
    expect(markup).toMatch(/dir="rtl"[^>]*><ol/);
    expect(markup).toMatch(/dir="ltr"[^>]*><p/);
  });

  it("isolates links and inline code inside RTL prose", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "مسیر `templates/admin/settings.html` و [پیوند](https://example.com) را بررسی کنید.",
      }),
    );

    expect(markup).toContain('<code dir="ltr"');
    expect(markup).toContain('dir="auto"');
  });

  it("keeps fenced code blocks LTR when their content is Arabic", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nمرحبا بالعالم\n```",
      }),
    );

    expect(markup).toContain('class="markdown-code-shell" dir="ltr"');
  });
});

describe("AgentMarkdown inline code", () => {
  it("lets a long inline code span grow instead of clipping to a fixed height", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "1. `Before I refactor the transcript rendering, summarize how turns are grouped, in five bullets.`",
      }),
    );

    const match = markup.match(/<code dir="ltr" class="([^"]*)"/);
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("min-h-6");
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("h-6");
  });
});

describe("AgentMarkdown file links and navigation", () => {
  it("renders inline file chips for code referencing existing files", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "Check `src/main.ts:12:3` and `Dockerfile` and `docs/my%20file.md`",
        cwd: "/repo",
        onOpenFile: () => {},
      }),
    );

    expect(markup).toContain('role="link"');
    expect(markup).toContain("src/main.ts:12:3");
    expect(markup).toContain("Dockerfile");
  });

  it("renders local markdown links with normalized hrefs", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "[Guide](<docs/My Guide.md#L7-L9>) and [Readme](./README.md)",
        cwd: "/repo",
        onOpenFile: () => {},
      }),
    );

    expect(markup).toContain("<a");
    expect(markup).toContain('href="/repo/docs/My%20Guide.md:7"');
    expect(markup).toContain('href="/repo/README.md"');
  });

  it("keeps non-file links and javascript: links safe", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "[Web](https://example.com) and [Script](javascript:alert(1))",
        cwd: "/repo",
        onOpenFile: () => {},
      }),
    );

    expect(markup).toContain('href="https://example.com/');
    expect(markup).not.toContain('href="javascript:alert(1)"');
  });
});
