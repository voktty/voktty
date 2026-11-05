import type { NativeMemorySelection } from "@/modules/workspace-kit/lib/nativeMemory";
import type { MemoryTransport } from "@/modules/workspace-kit/lib/memoryTransport";
import {
  bindNativeProjectMemoryContext,
  type NativeMemoryContext,
} from "@/modules/workspace-kit/lib/nativeMemoryContext";

type Owner = {
  contextTransport?: () => MemoryTransport;
  checkSelection: (selection: NativeMemorySelection) => void;
  canRequest: () => boolean;
  request: <T>(
    selection: NativeMemorySelection,
    command: string,
    args: Record<string, unknown>,
    check: () => void,
  ) => Promise<T>;
};
function cancelled(): never {
  throw Object.assign(new Error("Memory project binding was retired"), {
    code: "cancelled",
  });
}

export function createNativeProjectContextClient(owner: Owner) {
  let projectBinding: object | null = null;
  return {
    retire() {
      projectBinding = null;
    },
    api: {
      async bindProjectContext(
        selection: NativeMemorySelection,
        context: NativeMemoryContext,
      ): Promise<Readonly<{ root: string }>> {
        owner.checkSelection(selection);
        if (projectBinding || !owner.canRequest())
          throw Object.assign(new Error("Memory requests are busy"), {
            code: "busy",
          });
        const expected = {};
        projectBinding = expected;
        const check = () => {
          owner.checkSelection(selection);
          if (projectBinding !== expected) cancelled();
        };
        let bound = false;
        try {
          const result = await bindNativeProjectMemoryContext(
            context,
            (handle, checkContext) =>
              owner.request<unknown>(
                selection,
                "project_memory_context_bind",
                { context: handle, request: { schema: 2 } },
                () => {
                  check();
                  checkContext();
                },
              ),
            owner.contextTransport,
          );
          bound = true;
          check();
          result.check();
          return Object.freeze({ root: result.root });
        } catch (error) {
          if (bound) await context.close();
          throw error;
        } finally {
          if (projectBinding === expected) projectBinding = null;
        }
      },
    },
  };
}
