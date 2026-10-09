export function namedWorktreeBranch(fragment: string): string | null {
  const clean = fragment
    .trim()
    .replace(/^(?:mc|monocode)\/+/, "")
    .replace(/^\/+|\/+$/g, "");
  return clean ? `mc/${clean}` : null;
}
