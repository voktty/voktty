import { openExternalUrl } from "@/lib/external-link";
import { t } from "@/modules/i18n";
import { native } from "@/modules/ai/lib/native";
import { toast } from "sonner";

export const SAFE_DIR_LINK_REGEX =
  /git\s+config\s+--global\s+--add\s+safe\.directory\s+('[^']+'|"[^"]+"|\S+)/;

export const DUBIOUS_OWNERSHIP_LINK_REGEX =
  /detected\s+dubious\s+ownership\s+in\s+repository\s+at\s+('[^']+'|"[^"]+")/;

export async function handleTerminalGitTrust(
  matchedText: string,
  focusTerminal?: () => void,
) {
  let path = "";
  const safeDirMatch = matchedText.match(
    /safe\.directory\s+('[^']+'|"[^"]+"|\S+)/i,
  );
  if (safeDirMatch) {
    path = safeDirMatch[1].trim().replace(/^['"]|['"]$/g, "");
  } else {
    const dubiousMatch = matchedText.match(
      /repository\s+at\s+('[^']+'|"[^"]+")/i,
    );
    if (dubiousMatch) {
      path = dubiousMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  if (!path) return;

  try {
    await native.gitAddSafeDirectory(path);
    toast.success(t("feedback.safeDirectoryAdded", { path }));
    window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
  } catch (err) {
    toast.error(t("feedback.safeDirectoryFailed", { error: String(err) }));
  } finally {
    focusTerminal?.();
  }
}

export function createTerminalLinkHandler(focus: () => void) {
  return {
    activate: (_event: MouseEvent, uri: string) => {
      if (
        SAFE_DIR_LINK_REGEX.test(uri) ||
        DUBIOUS_OWNERSHIP_LINK_REGEX.test(uri)
      ) {
        void handleTerminalGitTrust(uri, focus);
        return;
      }
      void openExternalUrl(uri, focus);
    },
  };
}
