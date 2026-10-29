import type { KitConfig } from "@/modules/workspace-kit/lib/configTypes";

export const trustConfig: KitConfig = {
  kit: "voktty-workspace-kit",
  kitVersion: "1.1.0",
  schema: 1,
  project: "Example",
  language: "en",
  createdAt: "2026-10-29",
  init: "INIT.md",
  capture: {
    onSessionEnd: true,
    beforeCompaction: true,
    compactionThresholdPercent: 80,
    every: { turns: 40, minutes: 0, commits: 10 },
    staleAfterCommits: 20,
  },
  limits: {},
  archive: { dir: "archive", afterDays: 30, ritual: "weekly" },
  runtimeDirs: ["state", "mailbox", "locks", "sessions"],
};
export const trustText =
  "Project instructions\r\n<script>untrusted()</script>\r\nUnicode: ñ\r\n";
export function trustReply(revision = 1) {
  return {
    schema: 1 as const,
    root: "/canonical/project",
    projectKey: "a".repeat(64),
    review: `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    revision,
    config: structuredClone(trustConfig),
    instructions: {
      schema: 1 as const,
      role: null as string | null,
      files: [
        {
          path: ".voktty/INIT.md",
          fact: { kind: "file" as const, text: trustText },
        },
      ],
    },
    fingerprint: {
      schema: 1 as const,
      digest: "b".repeat(64),
      role: null as string | null,
      files: [
        {
          path: ".voktty/INIT.md",
          kind: "file" as const,
          sha256: "c".repeat(64),
        },
      ],
    },
    preference: null,
  };
}
export const trustAccepted = {
  schema: 1 as const,
  preference: {
    projectKey: "a".repeat(64),
    policy: "manual" as const,
    instructionDigest: "b".repeat(64),
  },
};
