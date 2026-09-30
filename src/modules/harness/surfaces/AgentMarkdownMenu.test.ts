import { describe, expect, it } from "vitest";
import { fileLinkMenuItems } from "./AgentMarkdown";

describe("AgentMarkdown file link context menu", () => {
  const dummyT = (key: string) => {
    switch (key) {
      case "harness.chrome.openInVoktty":
        return "Open in Voktty";
      case "harness.chrome.openInDefaultApp":
        return "Open in Default App";
      case "harness.chrome.revealInFinder":
        return "Reveal in Finder";
      case "harness.chrome.revealInFileExplorer":
        return "Reveal in File Explorer";
      case "harness.chrome.openContainingFolder":
        return "Open Containing Folder";
      case "harness.chrome.copyPath":
        return "Copy Path";
      case "harness.chrome.copyRelativePath":
        return "Copy Relative Path";
      default:
        return key;
    }
  };

  it("builds file menu items when open-in-voktty and relative paths are supported", () => {
    const items = fileLinkMenuItems(true, true, dummyT);

    expect(items.some((i) => i.kind === "item" && i.id === "open-voktty" && !i.disabled)).toBe(true);
    expect(items.some((i) => i.kind === "item" && i.id === "open-default")).toBe(true);
    expect(items.some((i) => i.kind === "item" && i.id === "reveal")).toBe(true);
    expect(items.some((i) => i.kind === "item" && i.id === "copy-path")).toBe(true);
    expect(items.some((i) => i.kind === "item" && i.id === "copy-relative-path")).toBe(true);
  });

  it("disables open-in-voktty when file opening is not available", () => {
    const items = fileLinkMenuItems(false, true, dummyT);
    const vokttyItem = items.find((i) => i.kind === "item" && i.id === "open-voktty");
    expect(vokttyItem && vokttyItem.kind === "item" && vokttyItem.disabled).toBe(true);
  });

  it("omits relative path copying when workspace root is not available", () => {
    const items = fileLinkMenuItems(true, false, dummyT);
    expect(items.some((i) => i.kind === "item" && i.id === "copy-relative-path")).toBe(false);
  });
});
