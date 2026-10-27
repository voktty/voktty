import { applyFileMentionsToTurn } from "./fileMentions";
import { applyNotesToTurn } from "./notes";
import {
  applySkillsToTurn,
  type SkillCatalogContext,
  warmPiSkills,
} from "./skills";

export async function preparePrompt(
  text: string,
  context: SkillCatalogContext,
  assertCurrent: () => void = () => {},
): Promise<string> {
  const captured = { harness: context.harness, cwd: context.cwd };
  assertCurrent();
  warmPiSkills(captured);
  assertCurrent();
  const withFiles = await applyFileMentionsToTurn(
    text,
    captured.cwd,
    assertCurrent,
  );
  assertCurrent();
  const withNotes = await applyNotesToTurn(withFiles);
  assertCurrent();
  const prepared = await applySkillsToTurn(withNotes, captured, assertCurrent);
  assertCurrent();
  return prepared;
}
