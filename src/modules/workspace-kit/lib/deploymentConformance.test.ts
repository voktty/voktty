import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/deployment.json";
import {
  planKitDeployment,
  type KitPathFact,
} from "@/modules/workspace-kit/lib/deployment";
import type { KitFile } from "@/modules/workspace-kit/lib/template";

it.each(corpus.cases)("shares native deployment preview for $name", (test) => {
  const facts = new Map(Object.entries(test.facts)) as Map<string, KitPathFact>;
  const files = (test.files ?? corpus.files) as readonly KitFile[];
  const plan = () => planKitDeployment(files, facts, test.rootLinks);
  if (test.error) {
    expect(plan).toThrow(
      test.error === "KIT_DEPLOYMENT_PATH_INVALID"
        ? "Invalid deployment path"
        : "Missing deployment observation",
    );
  } else {
    expect(plan()).toEqual(test.expected);
  }
});
