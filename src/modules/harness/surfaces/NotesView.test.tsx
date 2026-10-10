// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateNotes, type Note, type NoteUpsert } from "../lib/notes";
import { NotesView } from "./NotesView";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "harness.chrome.noteTitle": "Note title",
        "harness.chrome.untitled": "Untitled",
        "harness.chrome.notes": "Notes",
        "harness.chrome.source": "Source",
        "harness.chrome.preview": "Preview",
      })[key] ?? key,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let stored: Note;

beforeEach(() => {
  invalidateNotes();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  stored = {
    id: "note-title-test",
    slug: "plan",
    title: "Plan",
    body: "Keep this text.",
    tags: ["ideas"],
    createdAt: 1,
    updatedAt: 1,
  };
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { note: NoteUpsert }) => {
      if (command === "notes_list") return [{ ...stored }];
      if (command === "notes_upsert") {
        if (!args) throw new Error("Missing note arguments");
        stored = { ...stored, ...args.note, updatedAt: stored.updatedAt + 1 };
        return { ...stored };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(createElement(NotesView, { onClose: vi.fn() })),
  );
}

function typeInto(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Missing input value setter");
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function titleField() {
  const field = container.querySelector<HTMLInputElement>(
    '[aria-label="Note title"]',
  );
  if (!field) throw new Error("Missing note title field");
  return field;
}

it.each([
  {
    title: "Untitled",
    body: "This is the note body.",
    fallback: "This is the note body.",
  },
  {
    title: "Custom title",
    body: "Intro\n# Generated title\nBody",
    fallback: "Generated title",
  },
])("keeps a cleared $title draft until the title field blurs", async (note) => {
  vi.useFakeTimers();
  stored = { ...stored, title: note.title, body: note.body };
  await render();
  const title = titleField();
  act(() => {
    title.focus();
    typeInto(title, "");
  });
  await act(async () => vi.advanceTimersByTime(800));

  expect(document.activeElement).toBe(title);
  expect(title.value).toBe("");
  expect(stored.title).toBe(note.title);

  await act(async () => title.blur());
  expect(title.value).toBe(note.fallback);
  expect(stored.title).toBe(note.fallback);
});

it("autosaves a replacement title without trimming its focused draft", async () => {
  vi.useFakeTimers();
  await render();
  const title = titleField();
  act(() => {
    title.focus();
    typeInto(title, " Replacement title ");
  });
  await act(async () => vi.advanceTimersByTime(400));

  expect(stored.title).toBe("Replacement title");
  expect(title.value).toBe(" Replacement title ");
  await act(async () => title.blur());
  expect(title.value).toBe("Replacement title");
});

it("preserves a cleared title while an earlier body save finishes", async () => {
  vi.useFakeTimers();
  await render();
  const source = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((button) => button.textContent === "Source");
  if (!source) throw new Error("Missing source tab");
  await act(async () => source.click());
  const body = container.querySelector<HTMLTextAreaElement>(
    "textarea.markdown-source-field",
  );
  if (!body) throw new Error("Missing note body field");
  const title = titleField();
  const save = invoke.getMockImplementation();
  if (!save) throw new Error("Missing notes command mock");
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  let holdSave = true;
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_upsert" && holdSave) {
      holdSave = false;
      await saving;
    }
    return save(command, args);
  });

  act(() => {
    typeInto(body, "Updated body.");
    title.focus();
    typeInto(title, "");
  });
  await act(async () => vi.advanceTimersByTime(400));
  expect(invoke).toHaveBeenCalledWith("notes_upsert", {
    note: expect.objectContaining({ body: "Updated body.", title: "Plan" }),
  });

  await act(async () => finishSave());
  expect(document.activeElement).toBe(title);
  expect(title.value).toBe("");

  await act(async () => title.blur());
  expect(title.value).toBe("Updated body.");
  expect(stored.title).toBe("Updated body.");
  expect(stored.body).toBe("Updated body.");
});

it("commits a cleared title when its editor unmounts", async () => {
  await render();
  const title = titleField();
  act(() => {
    title.focus();
    typeInto(title, "");
  });

  await act(async () => {
    root.unmount();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(stored.title).toBe("Keep this text.");
  expect(stored.body).toBe("Keep this text.");
  root = createRoot(container);
});
