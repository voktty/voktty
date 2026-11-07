import { beforeEach, expect, it } from "vitest";
import { useAutomationsRequest } from "./automationsRequest";

beforeEach(() => useAutomationsRequest.setState({ pending: false }));

it("hands a request to exactly one consumer", () => {
  useAutomationsRequest.getState().request();
  expect(useAutomationsRequest.getState().consume()).toBe(true);
  expect(useAutomationsRequest.getState().consume()).toBe(false);
});

it("keeps a request until a consumer is ready", () => {
  useAutomationsRequest.getState().request();
  expect(useAutomationsRequest.getState().pending).toBe(true);
});
