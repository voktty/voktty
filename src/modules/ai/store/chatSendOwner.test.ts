import { afterEach, expect, it, vi } from "vitest";
import { getOrCreateChat, sendMessage } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: () => ({
    sendMessages: vi.fn(),
    reconnectToStream: async () => null,
  }),
}));
const initialModel = useChatStore.getState().selectedModelId;
afterEach(() => {
  chats.clear();
  useChatStore.setState({
    activeSessionId: null,
    selectedModelId: initialModel,
  });
  vi.restoreAllMocks();
});
function fixture() {
  const original = getOrCreateChat("original");
  const selected = getOrCreateChat("selected");
  const sendOriginal = vi
    .spyOn(original, "sendMessage")
    .mockResolvedValue(undefined);
  const sendSelected = vi
    .spyOn(selected, "sendMessage")
    .mockResolvedValue(undefined);
  useChatStore.setState({
    activeSessionId: "selected",
    selectedModelId: "ollama-local",
  });
  return { original, selected, sendOriginal, sendSelected };
}

it("sends explicitly owned text through its original Chat instead of the selected one", async () => {
  const { original, sendOriginal, sendSelected } = fixture();
  expect(await sendMessage("fixture", original)).toBe(true);
  expect(sendOriginal).toHaveBeenCalledExactlyOnceWith({ text: "fixture" });
  expect(sendSelected).not.toHaveBeenCalled();
});

it("refuses a retired owner without recreating it or borrowing its replacement", async () => {
  const { original, sendOriginal, sendSelected } = fixture();
  chats.delete("original");
  const replacement = getOrCreateChat("original");
  const sendReplacement = vi
    .spyOn(replacement, "sendMessage")
    .mockResolvedValue(undefined);
  expect(await sendMessage("fixture", original)).toBe(false);
  expect(sendOriginal).not.toHaveBeenCalled();
  expect(sendSelected).not.toHaveBeenCalled();
  expect(sendReplacement).not.toHaveBeenCalled();
  expect(chats.get("original")).toBe(replacement);
});

it("refuses a busy explicit owner", async () => {
  const { original, sendOriginal } = fixture();
  vi.spyOn(original, "status", "get").mockReturnValue("streaming");
  expect(await sendMessage("fixture", original)).toBe(false);
  expect(sendOriginal).not.toHaveBeenCalled();
});
