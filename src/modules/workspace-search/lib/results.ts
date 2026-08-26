import type {
  WorkspaceSearchFileGroup,
  WorkspaceSearchHit,
} from "@/modules/workspace-search/types";

export function groupWorkspaceSearchHits(
  hits: WorkspaceSearchHit[],
): WorkspaceSearchFileGroup[] {
  const groups = new Map<string, WorkspaceSearchFileGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.path);
    if (group) {
      group.hits.push(hit);
    } else {
      groups.set(hit.path, { path: hit.path, rel: hit.rel, hits: [hit] });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      hits: [...group.hits].sort(
        (left, right) => left.line - right.line || left.column - right.column,
      ),
    }))
    .sort((left, right) => left.rel.localeCompare(right.rel));
}

export function workspaceSearchHitKey(hit: WorkspaceSearchHit): string {
  return `${hit.path}:${hit.line}:${hit.column}`;
}

export function splitSearchHitText(hit: WorkspaceSearchHit): {
  before: string;
  match: string;
  after: string;
} {
  const start = Math.max(0, hit.previewColumn - 1);
  const end = Math.max(start, start + hit.matchLength);
  const before = hit.text.slice(0, start);
  const after = hit.text.slice(end);
  const beforeCharacters = [...before];
  const afterCharacters = [...after];
  return {
    before:
      beforeCharacters.length > 28
        ? `...${beforeCharacters.slice(-28).join("")}`
        : before,
    match: hit.text.slice(start, end),
    after:
      afterCharacters.length > 160
        ? `${afterCharacters.slice(0, 160).join("")}...`
        : after,
  };
}
