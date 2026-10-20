import {
  parseRemotePath,
  remotePath,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import { invokeWorkspace } from "./fs";
import type { RemoteStoreIo } from "./remoteSessionStore";

const MISSING = /does not exist|not found|no such file|enoent/i;

function isMissing(error: unknown): boolean {
  return MISSING.test(error instanceof Error ? error.message : String(error));
}

function isAlreadyThere(error: unknown): boolean {
  return /already exists/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function joinHost(root: string, relative: string): string {
  return `${root.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}

/** Reads and writes below the saved project that owns `cwd`, through the shared
 * helper session. Undefined when `cwd` is not inside a saved remote project. */
export function remoteStoreIoFor(
  cwd: string,
): { io: RemoteStoreIo; key: string; environmentId: string; root: string } | undefined {
  const project = remoteProjectForPath(cwd);
  const parsed = parseRemotePath(cwd);
  if (!project || !parsed) return undefined;
  const { environmentId } = project;
  const at = (relative: string) =>
    remotePath(environmentId, joinHost(project.cwd, relative));

  async function ensureFolder(relative: string): Promise<void> {
    const cut = relative.lastIndexOf("/");
    const parent = cut > 0 ? relative.slice(0, cut) : "";
    const name = cut > 0 ? relative.slice(cut + 1) : relative;
    if (parent) await ensureFolder(parent);
    await invokeWorkspace("create_path", {
      parent: at(parent),
      name,
      isDir: true,
    }).catch((error: unknown) => {
      if (!isAlreadyThere(error)) throw error;
    });
  }

  const io: RemoteStoreIo = {
    async read(path) {
      try {
        return await invokeWorkspace<string>("read_text_file", { path: at(path) });
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async write(path, content) {
      const write = () =>
        invokeWorkspace<void>("write_text_file", { path: at(path), content });
      try {
        await write();
      } catch (error) {
        if (!isMissing(error)) throw error;
        const cut = path.lastIndexOf("/");
        if (cut > 0) await ensureFolder(path.slice(0, cut));
        await write();
      }
    },
    async list(path) {
      try {
        const entries = await invokeWorkspace<{ name: string; isDir: boolean }[]>(
          "list_dir",
          { path: at(path) },
        );
        return entries.filter((entry) => !entry.isDir).map((entry) => entry.name);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
    async remove(path) {
      try {
        await invokeWorkspace<void>("delete_path", { path: at(path) });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
  return { io, key: project.key, environmentId, root: project.cwd };
}