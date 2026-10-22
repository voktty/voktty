// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInitialHarnessSession } from "@/modules/harness/hooks/useInitialHarnessSession";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";

type Open = (id: string, permit: PersistencePermit) => Promise<void>;
type Authority = ReturnType<typeof createPersistenceAdmission>;
let root: Root;
let host: HTMLDivElement;
let owner: PersistenceOwner | null;
function View({
  authority,
  open,
  sessionId,
}: {
  authority: Authority;
  open: Open;
  sessionId?: string;
}) {
  const admission = useWindowPersistenceAdmission(() => {}, authority);
  useInitialHarnessSession(
    sessionId,
    admission.getOwner,
    open,
    admission.revision,
  );
  useEffect(() => {
    owner = admission.getOwner();
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  owner = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(authority: Authority, open: Open, sessionId = "initial") {
  await act(async () =>
    root.render(
      <StrictMode>
        <View authority={authority} open={open} sessionId={sessionId} />
      </StrictMode>,
    ),
  );
}
it("admits the replacement StrictMode owner after the first load retires", async () => {
  const authority = createPersistenceAdmission();
  const open = vi.fn<Open>().mockResolvedValue(undefined);
  await render(authority, open);
  expect(open).toHaveBeenCalledTimes(2);
  expect(open.mock.calls[0][1].isCurrent()).toBe(false);
  expect(open.mock.calls[1][1].isCurrent()).toBe(true);
});
it("does not duplicate initialization when the same owner rerenders", async () => {
  const authority = createPersistenceAdmission();
  const first = vi.fn<Open>().mockResolvedValue(undefined);
  const replacement = vi.fn<Open>().mockResolvedValue(undefined);
  await render(authority, first);
  await render(authority, replacement);
  expect(first).toHaveBeenCalledTimes(2);
  expect(replacement).not.toHaveBeenCalled();
});
it("does not replay an initial load after cancellation of the same owner's close", async () => {
  const authority = createPersistenceAdmission();
  const open = vi.fn<Open>().mockResolvedValue(undefined);
  await render(authority, open);
  const final = owner?.capture()?.seal();
  if (!final) throw new Error("Missing initial-view owner");
  await act(async () => final.cancel());
  await render(authority, open);
  expect(open).toHaveBeenCalledTimes(2);
});

it("retries an initial request denied before it could be admitted", async () => {
  const authority = createPersistenceAdmission();
  const final = authority.createOwner().capture()?.seal();
  if (!final) throw new Error("Missing initial close fixture");
  const open = vi.fn<Open>().mockResolvedValue(undefined);
  await render(authority, open);
  expect(open).not.toHaveBeenCalled();
  await act(async () => final.cancel());
  expect(open).toHaveBeenCalledOnce();
  expect(open.mock.calls[0][1].isCurrent()).toBe(true);
});
