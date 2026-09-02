import { t as translate } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { Tab } from "./useTabs";

export function isSshTab(
  tab: Tab,
  currentWorkspaceEnv?: WorkspaceEnv,
): boolean {
  if (tab.kind === "terminal") {
    if (tab.workspaceEnv?.kind === "ssh") return true;
    if (currentWorkspaceEnv?.kind === "ssh") return true;
    if (isSshOrRemoteSession(tab)) return true;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    if (tab.workspaceEnv?.kind === "ssh") return true;
    if (currentWorkspaceEnv?.kind === "ssh") return true;
  }
  return false;
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then fall back to the last segment of the
 * cwd. Keeping this pure makes the "custom name survives a cd" invariant
 * testable without rendering the bar.
 */
export function isSshOrRemoteSession(tab: Tab): boolean {
  if (tab.kind === "terminal" && tab.workspaceEnv?.kind === "ssh") return true;
  const title = (tab.title || "").trim().toLowerCase();
  if (
    title.startsWith("ssh ") ||
    title.startsWith("ssh:") ||
    title.startsWith("ssh_") ||
    title === "ssh"
  ) {
    return true;
  }
  // Check for user@hostname or user@host:path pattern emitted by remote Linux shells
  if (/^[a-z0-9._-]+@[a-z0-9._-]+/i.test(title)) {
    return true;
  }
  return false;
}

export function extractRemoteHostLabel(tab: Tab): string | null {
  if (tab.kind === "terminal" && tab.workspaceEnv?.kind === "ssh") {
    const conn = tab.workspaceEnv.connection;
    if (conn.name?.trim()) return conn.name.trim();
    if (conn.user?.trim() && conn.host?.trim()) {
      return `${conn.user.trim()}@${conn.host.trim()}`;
    }
    if (conn.host?.trim()) return conn.host.trim();
  }

  const title = (tab.title || "").trim();
  // If title is ssh user@host or ssh host
  if (/^ssh\s+([^\s]+)/i.test(title)) {
    const match = title.match(/^ssh\s+([^\s]+)/i);
    if (match && match[1]) {
      return match[1].replace(/^-.*$/, "");
    }
  }

  // If title is user@host:path or user@host:~ or user@host
  const remoteMatch = title.match(/^([a-z0-9._-]+@[a-z0-9._-]+)(?::.*)?$/i);
  if (remoteMatch && remoteMatch[1]) {
    return remoteMatch[1];
  }

  return null;
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then fall back to remote host info or the
 * last segment of the cwd.
 */
export function labelFor(t: Tab): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.kind === "rdp") return t.title;
  if (t.kind === "api-client") return t.title;
  if (t.kind === "harness") return t.title;
  if (t.customTitle) return t.customTitle;

  const remoteLabel = extractRemoteHostLabel(t);
  if (remoteLabel) return remoteLabel;

  if (t.kind === "terminal") {
    if (t.workspaceEnv?.kind === "docker") {
      return (
        t.workspaceEnv.connection.containerName ||
        t.workspaceEnv.connection.image.split(":")[0] ||
        t.title
      );
    }

    if (t.workspaceEnv?.kind === "wsl") {
      return t.workspaceEnv.distro || "WSL";
    }

    if (t.workspaceEnv?.kind === "serial") {
      return t.workspaceEnv.portName;
    }
  }

  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

export function getTabSubtitle(tab: Tab): {
  icon: "git" | "folder" | "remote" | "status" | "none";
  text: string;
} {
  if (tab.kind === "terminal") {
    if (tab.workspaceEnv?.kind === "ssh") {
      const conn = tab.workspaceEnv.connection;
      const userHost = `${conn.user ? `${conn.user}@` : ""}${conn.host}`;
      return {
        icon: "remote",
        text: conn.name ? `${conn.name} (${userHost})` : `ssh ${userHost}`,
      };
    }
    const remoteLabel = extractRemoteHostLabel(tab);
    if (remoteLabel) {
      return {
        icon: "remote",
        text: `ssh ${remoteLabel}`,
      };
    }
    if (tab.workspaceEnv?.kind === "serial") {
      return {
        icon: "remote",
        text: `serial · ${tab.workspaceEnv.portName}`,
      };
    }
    if (tab.workspaceEnv?.kind === "docker") {
      return {
        icon: "remote",
        text: `docker · ${tab.workspaceEnv.connection.image.split(":")[0]}`,
      };
    }
    if (tab.workspaceEnv?.kind === "wsl") {
      return {
        icon: "remote",
        text: `wsl · ${tab.workspaceEnv.distro || "default"}`,
      };
    }
    if (tab.cwd) {
      const norm = tab.cwd.replace(/\\/g, "/");
      const parts = norm.split("/").filter(Boolean);
      const short =
        parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : norm;
      return { icon: "folder", text: short };
    }
    return { icon: "none", text: translate("tabs.subtitles.terminal") };
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    if (tab.path) {
      const norm = tab.path.replace(/\\/g, "/");
      const lastSlash = norm.lastIndexOf("/");
      const dir = lastSlash >= 0 ? norm.slice(0, lastSlash) : "";
      const parts = dir.split("/").filter(Boolean);
      const short =
        parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : dir || "/";
      return { icon: "folder", text: short };
    }
    return { icon: "none", text: translate("tabs.subtitles.file") };
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return { icon: "git", text: translate("tabs.subtitles.gitDiff") };
  }
  if (tab.kind === "git-history") {
    return { icon: "git", text: translate("tabs.subtitles.gitHistory") };
  }
  if (tab.kind === "preview") {
    return { icon: "remote", text: translate("tabs.subtitles.webPreview") };
  }
  if (tab.kind === "ai-diff") {
    return { icon: "status", text: translate("tabs.subtitles.aiProposal") };
  }
  if (tab.kind === "rdp") {
    return {
      icon: "remote",
      text: tab.host
        ? `rdp · ${tab.host}`
        : translate("tabs.subtitles.remoteDesktop"),
    };
  }
  if (tab.kind === "api-client") {
    return {
      icon: "remote",
      text: translate("tabs.subtitles.apiClient"),
    };
  }
  if (tab.kind === "harness") {
    return {
      icon: "status",
      text: "agent development harness",
    };
  }
  return { icon: "none", text: "" };
}
