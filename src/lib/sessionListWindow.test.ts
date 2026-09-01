import { describe, expect, it } from "vitest";
import { SESSION_LIST_PAGE, sessionListWindow } from "./sessionListWindow";

describe("sessionListWindow", () => {
  it("returns 0 for an empty list", () => {
    expect(sessionListWindow(0, SESSION_LIST_PAGE, -1)).toBe(0);
  });

  it("returns the full list when it fits in one page", () => {
    expect(sessionListWindow(8, SESSION_LIST_PAGE, -1)).toBe(8);
  });

  it("caps the first page", () => {
    expect(sessionListWindow(200, SESSION_LIST_PAGE, -1)).toBe(SESSION_LIST_PAGE);
  });

  it("grows as more rows are requested", () => {
    expect(sessionListWindow(200, SESSION_LIST_PAGE * 2, -1)).toBe(
      SESSION_LIST_PAGE * 2,
    );
  });

  it("cannot grow past the list", () => {
    expect(sessionListWindow(40, 200, -1)).toBe(40);
  });

  it("expands far enough to include the active session", () => {
    expect(sessionListWindow(200, SESSION_LIST_PAGE, 80)).toBe(81);
  });
});
