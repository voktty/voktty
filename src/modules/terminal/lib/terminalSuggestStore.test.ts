import { beforeEach, describe, expect, it } from "vitest";
import {
  extractCurrentPromptInput,
  useTerminalSuggestStore,
} from "./terminalSuggestStore";

describe("extractCurrentPromptInput", () => {
  it("extracts input after Starship / modern prompt delimiters", () => {
    const line = "terax-ai on main via v22.23.2 took 11s ❯ agy -c";
    expect(extractCurrentPromptInput(line)).toBe("agy -c");
  });

  it("extracts input up to cursor position", () => {
    const line = "terax-ai on main via v22.23.2 ❯ git status";
    // cursor at 'git '
    expect(extractCurrentPromptInput(line, 36)).toBe("git ");
  });

  it("handles PowerShell prompt format", () => {
    const line = "PS C:\\proyectos\\terax-ai> cargo check";
    expect(extractCurrentPromptInput(line)).toBe("cargo check");
  });

  it("handles standard Unix prompt ($ and #)", () => {
    expect(extractCurrentPromptInput("user@host:~$ npm run dev")).toBe(
      "npm run dev",
    );
    expect(extractCurrentPromptInput("root@container:/app# docker ps")).toBe(
      "docker ps",
    );
  });

  it("handles empty line and prompt with no input", () => {
    expect(extractCurrentPromptInput("❯ ")).toBe("");
    expect(extractCurrentPromptInput("")).toBe("");
  });
});

describe("useTerminalSuggestStore", () => {
  beforeEach(() => {
    useTerminalSuggestStore.getState().clear();
  });

  it("stores suggestions and handles cycling", () => {
    const store = useTerminalSuggestStore.getState();
    store.setSuggest({
      leafId: 1,
      open: true,
      query: "git ",
      items: ["git push origin main", "git pull", "git status"],
      selectedIndex: 0,
      navigated: false,
      ghostTail: "push origin main",
      cursorX: 5,
      cursorY: 10,
      cellWidth: 8,
      cellHeight: 18,
      lineX: 40,
      lineY: 198,
      containerWidth: 800,
      containerHeight: 600,
    });

    let s = useTerminalSuggestStore.getState().getSuggest(1);
    expect(s?.open).toBe(true);
    expect(s?.selectedIndex).toBe(0);
    expect(s?.ghostTail).toBe("push origin main");

    // Select next
    store.selectNext(1);
    s = useTerminalSuggestStore.getState().getSuggest(1);
    expect(s?.selectedIndex).toBe(1);
    expect(s?.navigated).toBe(true);
    expect(s?.ghostTail).toBe("pull");

    // Select prev
    store.selectPrev(1);
    s = useTerminalSuggestStore.getState().getSuggest(1);
    expect(s?.selectedIndex).toBe(0);
    expect(s?.ghostTail).toBe("push origin main");

    // Clear
    store.clear(1);
    expect(useTerminalSuggestStore.getState().getSuggest(1)).toBeUndefined();
  });

  it("supports toggleSearch and filtering", () => {
    const store = useTerminalSuggestStore.getState();
    store.setSuggest({
      leafId: 2,
      open: true,
      query: "cd ",
      items: ["cd pepe", "cd /home/juan_peres", "cd /var/log"],
      selectedIndex: 0,
      navigated: false,
      ghostTail: "pepe",
      cursorX: 3,
      cursorY: 5,
      cellWidth: 8,
      cellHeight: 18,
      lineX: 24,
      lineY: 108,
      containerWidth: 800,
      containerHeight: 600,
    });

    store.toggleSearch(2, true);
    let s = useTerminalSuggestStore.getState().getSuggest(2);
    expect(s?.searchMode).toBe(true);

    store.setSearchFilter(2, "juan_peres");
    s = useTerminalSuggestStore.getState().getSuggest(2);
    expect(s?.items).toEqual(["cd /home/juan_peres"]);
    expect(s?.selectedIndex).toBe(0);
    expect(s?.navigated).toBe(true);
  });
});
