// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Expected persistence test fixture value to be present");
  }
  return value;
}

type Admission = ReturnType<typeof useWindowPersistenceAdmission>;
type Authority = ReturnType<typeof createPersistenceAdmission>;

type Props = {
  authority: Authority;
  resume: () => void;
  observe: (admission: Admission) => void;
  value: string;
  write?: (value: string) => void;
};

function Publisher({ authority, resume, observe, value, write }: Props) {
  const admission = useWindowPersistenceAdmission(resume, authority);
  useEffect(() => observe(admission), [observe, admission]);
  useEffect(() => {
    const permit = admission.getOwner()?.capture();
    if (!permit || !write) return;
    const timer = setTimeout(() => {
      void permit.run(() => Promise.resolve(write(value)));
    }, 250);
    return () => clearTimeout(timer);
  }, [admission, value, write]);
  return null;
}

let root: Root;
let host: HTMLDivElement;
let observed: { admission?: Admission };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  observed = {};
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(
  authority: Authority,
  resume: () => void,
  value = "current",
  write?: (value: string) => void,
) {
  await act(async () => {
    root.render(
      <StrictMode>
        <Publisher
          authority={authority}
          resume={resume}
          value={value}
          write={write}
          observe={(admission) => {
            observed.admission = admission;
          }}
        />
      </StrictMode>,
    );
  });
}

describe("effect-owned window persistence", () => {
  it("registers only effect owners and removes the StrictMode discarded owner", async () => {
    const authority = createPersistenceAdmission();
    const create = vi.spyOn(authority, "createOwner");
    const resume = vi.fn();
    await render(authority, resume);
    expect(create).toHaveBeenCalledTimes(2);
    const final = required(
      required(
        required(required(observed.admission).getOwner()).capture(),
      ).seal(),
    );
    await act(async () => final.cancel());
    expect(resume).toHaveBeenCalledOnce();
    expect(required(observed.admission).revision).toBe(1);
  });

  it("keeps the same owner through rerender and calls the current resume handler", async () => {
    const authority = createPersistenceAdmission();
    const initial = vi.fn();
    const current = vi.fn();
    await render(authority, initial);
    const owner = required(observed.admission).getOwner();
    await render(authority, current);
    expect(required(observed.admission).getOwner()).toBe(owner);
    const final = required(required(required(owner).capture()).seal());
    await act(async () => final.cancel());
    expect(initial).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });

  it("retired StrictMode cleanup cannot reopen a replacement final", async () => {
    const authority = createPersistenceAdmission();
    const create = vi.spyOn(authority, "createOwner");
    await render(authority, vi.fn());
    const result = create.mock.results[0];
    if (result.type !== "return") throw new Error("owner not created");
    const retired = result.value;
    const final = required(
      required(
        required(required(observed.admission).getOwner()).capture(),
      ).seal(),
    );
    retired.retire();
    expect(final.isCurrent()).toBe(true);
    expect(retired.capture()).toBeNull();
    await act(async () => root.unmount());
    expect(required(observed.admission).getOwner()).toBeNull();
    expect(final.isCurrent()).toBe(false);
    expect(authority.createOwner().capture()).not.toBeNull();
  });

  it("requeues current state after abort without replaying an old timer permit", async () => {
    const authority = createPersistenceAdmission();
    const write = vi.fn();
    const resume = vi.fn();
    await render(authority, resume, "old", write);
    const stale = required(
      required(required(observed.admission).getOwner()).capture(),
    );
    const final = required(
      required(
        required(required(observed.admission).getOwner()).capture(),
      ).seal(),
    );
    await render(authority, resume, "fresh", write);
    await act(async () => final.cancel());
    expect(await stale.run(() => Promise.resolve(write("old")))).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(write.mock.calls).toEqual([["fresh"]]);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("retries unchanged view state when actual receipt capacity recovers", async () => {
    const authority = createPersistenceAdmission();
    const write = vi.fn();
    const resume = vi.fn();
    await render(authority, resume, "current", write);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const permit = required(authority.createOwner().capture());
    const pending = Array.from({ length: 256 }, () => permit.run(() => gate));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(write).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await Promise.all(pending);
    });
    expect(resume).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(write.mock.calls).toEqual([["current"]]);
  });
});
