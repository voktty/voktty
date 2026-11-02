import { expect, it } from "vitest";
import { remoteMemoryError } from "@/modules/workspace-kit/lib/remoteMemoryWire";
import { memoryStorageDiagnostic } from "@/modules/workspace-kit/lib/memoryStorageDiagnostic";

it("preserves only bounded storage metadata across the SSH error adapter", () => {
  const failure = remoteMemoryError({
    code: "denied",
    storage: {
      stage: "application-parent",
      windowsError: null,
      privatePath: "private data",
    },
  });
  expect(memoryStorageDiagnostic(failure)).toBe("application-parent");
  expect((failure as Error & { storage: unknown }).storage).toEqual({
    stage: "application-parent",
    windowsError: null,
  });
  expect(failure.message).not.toContain("private data");
  expect(
    memoryStorageDiagnostic(remoteMemoryError({ code: "denied" })),
  ).toBeUndefined();
  expect(
    memoryStorageDiagnostic(
      remoteMemoryError({
        code: "denied",
        storage: { stage: "arbitrary private data" },
      }),
    ),
  ).toBeUndefined();
});
