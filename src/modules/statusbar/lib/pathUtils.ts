import type { WorkspaceEnv } from "@/modules/workspace";

export type Segment = {
  label: string;
  fullPath: string;
  isHome: boolean;
  isRemote?: boolean;
};

const WINDOWS_DRIVE = /^([A-Za-z]:)(.*)$/;

export function breadcrumbHomeForWorkspace(
  home: string | null | undefined,
  workspace: WorkspaceEnv | undefined,
): string | null | undefined {
  return !workspace || workspace.kind === "local" ? home : null;
}

export function breadcrumbChildPath(parent: string, child: string): string {
  return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
}

function normalize(p: string | null | undefined): string {
  if (typeof p !== "string") {
    return "";
  }
  return p.replace(/\\/g, "/");
}

export function segmentsFromCwd(
  cwd: string | null | undefined,
  home: string | null | undefined,
  sshConnections?: readonly { id: string; name: string }[],
): Segment[] {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    return [];
  }

  const normCwd = normalize(cwd);
  if (!normCwd) {
    return [];
  }

  if (normCwd.startsWith("remote://")) {
    const withoutPrefix = normCwd.slice("remote://".length);
    const slashIdx = withoutPrefix.indexOf("/");
    const environmentId =
      slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
    const hostPath = slashIdx === -1 ? "/" : withoutPrefix.slice(slashIdx);

    let profileName: string | undefined;
    if (environmentId.startsWith("voktty-ssh-")) {
      try {
        const decoded = decodeURIComponent(
          environmentId.slice("voktty-ssh-".length),
        );
        const found = sshConnections?.find((c) => c.id === decoded);
        if (found?.name) {
          profileName = found.name;
        } else {
          const match = /^ssh-config-(.+)-\d+-[a-z0-9]+$/.exec(decoded);
          if (match) {
            profileName = match[1];
          } else {
            profileName = decoded;
          }
        }
      } catch {
        profileName = environmentId;
      }
    }
    const label = profileName || environmentId;
    const rootSegment: Segment = {
      label,
      fullPath: `remote://${environmentId}/`,
      isHome: false,
      isRemote: true,
    };
    const tailParts = hostPath.replace(/^\//, "").split("/").filter(Boolean);
    const segments: Segment[] = [rootSegment];
    let acc = `remote://${environmentId}`;
    for (const part of tailParts) {
      acc = `${acc}/${part}`;
      segments.push({ label: part, fullPath: acc, isHome: false });
    }
    return segments;
  }

  const normHome =
    typeof home === "string" && home.trim() !== "" ? normalize(home) : null;

  const usingHome =
    normHome !== null &&
    (normCwd === normHome || normCwd.startsWith(normHome + "/"));

  let rootSegment: Segment;
  let tail: string;

  if (usingHome) {
    rootSegment = { label: "~", fullPath: normHome!, isHome: true };
    tail = normCwd.slice(normHome!.length).replace(/^\//, "");
  } else {
    const driveMatch = WINDOWS_DRIVE.exec(normCwd);
    if (driveMatch) {
      const drive = driveMatch[1];
      rootSegment = { label: drive, fullPath: drive + "/", isHome: false };
      tail = driveMatch[2].replace(/^\//, "");
    } else {
      rootSegment = { label: "/", fullPath: "/", isHome: false };
      tail = normCwd.replace(/^\//, "");
    }
  }

  const parts = tail === "" ? [] : tail.split("/").filter(Boolean);
  const segments: Segment[] = [rootSegment];

  let acc = rootSegment.fullPath;
  for (const part of parts) {
    acc = acc.endsWith("/") ? acc + part : acc + "/" + part;
    segments.push({ label: part, fullPath: acc, isHome: false });
  }
  return segments;
}
