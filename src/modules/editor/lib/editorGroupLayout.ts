export type EditorGroupDirection = "row" | "col";

export type EditorGroupNode =
  | { kind: "leaf"; groupId: number; tabId: number | null }
  | {
      kind: "split";
      direction: EditorGroupDirection;
      children: [EditorGroupNode, EditorGroupNode];
    };

export type EditorGroupLayout = {
  tree: EditorGroupNode;
  activeGroupId: number;
};

export function createEditorGroupLayout(groupId: number): EditorGroupLayout {
  return {
    tree: { kind: "leaf", groupId, tabId: null },
    activeGroupId: groupId,
  };
}

export function editorGroupLeaves(
  node: EditorGroupNode,
): Array<{ groupId: number; tabId: number | null }> {
  if (node.kind === "leaf") {
    return [{ groupId: node.groupId, tabId: node.tabId }];
  }
  return node.children.flatMap(editorGroupLeaves);
}

function mapLeaves(
  node: EditorGroupNode,
  map: (leaf: Extract<EditorGroupNode, { kind: "leaf" }>) => EditorGroupNode,
): EditorGroupNode {
  if (node.kind === "leaf") return map(node);
  return {
    ...node,
    children: node.children.map((child) => mapLeaves(child, map)) as [
      EditorGroupNode,
      EditorGroupNode,
    ],
  };
}

export function activateEditorInLayout(
  layout: EditorGroupLayout,
  tabId: number,
): EditorGroupLayout {
  const leaves = editorGroupLeaves(layout.tree);
  if (
    leaves.find((leaf) => leaf.groupId === layout.activeGroupId)?.tabId ===
      tabId &&
    leaves.every(
      (leaf) => leaf.groupId === layout.activeGroupId || leaf.tabId !== tabId,
    )
  ) {
    return layout;
  }
  return {
    ...layout,
    tree: mapLeaves(layout.tree, (leaf) => ({
      ...leaf,
      tabId:
        leaf.groupId === layout.activeGroupId
          ? tabId
          : leaf.tabId === tabId
            ? null
            : leaf.tabId,
    })),
  };
}

export function retainEditorsInLayout(
  layout: EditorGroupLayout,
  liveTabIds: ReadonlySet<number>,
): EditorGroupLayout {
  let changed = false;
  const tree = mapLeaves(layout.tree, (leaf) => {
    if (leaf.tabId === null || liveTabIds.has(leaf.tabId)) return leaf;
    changed = true;
    return { ...leaf, tabId: null };
  });
  return changed ? { ...layout, tree } : layout;
}

export function focusEditorGroup(
  layout: EditorGroupLayout,
  groupId: number,
): EditorGroupLayout {
  if (layout.activeGroupId === groupId) return layout;
  return editorGroupLeaves(layout.tree).some((leaf) => leaf.groupId === groupId)
    ? { ...layout, activeGroupId: groupId }
    : layout;
}

function splitLeaf(
  node: EditorGroupNode,
  target: number,
  direction: EditorGroupDirection,
  groupId: number,
): EditorGroupNode {
  if (node.kind === "leaf") {
    if (node.groupId !== target) return node;
    return {
      kind: "split",
      direction,
      children: [node, { kind: "leaf", groupId, tabId: null }],
    };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      splitLeaf(child, target, direction, groupId),
    ) as [EditorGroupNode, EditorGroupNode],
  };
}

export function splitEditorGroup(
  layout: EditorGroupLayout,
  direction: EditorGroupDirection,
  groupId: number,
): EditorGroupLayout {
  if (editorGroupLeaves(layout.tree).some((leaf) => leaf.groupId === groupId)) {
    return layout;
  }
  return {
    tree: splitLeaf(layout.tree, layout.activeGroupId, direction, groupId),
    activeGroupId: groupId,
  };
}

function removeGroup(
  node: EditorGroupNode,
  groupId: number,
): EditorGroupNode | null {
  if (node.kind === "leaf") return node.groupId === groupId ? null : node;
  const left = removeGroup(node.children[0], groupId);
  const right = removeGroup(node.children[1], groupId);
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

export function closeEditorGroup(
  layout: EditorGroupLayout,
  groupId: number,
): EditorGroupLayout {
  const leaves = editorGroupLeaves(layout.tree);
  if (leaves.length === 1) return layout;
  const tree = removeGroup(layout.tree, groupId);
  if (!tree) return layout;
  const remaining = editorGroupLeaves(tree);
  return {
    tree,
    activeGroupId:
      layout.activeGroupId === groupId
        ? remaining[0].groupId
        : layout.activeGroupId,
  };
}
