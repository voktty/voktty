import { describe, expect, it } from "vitest";
import { tmuxAttachCommand } from "./tmux";

describe("tmuxAttachCommand", () => {
  it("attaches to the agent's window", () => {
    expect(tmuxAttachCommand("forgenex:@11.%11")).toBe("tmux attach-session -t 'forgenex:@11'");
    expect(tmuxAttachCommand("work_1:@3")).toBe("tmux attach-session -t 'work_1:@3'");
  });

  it("refuses anything that could break out of the quotes", () => {
    expect(tmuxAttachCommand("x';rm -rf ~;':@1")).toBeNull();
    expect(tmuxAttachCommand("x:@1;reboot")).toBeNull();
    expect(tmuxAttachCommand("")).toBeNull();
  });
});
