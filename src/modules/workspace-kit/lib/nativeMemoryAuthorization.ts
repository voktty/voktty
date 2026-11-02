import { invoke } from "@tauri-apps/api/core";

let pendingAuthorizations = 0;

function localDirectory(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(path) &&
    !path.startsWith("//") &&
    !path.startsWith("\\\\") &&
    !path.split(/[\\/]/).includes("..") &&
    /^(?:\/|[A-Za-z]:[\\/])/.test(path)
  );
}

export async function authorizeNativeMemoryDirectory(path: string) {
  if (!localDirectory(path))
    throw Object.assign(new Error("Invalid memory directory"), { code: "invalidInput" });
  if (pendingAuthorizations >= 256)
    throw Object.assign(new Error("Memory directory authorization is busy"), { code: "busy" });
  pendingAuthorizations += 1;
  try {
    const canonical = await invoke<string>("workspace_authorize", {
      path,
      workspace: { kind: "local" },
    });
    if (!localDirectory(canonical))
      throw Object.assign(new Error("Invalid authorized memory directory"), { code: "invalidInput" });
    return canonical;
  } finally {
    pendingAuthorizations -= 1;
  }
}
