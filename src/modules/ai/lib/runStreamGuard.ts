export function guardRunStream<T>(
  source: ReadableStream<T>,
  isCurrent: () => boolean,
  retire: () => void,
  cleanup: () => void,
  settle: () => void = () => {},
): ReadableStream<T> {
  const reader = source.getReader();
  let finished = false;
  let terminal = false;
  let settled = false;
  const settledSource = () => {
    if (settled) return;
    settled = true;
    settle();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
  return new ReadableStream<T>({
    async pull(controller) {
      if (terminal) return;
      try {
        if (!isCurrent()) {
          terminal = true;
          retire();
          finish();
          controller.close();
          try {
            await reader.cancel();
          } catch {
          } finally {
            settledSource();
          }
          return;
        }
        const step = await reader.read();
        if (terminal) return;
        if (!isCurrent()) {
          terminal = true;
          retire();
          finish();
          controller.close();
          try {
            await reader.cancel();
          } catch {
          } finally {
            settledSource();
          }
          return;
        }
        if (step.done) {
          terminal = true;
          finish();
          settledSource();
          controller.close();
        } else controller.enqueue(step.value);
      } catch (error) {
        if (terminal) return;
        terminal = true;
        finish();
        settledSource();
        if (isCurrent()) controller.error(error);
        else {
          retire();
          controller.close();
        }
      }
    },
    async cancel(reason) {
      if (terminal) return;
      terminal = true;
      retire();
      finish();
      try {
        await reader.cancel(reason);
      } finally {
        settledSource();
      }
    },
  });
}
