import { expect, it } from "vitest";
import {
  getComposerCommandInput,
  tryRunSlashCommand,
} from "@/modules/ai/lib/slashCommands";

it.each(["/init", "#init", "  /init\n", "#init details"])(
  "%s requests a review of root rules separately from the kit",
  (input) => {
    const result = tryRunSlashCommand(input);
    expect(result.kind).toBe("send-prompt");
    if (result.kind !== "send-prompt") throw new Error("Missing init prompt");
    expect(result.commandName).toBe("init");
    expect(result.prompt).toContain(
      "Read any existing VOKTTY.md, AGENTS.md and CLAUDE.md first",
    );
    expect(result.prompt).toContain(
      "Preserve their user-authored rules and links",
    );
    expect(result.prompt).toContain("ask the user which rule to keep");
    expect(result.prompt).toContain(
      "Do not modify AGENTS.md, CLAUDE.md, skills, or .voktty/",
    );
    expect(result.prompt).toContain(
      "this command does not grant permission to write",
    );
    expect(result.prompt).toContain(
      "edit to update an existing one after reading it",
    );
  },
);

it.each([
  ["notes", ["init"], "#init notes"],
  ["", ["init"], "#init"],
  [" /plan off ", ["init"], "/plan off"],
  [" #custom ", ["init"], "#custom"],
  ["notes", ["plan", "init"], "#plan notes"],
  [" /init ", ["plan"], "/init"],
  ["normal", [], "normal"],
] as const)(
  "resolves %s and %j consistently for help and submission",
  (input, names, expected) => {
    expect(
      getComposerCommandInput(
        input,
        names.map((name) => ({ name })),
      ),
    ).toBe(expected);
  },
);
