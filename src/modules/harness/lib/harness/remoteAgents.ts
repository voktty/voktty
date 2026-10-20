import type { HarnessId } from "@/modules/harness/lib/session";
import { isRemoteProjectPath } from "@/modules/harness/lib/recents";
import type { Attachment } from "@/modules/harness/lib/session";

export type RemoteAgentSpec = {
  /** Binary the host helper starts. */
  command: string;
  /** Lowest version known to work with the protocol this app drives. */
  minVersion?: string;
  /** Shown when the binary is missing on the host. */
  install: string;
};

/**
 * Agents with a working remote path. Every other harness refuses remote
 * projects up front: they resolve their binary and working folder on this
 * computer, so running them against a `remote://` folder cannot work.
 */
export const REMOTE_AGENTS: Partial<Record<HarnessId, RemoteAgentSpec>> = {
  codex: { command: "codex", install: "npm install -g @openai/codex" },
  claude: {
    command: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
  },
  opencode: {
    command: "opencode",
    minVersion: "2.0.15",
    install: "curl -fsSL https://opencode.ai/install | bash",
  },
};

export class RemoteAgentError extends Error {
  constructor(
    readonly code:
      | "remote-agent-unsupported"
      | "remote-agent-missing"
      | "remote-agent-version"
      | "remote-agent-attachment",
    message: string,
  ) {
    super(message);
    this.name = "RemoteAgentError";
  }
}

export function supportsRemoteAgent(harness: HarnessId): boolean {
  return REMOTE_AGENTS[harness] !== undefined;
}

export function remoteAgentForCommand(
  command: string,
): RemoteAgentSpec | undefined {
  return Object.values(REMOTE_AGENTS).find((spec) => spec.command === command);
}

/** Refuses a remote project for a harness that cannot run there. */
export function assertRemoteAgentSupported(
  harness: HarnessId,
  cwd: string,
): void {
  if (!isRemoteProjectPath(cwd) || supportsRemoteAgent(harness)) return;
  const supported = Object.keys(REMOTE_AGENTS).join(", ");
  throw new RemoteAgentError(
    "remote-agent-unsupported",
    `${harness} cannot run on a remote host yet. Use ${supported} for this project, or open the project locally.`,
  );
}

/** An inline image travels in the prompt itself; everything else is read by the agent from a path on this computer. */
function travelsInline(file: Attachment): boolean {
  return Boolean(file.data) && file.kind === "image";
}

/**
 * A remote agent cannot read a path on this computer, so anything that is not
 * an inline image is refused instead of being sent as a path that does not
 * exist on the host.
 */
export function assertRemoteAttachments(
  attachments: readonly Attachment[] | undefined,
  cwd: string,
): void {
  if (!attachments?.length || !isRemoteProjectPath(cwd)) return;
  const blocked = attachments.filter((file) => !travelsInline(file));
  if (blocked.length === 0) return;
  const names = blocked.map((file) => file.name).join(", ");
  throw new RemoteAgentError(
    "remote-agent-attachment",
    `${names} cannot be sent to an agent on a remote host. Only images can be attached to a remote project for now; copy other files into the project instead.`,
  );
}

export type RemoteAgentProbe = {
  found: boolean;
  path?: string | null;
  version?: string | null;
  error?: string | null;
};

/** First dotted number in a `--version` line, such as `2.0.15` in `claude 2.0.15 (Code)`. */
export function parseVersion(text: string | null | undefined): string | undefined {
  return text?.match(/\d+(?:\.\d+){1,3}/)?.[0];
}

/** Negative, zero or positive like a comparator; missing parts count as zero. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Turns what the host reported into a clear error, or passes. */
export function checkRemoteAgentProbe(
  command: string,
  probe: RemoteAgentProbe,
): void {
  const spec = remoteAgentForCommand(command);
  if (!probe.found) {
    throw new RemoteAgentError(
      "remote-agent-missing",
      `${command} is not installed on the remote host. Install it there first${spec ? `, for example: ${spec.install}` : ""}.`,
    );
  }
  const version = parseVersion(probe.version);
  if (spec?.minVersion && version && compareVersions(version, spec.minVersion) < 0) {
    throw new RemoteAgentError(
      "remote-agent-version",
      `${command} ${version} on the remote host is older than ${spec.minVersion}. Update it there first.`,
    );
  }
}