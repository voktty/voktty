import { describe, expect, it, vi } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/memory-identity.json";
import { memoryProjectKey } from "@/modules/workspace-kit/lib/identity";
import useCorpus from "@/../templates/workspace-kit/conformance/memory-use.json";
import { evaluateMemoryUse } from "@/modules/workspace-kit/lib/policy";
import { resolveMemoryScope } from "@/modules/workspace-kit/lib/scope";

describe("project memory identity", () => {
  it("uses the resolved identity without transferring a session grant across hosts", async () => {
    const local = await memoryProjectKey(JSON.stringify(corpus.baseline));
    const remote = await memoryProjectKey(
      JSON.stringify({ ...corpus.baseline, kind: "ssh" }),
    );
    const facts = {
      ...useCorpus.baseline,
      projectKey: local,
      trust: {
        projectKey: local,
        instructionDigest: useCorpus.baseline.instructionDigest,
      },
      session: { ...useCorpus.baseline.session, projectKey: local },
    };
    const resolve = (directoryKey: string, state = "valid") =>
      resolveMemoryScope(
        JSON.stringify({
          schema: 1,
          purpose: "discover",
          stop: "root",
          elapsedMs: 0,
          descendants: null,
          ancestors: [{ directoryKey, parentKey: null, state }],
        }),
      );
    const use = (scope: ReturnType<typeof resolve>) =>
      evaluateMemoryUse(
        JSON.stringify({
          ...facts,
          projectKey: scope.rootKey ?? local,
          kitState: scope.state,
        }),
      );
    expect(use(resolve(local)).contextAllowed).toBe(true);
    expect(use(resolve(remote)).contextAllowed).toBe(false);
    expect(use(resolve(local, "partial")).contextAllowed).toBe(false);
  });
  it.each(corpus.cases)("$name", async (test) => {
    const input = JSON.stringify({ ...corpus.baseline, ...test.changes });
    if (test.invalid) await expect(memoryProjectKey(input)).rejects.toThrow();
    else await expect(memoryProjectKey(input)).resolves.toBe(test.expected);
  });

  it("bounds UTF-8 fields and documents before hashing", async () => {
    await expect(memoryProjectKey(" ".repeat(16385))).rejects.toThrow(
      "KIT_DOCUMENT_TOO_LARGE",
    );
    const input = (filesystemId: string) =>
      JSON.stringify({ ...corpus.baseline, filesystemId });
    await expect(memoryProjectKey(input("é".repeat(2049)))).rejects.toThrow(
      "KIT_IDENTITY_FIELD_TOO_LARGE",
    );
    await expect(memoryProjectKey(input("é".repeat(2048)))).resolves.toMatch(
      /^[a-f0-9]{64}$/,
    );
    await expect(memoryProjectKey(input("\ud800"))).rejects.toThrow(
      "KIT_DOCUMENT_INVALID_UNICODE",
    );
  });

  it("propagates digest failure instead of returning an identity", async () => {
    const failure = new Error("fixture digest failure");
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockRejectedValueOnce(failure);
    try {
      await expect(
        memoryProjectKey(JSON.stringify(corpus.baseline)),
      ).rejects.toBe(failure);
    } finally {
      digest.mockRestore();
    }
  });
});
