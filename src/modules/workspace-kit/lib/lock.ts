import type { KitLock } from "@/modules/workspace-kit/lib/configTypes";
import {
  planKitDeployment,
  type KitPathFact,
} from "@/modules/workspace-kit/lib/deployment";
import type { KitFile } from "@/modules/workspace-kit/lib/template";
import {
  isUnicodeScalarText,
  parseKitLock,
} from "@/modules/workspace-kit/lib/validation";

const encoder = new TextEncoder();

export async function prepareKitDeployment(
  version: string,
  files: readonly KitFile[],
  facts: ReadonlyMap<string, KitPathFact>,
  rootLinks: Readonly<{ agents: boolean; claude: boolean }> = {
    agents: false,
    claude: false,
  },
): Promise<
  Readonly<ReturnType<typeof planKitDeployment> & { lock: KitLock | null }>
> {
  let sourceBytes = 0;
  let observedBytes = 0;
  if (
    version.length > 32 ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ||
    /[^0-9.]/.test(version) ||
    files.length > 128
  )
    throw new Error("KIT_LOCK_INPUT_INVALID");
  for (const file of files) {
    const selected =
      file.kind !== "link" ||
      (file.path === "AGENTS.md" ? rootLinks.agents : rootLinks.claude);
    const observed = selected ? facts.get(file.path) : undefined;
    const texts = [file.text, observed?.kind === "file" ? observed.text : ""];
    const sizes = texts.map((text) => encoder.encode(text).byteLength);
    sourceBytes += sizes[0];
    observedBytes += sizes[1];
    if (
      file.path.length > 256 ||
      file.path.split("/")[1]?.toLowerCase() === "kit.lock.json" ||
      sizes.some((size) => size > 256 * 1024) ||
      sourceBytes > 1024 * 1024 ||
      observedBytes > 1024 * 1024 ||
      texts.some((text) => !isUnicodeScalarText(text) || text.includes("\0"))
    )
      throw new Error("KIT_LOCK_INPUT_INVALID");
  }
  const plan = planKitDeployment(files, facts, rootLinks);
  if (!plan.canPublish) return Object.freeze({ ...plan, lock: null });
  const observed = facts.get(".voktty/kit.lock.json");
  if (!observed)
    throw new Error("Missing deployment observation: .voktty/kit.lock.json");
  const expected = observed.kind === "file" ? observed.text : null;
  const blocked = observed.kind === "blocked";
  if (
    expected !== null &&
    (encoder.encode(expected).byteLength > 64 * 1024 ||
      !isUnicodeScalarText(expected) ||
      expected.includes("\0"))
  )
    throw new Error("KIT_LOCK_INPUT_INVALID");
  const bases = new Set(
    files.filter((file) => file.kind === "base").map((file) => file.path),
  );
  const pending = plan.entries
    .filter((entry) => bases.has(entry.path))
    .map((entry) => ({ path: entry.path, text: entry.proposed }));
  pending.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hashes = await Promise.all(
    pending.map(async ({ path, text }) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(text),
      );
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return { path, version, sha256 };
    }),
  );
  const lock = parseKitLock(JSON.stringify({ schema: 1, bases: hashes }));
  const proposed = `${JSON.stringify(lock, null, 2)}\n`;
  const action = blocked
    ? "conflict"
    : expected === null
      ? "create"
      : expected === proposed
        ? "skip"
        : "conflict";
  const reason = blocked
    ? "unavailable"
    : expected === null
      ? "missing"
      : expected === proposed
        ? "identical"
        : "different";
  const lockEntry = Object.freeze({
    path: ".voktty/kit.lock.json",
    action,
    reason,
    expected,
    proposed,
  });
  const entries = Object.freeze([
    ...plan.entries.filter((entry) => entry.path !== ".voktty/kit.json"),
    lockEntry,
    ...plan.entries.filter((entry) => entry.path === ".voktty/kit.json"),
  ]);
  return Object.freeze({ entries, canPublish: action !== "conflict", lock });
}
