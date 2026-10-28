import { beforeAll, expect, it } from "vitest";
import { z } from "zod";
import corpus from "@/../templates/workspace-kit/conformance/validation.json";
import {
  parseAgentRoster,
  parseKitConfig,
} from "@/modules/workspace-kit/lib/validation";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import { renderKitTemplate } from "@/modules/workspace-kit/lib/template";

let kit: string;
let roster: string;
beforeAll(async () => {
  const files = renderKitTemplate(await loadKitTemplate(), corpus.values);
  kit = files.find((file) => file.path === ".voktty/kit.json")?.text ?? "";
  roster =
    files.find((file) => file.path === ".voktty/team/agents.json")?.text ?? "";
});

it.each(corpus.cases)("conforms to $name", (test) => {
  const data = JSON.parse(test.target === "kit" ? kit : roster);
  for (const change of test.changes) {
    let parent = data;
    for (const segment of change.path.slice(0, -1)) parent = parent[segment];
    const key = change.path[change.path.length - 1];
    if ("remove" in change && change.remove) delete parent[key];
    else if ("value" in change)
      Object.defineProperty(parent, key, {
        value: change.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  let text = JSON.stringify(data);
  if ("rawEdit" in test && test.rawEdit) {
    const edit = test.rawEdit;
    expect(text.split(edit.find)).toHaveLength(2);
    text = text.replace(edit.find, () => edit.with);
  }
  const parse = () =>
    test.target === "kit"
      ? parseKitConfig(text)
      : parseAgentRoster(
          text,
          test.pathCase === "insensitive" ? "insensitive" : "sensitive",
        );
  if (test.valid) expect(parse).not.toThrow();
  else {
    let error: unknown;
    try {
      parse();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(z.ZodError);
    if ("customCode" in test && test.customCode) {
      expect(
        (error as z.ZodError).issues.some(
          (issue) =>
            issue.code === "custom" && issue.message === test.customCode,
        ),
      ).toBe(true);
    }
    if ("issue" in test)
      expect(
        (error as z.ZodError).issues.some(
          (issue) => JSON.stringify(issue.path) === JSON.stringify(test.issue),
        ),
      ).toBe(true);
  }
});

it("counts Unicode code points for JSON Schema string limits", () => {
  const data = JSON.parse(roster);
  data.defaults.runtime.model = "\u{10400}".repeat(80);
  expect(() =>
    parseAgentRoster(JSON.stringify(data), "sensitive"),
  ).not.toThrow();
  data.defaults.runtime.model = "\u{10400}".repeat(129);
  expect(() => parseAgentRoster(JSON.stringify(data), "sensitive")).toThrow(
    z.ZodError,
  );
});

it.each(["kit", "roster"] as const)(
  "rejects malformed, wrong-shaped and oversized %s without exposing document text",
  (target) => {
    const parse =
      target === "kit"
        ? parseKitConfig
        : (text: string) => parseAgentRoster(text, "sensitive");
    for (const text of [
      "{private-content",
      "null",
      "[]",
      `"${"é".repeat(140000)}"`,
    ]) {
      expect(() => parse(text)).toThrow(z.ZodError);
      try {
        parse(text);
      } catch (error) {
        expect(String(error)).not.toContain("private-content");
      }
    }
  },
);

it("returns deeply frozen, detached configurations and rosters", () => {
  const config = parseKitConfig(kit);
  const agents = parseAgentRoster(roster, "sensitive");
  expect(Object.isFrozen(config.capture.every)).toBe(true);
  expect(Object.isFrozen(config.values)).toBe(true);
  expect(Object.isFrozen(agents.agents[0].owns)).toBe(true);
  expect(Object.isFrozen(agents.defaults?.runtime)).toBe(true);
  expect(parseKitConfig(kit)).not.toBe(config);
});

it("requires an explicit filesystem case policy instead of guessing from a path", () => {
  expect(() => Reflect.apply(parseAgentRoster, undefined, [roster])).toThrow(
    z.ZodError,
  );
});

it("bounds structural work on deeply nested JSON without using the call stack", () => {
  const text = `${"[".repeat(20000)}0${"]".repeat(20000)}`;
  expect(() => parseKitConfig(text)).toThrow("KIT_DOCUMENT_NODE_LIMIT");
});
