import { describe, expect, it } from "vitest";
import { isWebPreviewablePath } from "./LivePreviewButton";

describe("isWebPreviewablePath", () => {
  it.each(["index.html", "INDEX.HTM", "public/index.php", "icons/logo.svg"])(
    "shows live preview for %s",
    (path) => {
      expect(isWebPreviewablePath(path)).toBe(true);
    },
  );

  it.each(["src/app.tsx", "styles.css", "server.js", "README.md"])(
    "hides live preview for %s",
    (path) => {
      expect(isWebPreviewablePath(path)).toBe(false);
    },
  );
});
