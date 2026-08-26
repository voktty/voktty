import { describe, expect, it } from "vitest";
import { resolveCurrentSymbol } from "./symbolResolver";

describe("resolveCurrentSymbol", () => {
  it("resolves TypeScript function and class definitions", () => {
    const code = `
export class AgentController {
  private id: string;

  constructor() {
    this.id = "1";
  }

  async runTask() {
    const x = 10;
    return x;
  }
}
`;
    expect(resolveCurrentSymbol(code, 2)).toEqual({
      name: "AgentController",
      kind: "class",
      line: 2,
    });
    expect(resolveCurrentSymbol(code, 10)).toEqual({
      name: "runTask",
      kind: "function",
      line: 9,
    });
  });

  it("resolves Rust function and struct definitions", () => {
    const rust = `
pub struct SessionState {
    id: u32,
}

impl SessionState {
    pub async fn process_event(&self) -> bool {
        let active = true;
        active
    }
}
`;
    expect(resolveCurrentSymbol(rust, 2)).toEqual({
      name: "SessionState",
      kind: "struct",
      line: 2,
    });
    expect(resolveCurrentSymbol(rust, 8)).toEqual({
      name: "process_event",
      kind: "function",
      line: 7,
    });
  });

  it("resolves Python def and class definitions", () => {
    const py = `
class NeuralNetwork:
    def __init__(self):
        self.weights = []

    async def forward(self, x):
        return x * 2
`;
    expect(resolveCurrentSymbol(py, 2)).toEqual({
      name: "NeuralNetwork",
      kind: "class",
      line: 2,
    });
    expect(resolveCurrentSymbol(py, 7)).toEqual({
      name: "forward",
      kind: "function",
      line: 6,
    });
  });

  it("resolves Markdown headings", () => {
    const md = `
# Project Overview
Some intro text

## Architecture
Details here
`;
    expect(resolveCurrentSymbol(md, 3)).toEqual({
      name: "Project Overview",
      kind: "heading",
      line: 2,
    });
    expect(resolveCurrentSymbol(md, 6)).toEqual({
      name: "Architecture",
      kind: "heading",
      line: 5,
    });
  });

  it("returns null for empty or out-of-range lines", () => {
    expect(resolveCurrentSymbol("", 1)).toBeNull();
    expect(resolveCurrentSymbol("const a = 1;", 0)).toBeNull();
  });
});
