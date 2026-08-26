export type DomSearchMatchInfo = {
  current: number;
  total: number;
};

export type DomSearchController = {
  setQuery: (query: string) => DomSearchMatchInfo;
  findNext: () => DomSearchMatchInfo;
  findPrevious: () => DomSearchMatchInfo;
  clearQuery: () => void;
};

const MARK_CLASS = "voktty-search-match";
const ACTIVE_MARK_CLASS = "voktty-search-active";

export function createDomSearchController(
  container: HTMLElement,
): DomSearchController {
  let marks: HTMLElement[] = [];
  let activeIndex = -1;

  function clearQuery() {
    marks = [];
    activeIndex = -1;
    const existingMarks = container.querySelectorAll(`mark.${MARK_CLASS}`);
    for (const mark of Array.from(existingMarks)) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  function updateActiveMark(newIndex: number): DomSearchMatchInfo {
    if (marks.length === 0) {
      activeIndex = -1;
      return { current: 0, total: 0 };
    }
    if (activeIndex >= 0 && activeIndex < marks.length) {
      const prevEl = marks[activeIndex];
      prevEl.classList.remove(ACTIVE_MARK_CLASS);
      prevEl.style.backgroundColor = "rgba(234, 179, 8, 0.35)";
      prevEl.style.color = "inherit";
    }
    activeIndex = ((newIndex % marks.length) + marks.length) % marks.length;
    const activeEl = marks[activeIndex];
    activeEl.classList.add(ACTIVE_MARK_CLASS);
    activeEl.style.backgroundColor = "#f59e0b";
    activeEl.style.color = "#000000";
    activeEl.scrollIntoView?.({ behavior: "smooth", block: "center" });

    return {
      current: activeIndex + 1,
      total: marks.length,
    };
  }

  function setQuery(query: string): DomSearchMatchInfo {
    clearQuery();
    const q = query.trim();
    if (!q) return { current: 0, total: 0 };

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (
            parent &&
            (parent.tagName === "SCRIPT" ||
              parent.tagName === "STYLE" ||
              parent.classList.contains(MARK_CLASS))
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const textNodes: Text[] = [];
    let currentNode: Node | null = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode as Text);
      currentNode = walker.nextNode();
    }

    const lowerQ = q.toLowerCase();
    const newMarks: HTMLElement[] = [];

    for (const node of textNodes) {
      const text = node.nodeValue || "";
      const lowerText = text.toLowerCase();
      let matchIdx = lowerText.indexOf(lowerQ);
      if (matchIdx === -1) continue;

      let remainingNode: Text = node;
      while (matchIdx !== -1) {
        const targetNode = remainingNode.splitText(matchIdx);
        remainingNode = targetNode.splitText(q.length);

        const mark = document.createElement("mark");
        mark.className = `${MARK_CLASS} rounded-xs px-0.5 transition-colors`;
        mark.style.backgroundColor = "rgba(234, 179, 8, 0.35)";
        mark.style.color = "inherit";
        mark.textContent = targetNode.nodeValue;

        targetNode.parentNode?.replaceChild(mark, targetNode);
        newMarks.push(mark);

        const remLower = (remainingNode.nodeValue || "").toLowerCase();
        matchIdx = remLower.indexOf(lowerQ);
      }
    }

    marks = newMarks;
    return updateActiveMark(0);
  }

  function findNext(): DomSearchMatchInfo {
    if (marks.length === 0) return { current: 0, total: 0 };
    return updateActiveMark(activeIndex + 1);
  }

  function findPrevious(): DomSearchMatchInfo {
    if (marks.length === 0) return { current: 0, total: 0 };
    return updateActiveMark(activeIndex - 1);
  }

  return {
    setQuery,
    findNext,
    findPrevious,
    clearQuery,
  };
}
