import {
  acquireHarnessBridge,
  type RawChildHandle,
  reserveRawChild,
} from "./child";
import { type NativeCommand, nativeCommandInvocation } from "./nativeCommands";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import {
  asRecord,
  buildPiSpawnArgs,
  extensionUiResponse,
  needsExtensionUiReply,
  parseExtensionUiRequest,
} from "./piProtocol";

const REQUEST_TIMEOUT_MS = 45_000;

export type PiSkillCommand = {
  name: string;
  description: string;
  invocation: string;
  source: "pi";
};

export async function discoverPiSkills(cwd: string): Promise<PiSkillCommand[]> {
  return piSkillsFromRpcData(
    await discoverCommands(PI_FLAVOR, cwd, "get_commands"),
  );
}

export async function discoverOmpCommands(
  cwd: string,
): Promise<NativeCommand[]> {
  return ompCommandsFromRpcData(
    await discoverCommands(OMP_FLAVOR, cwd, "get_available_commands"),
  );
}

function assertActive(handle: RawChildHandle): void {
  if (handle.retired) throw new Error("Harness child was retired.");
}

async function discoverCommands(
  source: PiFlavor,
  cwd: string,
  command: string,
): Promise<unknown> {
  const flavor = {
    ...source,
    isolateFlags: source.isolateFlags.slice(),
    planTools: source.planTools.slice(),
  };
  const args = buildPiSpawnArgs(flavor, { noSession: true });
  const resolveBinary = flavor.resolveBinary;
  const handle = reserveRawChild(
    `monocode-${flavor.id}-skills-${crypto.randomUUID()}`,
  );
  let releaseBridge: (() => void) | undefined;
  const replyToUi = (record: Record<string, unknown>) => {
    if (handle.retired) return;
    const request = parseExtensionUiRequest(record);
    if (!request || !needsExtensionUiReply(request)) return;
    void handle
      .write(JSON.stringify(extensionUiResponse(request, "deny")))
      .catch(() => undefined);
  };
  let capturedRpc: PiRpc | undefined;
  try {
    assertActive(handle);
    const { path } = await resolveBinary();
    assertActive(handle);
    releaseBridge = await acquireHarnessBridge();
    assertActive(handle);
    const rpc = new PiRpc(
      handle.logicalSessionId,
      replyToUi,
      flavor.label,
      handle.write,
    );
    capturedRpc = rpc;
    handle.watch(
      (line) => {
        if (!handle.retired) rpc.pushLine(line);
      },
      () => {
        if (!handle.retired)
          rpc.close(new Error(`${flavor.label} skill probe exited`));
      },
    );
    assertActive(handle);
    await handle.spawn(path, args, cwd);
    assertActive(handle);
    const response = await rpc.request({ type: command }, REQUEST_TIMEOUT_MS);
    assertActive(handle);
    return asRecord(response)?.data;
  } finally {
    capturedRpc?.close();
    try {
      await handle.close().catch(() => undefined);
    } finally {
      releaseBridge?.();
    }
  }
}

export function ompCommandsFromRpcData(data: unknown): NativeCommand[] {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands))
    throw new Error("OMP get_available_commands returned no commands array");
  const seen = new Set<string>();
  return commands.flatMap((value): NativeCommand[] => {
    const row = asRecord(value);
    const name = row?.name;
    if (
      typeof name !== "string" ||
      !name ||
      /[\s/\\]/.test(name) ||
      seen.has(name)
    )
      return [];
    seen.add(name);
    const aliases = Array.isArray(row?.aliases)
      ? row.aliases.filter(
          (alias): alias is string =>
            typeof alias === "string" && !!alias && !/[\s/\\]/.test(alias),
        )
      : [];
    const hint = asRecord(row?.input)?.hint;
    const subcommands = Array.isArray(row?.subcommands)
      ? row.subcommands.flatMap((value) => {
          const sub = asRecord(value);
          if (typeof sub?.name !== "string" || !sub.name) return [];
          return [
            {
              name: sub.name,
              ...(typeof sub.description === "string"
                ? { description: sub.description }
                : {}),
              ...(typeof sub.usage === "string" ? { usage: sub.usage } : {}),
            },
          ];
        })
      : [];
    return [
      {
        name,
        invocation: nativeCommandInvocation("omp", name),
        source: "omp",
        description:
          typeof row?.description === "string" ? row.description : "",
        ...(typeof row?.source === "string" ? { origin: row.source } : {}),
        ...(aliases.length ? { aliases } : {}),
        ...(typeof hint === "string" ? { inputHint: hint } : {}),
        ...(subcommands.length ? { subcommands } : {}),
      },
    ];
  });
}

export function piSkillsFromRpcData(data: unknown): PiSkillCommand[] {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands)) {
    throw new Error("Pi get_commands returned no commands array");
  }

  const seen = new Set<string>();
  const skills: PiSkillCommand[] = [];
  for (const value of commands) {
    const command = asRecord(value);
    const invocation = command?.name;
    if (
      command?.source !== "skill" ||
      typeof invocation !== "string" ||
      !invocation.startsWith("skill:") ||
      seen.has(invocation)
    ) {
      continue;
    }
    const name = invocation.slice("skill:".length);
    if (!name) continue;
    seen.add(invocation);
    skills.push({
      name,
      description:
        typeof command.description === "string" ? command.description : "",
      invocation,
      source: "pi",
    });
  }
  return skills;
}
