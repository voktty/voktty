import { describe, expect, it } from "vitest";
import { formatShellIntent, inferShellIntent } from "./shellIntent";

describe("inferShellIntent", () => {
  it("reads a file from cat / head / sed -n", () => {
    expect(inferShellIntent("cat package.json")).toEqual({
      verb: "Read",
      path: "package.json",
    });
    expect(
      inferShellIntent(
        'cd /Users/nikolaypetkov/code/agent-terminal && ls && echo "---" && cat package.json | head -60',
      ),
    ).toEqual({ verb: "Read", path: "package.json" });
    expect(
      inferShellIntent(
        "ls src/lib/harness/ && echo \"=== preview ===\" && sed -n '1,140p' src/lib/harness/preview.ts",
      ),
    ).toEqual({
      verb: "Read",
      path: "src/lib/harness/preview.ts",
      startLine: 1,
    });
    expect(
      inferShellIntent("sed -n '713,1200p' src/surfaces/AgentTranscript.tsx"),
    ).toEqual({
      verb: "Read",
      path: "src/surfaces/AgentTranscript.tsx",
      startLine: 713,
    });
  });

  it("treats grep / rg as Find", () => {
    expect(
      inferShellIntent(
        'grep -n "^function \\|^const .* = memo" src/surfaces/AgentTranscript.tsx',
      ),
    ).toEqual({
      verb: "Find",
      query: "^function |^const .* = memo",
      path: "src/surfaces/AgentTranscript.tsx",
    });
    expect(inferShellIntent("rg -n isReadTool src/lib/harness")).toEqual({
      verb: "Find",
      query: "isReadTool",
      path: "src/lib/harness",
    });
    expect(inferShellIntent("find src -name '*.ts'")).toEqual({
      verb: "Find",
      query: "*.ts",
      path: "src",
    });
  });

  it("lists a directory when that is all the command does", () => {
    expect(inferShellIntent("ls src/lib/harness/")).toEqual({
      verb: "List",
      path: "src/lib/harness",
    });
    expect(inferShellIntent("ls -la")).toBeUndefined();
  });

  it("leaves real shell as the command", () => {
    expect(inferShellIntent("git status -s")).toBeUndefined();
    expect(inferShellIntent("git diff src/surfaces/AgentTranscript.tsx")).toBeUndefined();
    expect(inferShellIntent("npm test")).toBeUndefined();
    expect(inferShellIntent("cat file && python script.py")).toBeUndefined();
    expect(inferShellIntent("cat $(echo foo)")).toBeUndefined();
    expect(inferShellIntent("python3 - <<'PY'")).toBeUndefined();
    expect(inferShellIntent("rm src/hooks/useActivityTicker.ts && python3 - <<'PY'")).toBeUndefined();
  });

  it("treats file-mutating bash as Edit / Write", () => {
    expect(inferShellIntent("sed -i 's/a/b/' src/app.ts")).toEqual({
      verb: "Edit",
      path: "src/app.ts",
    });
    expect(
      inferShellIntent(
        "sed -i '' 's/zen-ticker-live/zen-tool-spin/' src/surfaces/AgentTranscript.tsx",
      ),
    ).toEqual({
      verb: "Edit",
      path: "src/surfaces/AgentTranscript.tsx",
    });
    expect(
      inferShellIntent("cat >> src/surfaces/transcriptActivity.ts <<'TS'"),
    ).toEqual({
      verb: "Edit",
      path: "src/surfaces/transcriptActivity.ts",
    });
    expect(inferShellIntent("cat package.json > out.json")).toEqual({
      verb: "Write",
      path: "out.json",
    });
    expect(inferShellIntent("tee src/index.css")).toEqual({
      verb: "Write",
      path: "src/index.css",
    });
  });

  it("does not hang on fd redirects like 2>&1", () => {
    expect(inferShellIntent("grep foo src/app.ts 2>&1")).toEqual({
      verb: "Find",
      query: "foo",
      path: "src/app.ts",
    });
    expect(inferShellIntent("cat package.json 2>&1")).toEqual({
      verb: "Read",
      path: "package.json",
    });
    expect(inferShellIntent("git status 2>&1")).toBeUndefined();
    expect(inferShellIntent("grep foo src/app.ts 2>/dev/null")).toEqual({
      verb: "Find",
      query: "foo",
      path: "src/app.ts",
    });
  });

  it("skips already-labelled rows and huge scripts", () => {
    expect(inferShellIntent("Read src/lib/appearance.ts")).toBeUndefined();
    expect(inferShellIntent(`cat ${"a".repeat(3000)}.ts`)).toBeUndefined();
  });
});

describe("formatShellIntent", () => {
  it("prefers a display path passed in from the transcript", () => {
    expect(
      formatShellIntent(
        { verb: "Read", path: "/Users/me/proj/src/app.ts" },
        "src/app.ts",
      ),
    ).toBe("Read src/app.ts");
  });
});
