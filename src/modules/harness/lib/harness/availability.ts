import type { HarnessId } from "../session";
import { HARNESSES } from "../session";
import {
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveFxBinary,
  resolveGeminiBinary,
  resolveGrokBinary,
  resolveHermesBinary,
  resolveOmpBinary,
  resolveOpenCodeBinary,
  resolvePiBinary,
} from "./child";
import { isLiveHarness } from "./registry";

export type HarnessAvailability = Record<HarnessId, boolean>;

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  cursor: { name: "Cursor CLI" },
  grok: {
    name: "Grok Build CLI",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  opencode: { name: "OpenCode CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  fx: { name: "fx CLI", install: "curl -fsSL https://fx.sh/setup.sh | bash" },
  gemini: { name: "Gemini CLI" },
  hermes: { name: "Hermes CLI" },
};

let availability: HarnessAvailability = {
  claude: false,
  codex: false,
  cursor: false,
  grok: false,
  opencode: false,
  pi: false,
  omp: false,
  fx: false,
  gemini: false,
  hermes: false,
};
let version = 0;
const probeFlights = new Map<HarnessId, Promise<readonly [HarnessId, boolean]>>();
const probedAt = new Map<HarnessId, number>();
const listeners = new Set<() => void>();

/**
 * A probe stats ~100 paths across ten resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;
const PROBE_CONCURRENCY = 2;

const RESOLVERS: Record<HarnessId, () => Promise<unknown>> = {
  claude: resolveClaudeBinary,
  codex: resolveCodexBinary,
  cursor: resolveCursorBinary,
  grok: resolveGrokBinary,
  opencode: resolveOpenCodeBinary,
  pi: resolvePiBinary,
  omp: resolveOmpBinary,
  fx: resolveFxBinary,
  gemini: resolveGeminiBinary,
  hermes: resolveHermesBinary,
};

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeHarnessAvailability(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getHarnessAvailabilitySnapshot(): number {
  return version;
}

export function hasProbedHarnessAvailability(): boolean {
  return probedAt.size > 0;
}

export function isHarnessAvailable(id: HarnessId): boolean {
  return availability[id];
}

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart MonoCode if it is already installed.`;
}

export function probeHarnessAvailability(options?: {
  force?: boolean;
  ids?: Iterable<HarnessId>;
}): Promise<void> {
  const now = Date.now();
  const ids = [...new Set(options?.ids ?? HARNESSES)].filter(
    (id) =>
      isLiveHarness(id) &&
      (options?.force || now - (probedAt.get(id) ?? 0) >= PROBE_TTL_MS),
  );
  if (ids.length === 0) return Promise.resolve();

  return probeWithConcurrency(ids, PROBE_CONCURRENCY).then((entries) => {
    const next = { ...availability };
    for (const [id, ok] of entries) next[id] = ok;
    availability = next;
    emit();
  });
}

function probeWithConcurrency(
  ids: HarnessId[],
  limit: number,
): Promise<(readonly [HarnessId, boolean])[]> {
  const entries: (readonly [HarnessId, boolean])[] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      if (!id) continue;
      entries.push(await probeOne(id));
    }
  };
  return Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker)).then(
    () => entries,
  );
}

function probeOne(id: HarnessId): Promise<readonly [HarnessId, boolean]> {
  const existing = probeFlights.get(id);
  if (existing) return existing;
  const run = RESOLVERS[id]()
    .then(() => [id, true] as const)
    .catch(() => [id, false] as const)
    .finally(() => {
      probedAt.set(id, Date.now());
      probeFlights.delete(id);
    });
  probeFlights.set(id, run);
  return run;
}
