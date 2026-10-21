import { homeDir } from "../fs";
import { setHarnessModels } from "../models";
import { type RawChildHandle, reserveRawChild } from "./child";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import { buildPiSpawnArgs, modelsFromRpcData } from "./piProtocol";

const DISCOVERY_TIMEOUT_MS = 45_000;

type CatalogEntry = {
  promise: Promise<void>;
  handle?: RawChildHandle;
  completed: boolean;
};
const inflight = new Map<string, CatalogEntry>();

function refreshCatalog(source: PiFlavor): Promise<void> {
  const flavor = {
    ...source,
    isolateFlags: source.isolateFlags.slice(),
    planTools: source.planTools.slice(),
  };
  const running = inflight.get(flavor.id);
  if (running && !running.handle?.retired) return running.promise;
  let admit!: (handle: RawChildHandle) => void;
  let reject!: (error: unknown) => void;
  const admission = new Promise<RawChildHandle>((yes, no) => {
    admit = yes;
    reject = no;
  });
  const entry: CatalogEntry = {
    completed: false,
    promise: admission
      .then((handle) =>
        discoverModels(flavor, undefined, handle, () => {
          entry.completed = true;
        }),
      )
      .then((models) => {
        if (
          inflight.get(flavor.id) === entry &&
          entry.completed &&
          models.length > 0
        )
          setHarnessModels(flavor.id, models);
      })
      .catch((error: unknown) => {
        console.debug(`[monocode] ${flavor.id} catalog`, error);
      })
      .finally(() => {
        if (inflight.get(flavor.id) === entry) inflight.delete(flavor.id);
      }),
  };
  inflight.set(flavor.id, entry);
  try {
    entry.handle = reserveRawChild(
      `${flavor.probeChildId}-${crypto.randomUUID()}`,
    );
    admit(entry.handle);
  } catch (error) {
    reject(error);
  }
  return entry.promise;
}

function assertActive(handle: RawChildHandle): void {
  if (handle.retired) throw new Error("Harness child was retired.");
}

async function discoverModels(
  source: PiFlavor,
  projectCwd?: string,
  reserved?: RawChildHandle,
  completed?: () => void,
) {
  const flavor = {
    ...source,
    isolateFlags: source.isolateFlags.slice(),
    planTools: source.planTools.slice(),
  };
  const args = buildPiSpawnArgs(flavor, {
    noSession: true,
    noExtensions: flavor.id !== "pi",
  });
  const resolveBinary = flavor.resolveBinary;
  const handle =
    reserved ??
    reserveRawChild(`${flavor.probeChildId}-${crypto.randomUUID()}`);
  const rpc = new PiRpc(
    handle.logicalSessionId,
    () => undefined,
    flavor.label,
    handle.write,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    assertActive(handle);
    const { path } = await resolveBinary();
    assertActive(handle);
    const cwd = projectCwd ?? (await homeDir());
    assertActive(handle);
    handle.watch(
      (line) => {
        if (!handle.retired) rpc.pushLine(line);
      },
      () => {
        if (!handle.retired)
          rpc.close(new Error(`${flavor.label} catalog probe exited`));
      },
    );
    assertActive(handle);
    await handle.spawn(path, args, cwd);
    assertActive(handle);
    const response = await Promise.race([
      rpc.request({ type: "get_available_models" }, DISCOVERY_TIMEOUT_MS),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${flavor.label} model discovery timed out`)),
          DISCOVERY_TIMEOUT_MS,
        );
      }),
    ]);
    assertActive(handle);
    const result = modelsFromRpcData(flavor, response.data);
    assertActive(handle);
    completed?.();
    return result;
  } finally {
    clearTimeout(timer);
    rpc.close();
    await handle.close().catch(() => undefined);
  }
}

export function refreshPiCatalog(): Promise<void> {
  return refreshCatalog(PI_FLAVOR);
}
export function discoverPiModels(cwd: string) {
  return discoverModels(PI_FLAVOR, cwd);
}
export function refreshOmpCatalog(): Promise<void> {
  return refreshCatalog(OMP_FLAVOR);
}
export function discoverOmpModels(cwd: string) {
  return discoverModels(OMP_FLAVOR, cwd);
}
