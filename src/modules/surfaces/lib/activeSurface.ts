import type { WorkspaceEnv } from "@/modules/workspace";
import { firstCwd } from "./cwd";

export type SurfaceKind = "terminal" | "harness" | "editor" | "other";

export type SurfaceEnvironment =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; profileId: string; root: string }
  | { kind: "docker"; containerId: string }
  | { kind: "serial"; portName: string }
  | { kind: "remote"; environmentId: string };

export type ActiveSurface = {
  kind: SurfaceKind;
  ownerId: number | null;
  project: string | null;
  folder: string | null;
  environment: SurfaceEnvironment;
};

type SurfaceContext = {
  ownerId?: number;
  projectCwd?: unknown;
  workspaceEnv?: WorkspaceEnv;
};

export type ActiveSurfaceInput = SurfaceContext &
  (
    | { kind: "terminal"; cwd?: unknown }
    | { kind: "harness"; focusFolder?: unknown }
    | { kind: "editor"; folder?: unknown }
    | { kind: "other"; folder?: unknown }
  );

const LOCAL_ENVIRONMENT: SurfaceEnvironment = { kind: "local" };

export const NO_SURFACE: ActiveSurface = {
  kind: "other",
  ownerId: null,
  project: null,
  folder: null,
  environment: LOCAL_ENVIRONMENT,
};

function surfaceEnvironment(
  folder: string | null,
  workspace: WorkspaceEnv | undefined,
  harness: boolean,
): SurfaceEnvironment {
  // A remote namespace identifies a machine, not necessarily an SSH profile.
  const remoteId = folder?.match(/^remote:\/\/([^/\\]+)[/\\]/)?.[1];
  if (remoteId) return { kind: "remote", environmentId: remoteId };
  // Harness projects do not inherit the environment of the surrounding space.
  if (
    harness &&
    folder &&
    (/^[a-zA-Z]:[/\\]/.test(folder) || /^[/\\]{2}/.test(folder))
  ) {
    return LOCAL_ENVIRONMENT;
  }
  switch (workspace?.kind) {
    case "wsl":
      return { kind: "wsl", distro: workspace.distro };
    case "ssh":
      return {
        kind: "ssh",
        profileId: workspace.connection.id,
        root: workspace.root,
      };
    case "docker":
      return { kind: "docker", containerId: workspace.connection.containerId };
    case "serial":
      return { kind: "serial", portName: workspace.portName };
    default:
      return LOCAL_ENVIRONMENT;
  }
}

export function resolveActiveSurface(
  input: ActiveSurfaceInput | null | undefined,
): ActiveSurface {
  if (!input) return NO_SURFACE;
  const project = firstCwd(input.projectCwd);
  const folder =
    input.kind === "terminal"
      ? firstCwd(input.cwd)
      : input.kind === "harness"
        ? firstCwd(input.focusFolder, project)
        : firstCwd(input.folder);
  return {
    kind: input.kind,
    ownerId: input.ownerId ?? null,
    project,
    folder,
    environment: surfaceEnvironment(
      folder ?? project,
      input.workspaceEnv,
      input.kind === "harness",
    ),
  };
}
