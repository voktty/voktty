// @vitest-environment happy-dom

import {
  PooledTranscript,
  TranscriptPool,
  TranscriptPoolOutlet,
} from "@/modules/harness/surfaces/TranscriptPool";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let container: HTMLDivElement;
let root: Root;
let mounts: string[];
let unmounts: string[];
let nextInstance: number;

function Probe({
  id,
  visible,
  parked,
}: {
  id: string;
  visible?: boolean;
  parked?: boolean;
}) {
  const [instance] = useState(() => ++nextInstance);
  useEffect(() => {
    mounts.push(id);
    return () => {
      unmounts.push(id);
    };
  }, [id]);
  return createElement("div", {
    "data-probe": id,
    "data-instance": instance,
    "data-visible": String(visible),
    "data-parked": String(!!parked),
  });
}

function render(pool: TranscriptPool, shown: string | null, onFocus = vi.fn()) {
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        shown
          ? createElement(
              "section",
              { key: shown, "data-pane": shown },
              createElement(
                PooledTranscript,
                { pool, sessionId: shown, onMouseDown: onFocus },
                createElement(Probe, { id: shown, visible: true }),
              ),
            )
          : null,
        createElement(TranscriptPoolOutlet, { pool }),
      ),
    ),
  );
}

function probe(id: string) {
  return document.querySelector<HTMLElement>(`[data-probe="${id}"]`);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mounts = [];
  unmounts = [];
  nextInstance = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("transcript pool", () => {
  it("reuses recent transcripts without remounting them", () => {
    const pool = new TranscriptPool();
    const ids = Array.from({ length: 10 }, (_, index) => `chat-${index}`);
    const instances = new Map<string, string | undefined>();
    for (const id of ids) {
      render(pool, id);
      instances.set(id, probe(id)?.dataset.instance);
    }
    for (const id of ids) {
      render(pool, id);
      expect(probe(id)?.dataset.instance).toBe(instances.get(id));
    }
    expect(mounts).toEqual(ids);
    expect(unmounts).toEqual([]);
  });

  it("shows the transcript inside the pane that hosts it", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    expect(probe("a")?.closest('[data-pane="a"]')).not.toBeNull();
    expect(probe("a")?.dataset.visible).toBe("true");
  });

  it("keeps the snapshot stable when equivalent transcript props are supplied", () => {
    const pool = new TranscriptPool();
    const onFocus = vi.fn();
    render(pool, "a", onFocus);
    const instance = probe("a")?.dataset.instance;
    const snapshot = pool.getSnapshot();
    const changed = vi.fn();
    const unsubscribe = pool.subscribe(changed);
    for (let update = 0; update < 20; update++) render(pool, "a", onFocus);
    expect(changed).not.toHaveBeenCalled();
    expect(pool.getSnapshot()).toBe(snapshot);
    expect(probe("a")?.dataset.instance).toBe(instance);
    unsubscribe();
  });

  it("updates the pane focus callback without remounting", () => {
    const pool = new TranscriptPool();
    const before = vi.fn();
    const after = vi.fn();
    render(pool, "a", before);
    render(pool, "a", after);
    act(() =>
      probe("a")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
    expect(unmounts).toEqual([]);
  });

  it("delivers changed visibility props without remounting", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    const instance = probe("a")?.dataset.instance;
    const entry = pool.getSnapshot()[0];
    if (!entry) throw new Error("Transcript did not enter the pool");
    const host = entry.host;
    if (!host) throw new Error("Active transcript has no host");
    act(() =>
      pool.show("a", host, createElement(Probe, { id: "a", visible: false })),
    );
    expect(probe("a")?.dataset.visible).toBe("false");
    expect(probe("a")?.dataset.instance).toBe(instance);
    expect(unmounts).toEqual([]);
  });

  it("reuses a transcript when the pane is shown again", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    const instance = probe("a")?.dataset.instance;
    render(pool, "b");
    expect(probe("a")).toBeNull();
    expect(unmounts).toEqual([]);
    render(pool, "a");
    expect(probe("a")?.dataset.instance).toBe(instance);
    expect(probe("a")?.closest('[data-pane="a"]')).not.toBeNull();
    expect(mounts).toEqual(["a", "b"]);
  });

  it("marks parked transcripts hidden until a pane shows them again", () => {
    const pool = new TranscriptPool();
    render(pool, "a");
    render(pool, null);
    const parked = pool.getSnapshot()[0];
    expect(parked?.host).toBeNull();
    expect(parked?.element.props).toMatchObject({
      visible: false,
      parked: true,
    });
    render(pool, "a");
    expect(probe("a")?.dataset.parked).toBe("false");
  });

  it("evicts the least recently shown parked transcripts beyond the limit", () => {
    const pool = new TranscriptPool(2);
    for (const id of ["a", "b", "c", "d"]) render(pool, id);
    render(pool, null);
    expect(unmounts).toEqual(["a", "b"]);
    expect(pool.getSnapshot().map((entry) => entry.id)).toEqual(["c", "d"]);
  });

  it("forwards mouse down to the pane", () => {
    const pool = new TranscriptPool();
    const onFocus = vi.fn();
    render(pool, "a", onFocus);
    act(() =>
      probe("a")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale pane trying to park a transcript hosted elsewhere", () => {
    const pool = new TranscriptPool();
    const stale = document.createElement("div");
    const host = document.createElement("div");
    const element = createElement(Probe, { id: "a" });
    pool.show("a", stale, element);
    pool.show("a", host, element);
    pool.park("a", stale);
    expect(pool.getSnapshot()[0]?.host).toBe(host);
    expect(host.childElementCount).toBe(1);
  });

  it("renders in place when no pool is supplied", () => {
    act(() =>
      root.render(
        createElement(
          PooledTranscript,
          { sessionId: "a" },
          createElement(Probe, { id: "a", visible: true }),
        ),
      ),
    );
    expect(probe("a")?.parentElement).toBe(container);
  });
});
