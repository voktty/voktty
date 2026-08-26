import { describe, expect, it } from "vitest";
import { createDomSearchController } from "./domSearch";

class MockTextNode {
  nodeType = 3;
  parentNode: MockElement | null = null;
  parentElement: MockElement | null = null;
  constructor(public nodeValue: string) {}

  splitText(offset: number): MockTextNode {
    const remainingText = this.nodeValue.slice(offset);
    this.nodeValue = this.nodeValue.slice(0, offset);
    const newNode = new MockTextNode(remainingText);
    newNode.parentNode = this.parentNode;
    newNode.parentElement = this.parentElement;
    if (this.parentNode) {
      const idx = this.parentNode.childNodes.indexOf(this);
      if (idx !== -1) {
        this.parentNode.childNodes.splice(idx + 1, 0, newNode);
      }
    }
    return newNode;
  }
}

class MockElement {
  nodeType = 1;
  tagName = "DIV";
  className = "";
  childNodes: (MockElement | MockTextNode)[] = [];
  parentNode: MockElement | null = null;
  parentElement: MockElement | null = null;
  classList = {
    contains: (cls: string) => this.className.includes(cls),
    add: (cls: string) => {
      if (!this.className.includes(cls)) this.className += ` ${cls}`;
    },
    remove: (cls: string) => {
      this.className = this.className.replace(cls, "").trim();
    },
  };
  style: Record<string, string> = {};

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent(): string {
    return this.childNodes
      .map((c) => (c instanceof MockTextNode ? c.nodeValue : c.textContent))
      .join("");
  }

  set textContent(val: string) {
    this.childNodes = [new MockTextNode(val)];
    this.childNodes[0].parentNode = this;
    this.childNodes[0].parentElement = this;
  }

  insertBefore(newNode: MockElement | MockTextNode, refNode: MockElement | MockTextNode | null) {
    newNode.parentNode = this;
    newNode.parentElement = this;
    const idx = refNode ? this.childNodes.indexOf(refNode) : -1;
    if (idx !== -1) {
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.childNodes.push(newNode);
    }
  }

  removeChild(child: MockElement | MockTextNode) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
    }
  }

  replaceChild(newChild: MockElement | MockTextNode, oldChild: MockElement | MockTextNode) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      this.childNodes[idx] = newChild;
      newChild.parentNode = this;
      newChild.parentElement = this;
      oldChild.parentNode = null;
      oldChild.parentElement = null;
    }
  }

  normalize() {
    const combined: (MockElement | MockTextNode)[] = [];
    for (const child of this.childNodes) {
      const prev = combined[combined.length - 1];
      if (child instanceof MockTextNode && prev instanceof MockTextNode) {
        prev.nodeValue += child.nodeValue;
      } else {
        combined.push(child);
      }
    }
    this.childNodes = combined;
  }

  querySelectorAll(selector: string): MockElement[] {
    const result: MockElement[] = [];
    const find = (el: MockElement) => {
      for (const child of el.childNodes) {
        if (child instanceof MockElement) {
          if (selector.includes("mark.voktty-search-match") && child.className.includes("voktty-search-match")) {
            result.push(child);
          }
          find(child);
        }
      }
    };
    find(this);
    return result;
  }
}

describe("createDomSearchController", () => {
  it("finds, highlights and navigates text in mock DOM", () => {
    // Setup minimal global document mock
    const origDocument = globalThis.document;
    const origNodeFilter = (globalThis as any).NodeFilter;
    (globalThis as any).NodeFilter = {
      SHOW_TEXT: 4,
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
    };

    (globalThis as any).document = {
      createElement: (tag: string) => {
        const el = new MockElement();
        el.tagName = tag.toUpperCase();
        return el;
      },
      createTreeWalker: (root: MockElement, _whatToShow: number, filter?: { acceptNode: (n: any) => number }) => {
        const nodes: (MockElement | MockTextNode)[] = [];
        const collect = (el: MockElement) => {
          for (const c of el.childNodes) {
            if (c instanceof MockTextNode) {
              if (!filter || filter.acceptNode(c) === 1) {
                nodes.push(c);
              }
            } else if (c instanceof MockElement) {
              collect(c);
            }
          }
        };
        collect(root);
        let idx = -1;
        return {
          nextNode: () => {
            idx++;
            return nodes[idx] || null;
          },
        };
      },
    };

    try {
      const container = new MockElement();
      const p = new MockElement();
      p.tagName = "P";
      p.parentNode = container;
      p.parentElement = container;
      const textNode = new MockTextNode("Hello world! Hello everyone. This is a hello test.");
      textNode.parentNode = p;
      textNode.parentElement = p;
      p.childNodes.push(textNode);
      container.childNodes.push(p);

      const searcher = createDomSearchController(container as unknown as HTMLElement);

      const result = searcher.setQuery("hello");
      expect(result).toEqual({ current: 1, total: 3 });
      expect(container.querySelectorAll("mark.voktty-search-match").length).toBe(3);

      const next = searcher.findNext();
      expect(next).toEqual({ current: 2, total: 3 });

      const prev = searcher.findPrevious();
      expect(prev).toEqual({ current: 1, total: 3 });

      searcher.clearQuery();
      expect(container.querySelectorAll("mark.voktty-search-match").length).toBe(0);
      expect(container.textContent).toContain("Hello world! Hello everyone.");
    } finally {
      globalThis.document = origDocument;
      globalThis.NodeFilter = origNodeFilter;
    }
  });

  it("handles empty or not found queries gracefully", () => {
    const origDocument = globalThis.document;
    const origNodeFilter = (globalThis as any).NodeFilter;
    (globalThis as any).NodeFilter = {
      SHOW_TEXT: 4,
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
    };

    (globalThis as any).document = {
      createElement: (tag: string) => {
        const el = new MockElement();
        el.tagName = tag.toUpperCase();
        return el;
      },
      createTreeWalker: (root: MockElement) => {
        const nodes: (MockElement | MockTextNode)[] = [];
        const collect = (el: MockElement) => {
          for (const c of el.childNodes) {
            if (c instanceof MockTextNode) nodes.push(c);
            else if (c instanceof MockElement) collect(c);
          }
        };
        collect(root);
        let idx = -1;
        return {
          nextNode: () => {
            idx++;
            return nodes[idx] || null;
          },
        };
      },
    };

    try {
      const container = new MockElement();
      const p = new MockElement();
      p.tagName = "P";
      p.parentNode = container;
      p.parentElement = container;
      const textNode = new MockTextNode("Some random content here.");
      textNode.parentNode = p;
      textNode.parentElement = p;
      p.childNodes.push(textNode);
      container.childNodes.push(p);

      const searcher = createDomSearchController(container as unknown as HTMLElement);
      expect(searcher.setQuery("nonexistent")).toEqual({ current: 0, total: 0 });
      expect(searcher.setQuery("")).toEqual({ current: 0, total: 0 });
    } finally {
      globalThis.document = origDocument;
      globalThis.NodeFilter = origNodeFilter;
    }
  });
});
