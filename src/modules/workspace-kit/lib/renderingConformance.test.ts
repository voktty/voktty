import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/rendering.json";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import { renderKitTemplate } from "@/modules/workspace-kit/lib/template";

it.each(corpus.cases)(
  "shares native rendering bytes for $name",
  async (test) => {
    const template = await loadKitTemplate();
    expect(template.version).toBe(corpus.templateVersion);
    const render = () =>
      renderKitTemplate(template, { ...corpus.values, ...test.values });
    if (!test.valid) {
      expect(render).toThrow();
      return;
    }
    expect(
      render().map((file) => ({
        path: file.path,
        kind: file.kind,
        sha256: createHash("sha256").update(file.text, "utf8").digest("hex"),
      })),
    ).toEqual(test.files);
  },
);
