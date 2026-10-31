import type { ToolSet } from "ai";
import {
  bindFileToolRunGuard,
  isFileToolRunCurrent,
} from "@/modules/ai/lib/fileToolApprovals";

export function guardToolRun<Tools extends ToolSet>(
  tools: Tools,
  isCurrent: () => boolean,
): Tools {
  const assertCurrent = (owner?: object) => {
    if (!isCurrent() || (owner && !isFileToolRunCurrent(owner)))
      throw new Error("The original AI tool run has retired.");
  };
  const guardResult = (result: unknown, owner: object): unknown => {
    if (
      result &&
      typeof result === "object" &&
      Symbol.asyncIterator in result &&
      typeof result[Symbol.asyncIterator] === "function"
    ) {
      const iterable = result as AsyncIterable<unknown>;
      return (async function* () {
        assertCurrent(owner);
        const iterator = iterable[Symbol.asyncIterator]();
        let complete = false;
        try {
          while (true) {
            assertCurrent(owner);
            const step = await iterator.next();
            assertCurrent(owner);
            if (step.done) {
              complete = true;
              return;
            }
            yield step.value;
          }
        } finally {
          if (!complete) await iterator.return?.();
        }
      })();
    }
    if (
      result &&
      (typeof result === "object" || typeof result === "function") &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      return Promise.resolve(result).then(
        (value) => {
          assertCurrent(owner);
          return guardResult(value, owner);
        },
        (error) => {
          assertCurrent(owner);
          throw error;
        },
      );
    }
    assertCurrent(owner);
    return result;
  };
  const guard =
    <Args extends unknown[], Result>(
      fn: (...args: Args) => Result,
      owner: object,
    ) =>
    (...args: Args): Result => {
      assertCurrent(owner);
      try {
        return guardResult(fn.apply(owner, args), owner) as Result;
      } catch (error) {
        assertCurrent(owner);
        throw error;
      }
    };
  assertCurrent();
  bindFileToolRunGuard(tools, isCurrent);
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        ...(tool.execute ? { execute: guard(tool.execute, tool) } : {}),
        ...(typeof tool.needsApproval === "function"
          ? { needsApproval: guard(tool.needsApproval, tool) }
          : {}),
        ...(tool.onInputAvailable
          ? { onInputAvailable: guard(tool.onInputAvailable, tool) }
          : {}),
        ...(tool.onInputStart
          ? { onInputStart: guard(tool.onInputStart, tool) }
          : {}),
        ...(tool.onInputDelta
          ? { onInputDelta: guard(tool.onInputDelta, tool) }
          : {}),
      },
    ]),
  ) as Tools;
}
