import type { UIMessage } from "ai";

const MAX_CHARACTERS = 16 * 1024 * 1024;
const MAX_ENTRIES = 65_536;
const MAX_SNAPSHOTS = 32;
let heldCharacters = 0;
let heldEntries = 0;
let heldSnapshots = 0;

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export function captureAiMessageSnapshot(messages: UIMessage[]) {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [messages];
  let characters = 0;
  let entries = 0;
  const checkSize = () => {
    if (characters > MAX_CHARACTERS || entries > MAX_ENTRIES)
      fail(
        "KIT_MEMORY_HISTORY_TOO_LARGE",
        "Project memory history exceeds snapshot limits. Start a new conversation.",
      );
  };
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") {
      characters += value.length;
      checkSize();
      continue;
    }
    if (typeof value === "function" || typeof value === "symbol")
      fail(
        "KIT_MEMORY_HISTORY_UNSUPPORTED",
        "Project memory requires data-only message history.",
      );
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== Array.prototype &&
      prototype !== null
    )
      fail(
        "KIT_MEMORY_HISTORY_UNSUPPORTED",
        "Project memory requires data-only message history.",
      );
    seen.add(value);
    if (Array.isArray(value) && value.length > MAX_ENTRIES)
      fail(
        "KIT_MEMORY_HISTORY_TOO_LARGE",
        "Project memory history exceeds snapshot limits. Start a new conversation.",
      );
    for (const key in value) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (!("value" in descriptor))
        fail(
          "KIT_MEMORY_HISTORY_UNSUPPORTED",
          "Project memory requires data-only message history.",
        );
      entries += 1;
      characters += key.length;
      checkSize();
      stack.push(descriptor.value);
    }
  }
  if (
    heldSnapshots >= MAX_SNAPSHOTS ||
    heldCharacters + characters > MAX_CHARACTERS ||
    heldEntries + entries > MAX_ENTRIES
  )
    fail(
      "KIT_MEMORY_HISTORY_BUSY",
      "Too much AI message history is still in use. Wait for earlier requests to settle.",
    );
  heldSnapshots += 1;
  heldCharacters += characters;
  heldEntries += entries;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    heldSnapshots -= 1;
    heldCharacters -= characters;
    heldEntries -= entries;
  };
  try {
    return { messages: structuredClone(messages), release };
  } catch (error) {
    release();
    throw error;
  }
}
