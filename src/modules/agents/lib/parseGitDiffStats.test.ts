import { describe, expect, it } from "vitest";
import { parseGitDiffStats } from "./parseGitDiffStats";

describe("parseGitDiffStats", () => {
  it("returns zeros for empty diff", () => {
    const result = parseGitDiffStats("");
    expect(result).toEqual({
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      files: [],
    });
  });

  it("correctly parses multiple modified files with additions and deletions", () => {
    const sampleDiff = `
diff --git a/components/layout/header.php b/components/layout/header.php
index 1234567..89abcdef 100644
--- a/components/layout/header.php
+++ b/components/layout/header.php
@@ -7,2 +7,2 @@
-<!-- Brand Logo & Live Badge -->
+<!-- Brand Logo -->
@@ -23,9 +23,0 @@
-<!-- Telemetry Pill -->
-<div class="hidden lg:flex items-center">
-<span>tag</span>
-</div>
diff --git a/server.php b/server.php
index abcdef1..2345678 100644
--- a/server.php
+++ b/server.php
@@ -10,0 +11,3 @@
+// Added server router
+require_once 'router.php';
+$app->start();
`;

    const result = parseGitDiffStats(sampleDiff);
    expect(result.filesChanged).toBe(2);
    expect(result.additions).toBe(4); // 1 in header.php + 3 in server.php
    expect(result.deletions).toBe(5); // 1 + 4 in header.php

    const header = result.files.find((f) => f.path === "components/layout/header.php");
    expect(header).toBeDefined();
    expect(header?.additions).toBe(1);
    expect(header?.deletions).toBe(5);
    expect(header?.status).toBe("modified");

    const server = result.files.find((f) => f.path === "server.php");
    expect(server).toBeDefined();
    expect(server?.additions).toBe(3);
    expect(server?.deletions).toBe(0);
  });

  it("handles newly created files in diff", () => {
    const newFileDiff = `
diff --git a/new_module.js b/new_module.js
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/new_module.js
@@ -0,0 +1,2 @@
+export const x = 10;
+export const y = 20;
`;
    const result = parseGitDiffStats(newFileDiff);
    expect(result.filesChanged).toBe(1);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
    expect(result.files[0].status).toBe("added");
    expect(result.files[0].path).toBe("new_module.js");
  });
});
