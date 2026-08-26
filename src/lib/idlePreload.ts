/**
 * Staggered idle preloader for heavy non-critical application surfaces
 * (AI Sidebar, Editor, Git Graph, Markdown Preview).
 *
 * Runs only when the CPU / browser is idle after initial shell mount,
 * ensuring initial startup remains ultra-fast while subsequent user
 * interactions (like Ctrl+I) open instantaneously from bytecode cache.
 */

let idlePreloadStarted = false;

function scheduleIdle(callback: () => void, timeoutMs: number): void {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: timeoutMs });
  } else {
    setTimeout(callback, Math.min(timeoutMs, 1000));
  }
}

export function startIdlePreload(): void {
  if (idlePreloadStarted || typeof window === "undefined") return;
  idlePreloadStarted = true;

  // Step 1: Preload AI subsystem (Highest interaction frequency)
  scheduleIdle(() => {
    void import("@/modules/ai/components/AiSidebarPanel");
    void import("@/modules/ai/components/AiMiniWindow");
    void import("@/modules/ai/store/chatRuntime");
  }, 1200);

  // Step 2: Preload Editor and Diff stacks
  scheduleIdle(() => {
    void import("@/modules/editor/EditorStack");
    void import("@/modules/editor/GitDiffStack");
    void import("@/modules/editor/AiDiffStack");
  }, 2500);

  // Step 3: Preload Git History and Markdown preview
  scheduleIdle(() => {
    void import("@/modules/git-history/GitHistoryStack");
    void import("@/modules/markdown/MarkdownPreviewPane");
    void import("@/modules/source-control/SourceControlPanel");
  }, 4000);
}
