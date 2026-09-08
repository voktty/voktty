import type { HarnessId } from "./session";

/**
 * Hosts most agent workflows need regardless of harness: package registries
 * and GitHub. Always included, then topped up with the harness's own API
 * host(s) below. This is a starting point, not a fixed policy — the user
 * edits the list per session once the sandbox is on.
 */
export const UNIVERSAL_ALLOWLIST_HOSTS: string[] = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "registry.npmjs.org",
  "*.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "index.crates.io",
];

/**
 * Best-effort per-harness API hosts. Harnesses that proxy through a
 * user-configured or self-hosted backend (opencode, omp, hermes) get no
 * extra entries here — the universal list plus manual edits cover them.
 */
const HARNESS_ALLOWLIST_HOSTS: Record<HarnessId, string[]> = {
  claude: ["api.anthropic.com"],
  codex: ["api.openai.com", "chatgpt.com"],
  cursor: ["api2.cursor.sh"],
  gemini: ["generativelanguage.googleapis.com", "cloudcode-pa.googleapis.com"],
  grok: ["api.x.ai"],
  hermes: [],
  opencode: [],
  pi: ["api.openai.com", "api.anthropic.com"],
  omp: [],
  fx: [],
};

/** Starting allowlist for a session's harness when the sandbox is first enabled. */
export function defaultNetworkAllowlist(harness: HarnessId): string[] {
  return [
    ...new Set([
      ...UNIVERSAL_ALLOWLIST_HOSTS,
      ...HARNESS_ALLOWLIST_HOSTS[harness],
    ]),
  ];
}
