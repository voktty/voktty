import { writeChild } from "./child";
import { parseJsonLine, parseRpcResponse, stringField } from "./piProtocol";

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

/**
 * JSONL request/response multiplexer for `pi --mode rpc` and the identical
 * `omp --mode rpc`. Agent events and extension UI frames go to `onFrame`.
 */
export class PiRpc {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  private readonly writer: (line: string) => Promise<void>;

  constructor(
    private readonly sessionId: string,
    private readonly onFrame: (rec: Record<string, unknown>) => void,
    private readonly label = "Pi",
    writer?: (line: string) => Promise<void>,
  ) {
    this.writer = writer ?? ((line) => writeChild(this.sessionId, line));
  }

  pushLine(line: string) {
    const rec = parseJsonLine(line);
    if (!rec) return;
    const response = parseRpcResponse(rec);
    if (response?.id && this.pending.has(response.id)) {
      const pending = this.pending.get(response.id);
      this.pending.delete(response.id);
      if (!pending) return;
      if (!response.success) {
        pending.reject(
          new Error(
            response.error || `${this.label} ${response.command} failed`,
          ),
        );
        return;
      }
      pending.resolve(rec);
      return;
    }
    this.onFrame(rec);
  }

  async request(
    command: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error(`${this.label} process is not running`);
    const id = stringField(command, "id") ?? `mc_${this.nextId++}`;
    if (this.pending.has(id))
      throw new Error(`Duplicate RPC request id: ${id}`);
    const payload = { ...command, id };
    let captured!: Pending;
    const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.get(id) !== captured) return;
        this.pending.delete(id);
        const type = stringField(command, "type") ?? "command";
        reject(new Error(`${this.label} ${type} timed out`));
      }, timeoutMs);
      captured = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending.set(id, captured);
    });
    void pending.catch(() => undefined);
    const failed = (error: unknown) => {
      if (this.pending.get(id) !== captured) return;
      this.pending.delete(id);
      captured.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    };
    try {
      void this.writer(JSON.stringify(payload)).catch(failed);
    } catch (error) {
      failed(error);
    }
    return pending;
  }

  close(error?: Error) {
    if (this.closed) return;
    this.closed = true;
    const err = error ?? new Error(`${this.label} process exited`);
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  cancelRequest(id: string): void {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    pending?.reject(new Error(`${this.label} request cancelled`));
  }
}
