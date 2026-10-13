import { expect, it } from "vitest";
import { hasEmbeddedChat, registerEmbeddedChat } from "./embeddedChat";

it("releases presentation ownership only for its own current lease", () => {
  const first = registerEmbeddedChat();
  const second = registerEmbeddedChat();
  first();
  expect(hasEmbeddedChat()).toBe(true);
  second();
  expect(hasEmbeddedChat()).toBe(false);
});
