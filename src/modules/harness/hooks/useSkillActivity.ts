import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

let pending = 0;
type Owner = { binding: object; tasks: Map<string, object> };

export function useSkillActivity(context?: unknown) {
  const binding = useMemo(() => ({ context }), [context]);
  const active = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    const owner = { binding, tasks: new Map<string, object>() };
    active.current = owner;
    return () => {
      if (active.current === owner) active.current = null;
    };
  }, [binding]);
  const capture = useCallback(() => {
    const owner = active.current;
    if (owner?.binding !== binding) return;
    return () => active.current === owner;
  }, [binding]);
  const retire = useCallback(
    (channel: string) => {
      if (active.current?.binding === binding)
        active.current.tasks.delete(channel);
    },
    [binding],
  );
  const run = useCallback(
    <T>(
      channel: string,
      task: (assertCurrent: () => void) => Promise<T>,
      publish: (value: T) => void,
      fail: (error: unknown) => void,
    ) => {
      const owner = active.current;
      if (owner?.binding !== binding || owner.tasks.has(channel)) return;
      if (pending >= 256) {
        fail(new Error("Skill activity capacity exceeded."));
        return;
      }
      const token = {};
      owner.tasks.set(channel, token);
      const isCurrent = () =>
        active.current === owner && owner.tasks.get(channel) === token;
      const assertCurrent = () => {
        if (!isCurrent())
          throw new DOMException("Skill activity was retired.", "AbortError");
      };
      pending++;
      let result: Promise<T>;
      try {
        result = task(assertCurrent);
      } catch (error) {
        result = Promise.reject(error);
      }
      void result
        .then((value) => {
          if (isCurrent()) publish(value);
        })
        .catch((error: unknown) => {
          if (isCurrent()) fail(error);
        })
        .finally(() => {
          if (owner.tasks.get(channel) === token) owner.tasks.delete(channel);
          pending--;
        });
    },
    [binding],
  );
  return { capture, retire, run };
}
