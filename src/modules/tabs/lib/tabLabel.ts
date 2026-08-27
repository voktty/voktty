import { t as translate } from "@/modules/i18n";
import type { Tab } from "./useTabs";

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then fall back to the last segment of the
 * cwd. Keeping this pure makes the "custom name survives a cd" invariant
 * testable without rendering the bar.
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
  if (t.customTitle) return t.customTitle;
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
      return {
        icon: "remote",
        text: `ssh ${tab.workspaceEnv.connection.user}@${tab.workspaceEnv.connection.host}`,
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
      text: "API Client & Sandbox",
    };
  }
  return { icon: "none", text: "" };
}
