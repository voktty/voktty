import { ArrowDownCircle, Loader, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../lib/updater";

type Props = {
  variant?: "classic" | "rail";
};

export function SidebarUpdate({ variant = "rail" }: Props) {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentVersion = await readAppVersion();
      if (cancelled) return;
      setSnapshot({ phase: "checking", currentVersion });

      try {
        const update = await probeForUpdate();
        if (cancelled) return;
        if (update) {
          setSnapshot({
            phase: "available",
            currentVersion,
            availableVersion: update.version,
          });
          return;
        }
        setSnapshot({ phase: "current", currentVersion });
      } catch {
        if (cancelled) return;
        setSnapshot({ phase: "idle", currentVersion });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = useCallback(async () => {
    if (snapshot.phase === "downloading" || snapshot.phase === "checking") {
      return;
    }

    if (snapshot.phase === "available") {
      await installPendingUpdate(setSnapshot);
      return;
    }

    await runUpdateFlow(true, setSnapshot);
  }, [snapshot.phase]);

  const busy =
    snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";
  const label = hasUpdate
    ? `Update to ${snapshot.availableVersion}`
    : busy
      ? snapshot.phase === "downloading"
        ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
        : "Checking…"
      : "Check for updates";

  const classic = variant === "classic";
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex w-full items-center gap-2 text-left transition-colors ${
        classic
          ? `rounded-md px-2 py-1.5 text-[12px] leading-tight ${
              hasUpdate
                ? "bg-accent/15 text-content hover:bg-accent/20"
                : "text-content/50 hover:bg-content/5 hover:text-content"
            }`
          : `rounded-lg px-2 py-2 ${
              hasUpdate
                ? "bg-accent/15 text-content hover:bg-accent/20"
                : "bg-content/5 text-content/75 hover:bg-content/10 hover:text-content"
            }`
      } disabled:cursor-default disabled:opacity-70`}
    >
      <span
        className={`grid shrink-0 place-items-center ${
          classic ? "size-5" : "size-[18px]"
        }`}
      >
        {busy ? (
          <Loader
            className={`animate-spin ${classic ? "size-3.5" : "size-4 opacity-70"}`}
            aria-hidden
          />
        ) : hasUpdate ? (
          <ArrowDownCircle
            className={`${classic ? "size-3.5" : "size-4"} text-accent`}
            aria-hidden
          />
        ) : (
          <RefreshCw
            className={`${classic ? "size-3.5" : "size-4 opacity-70"}`}
            strokeWidth={classic ? undefined : 1.75}
            aria-hidden
          />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 ${classic ? "" : "flex items-center"}`}
      >
        <span
          className={`block truncate font-medium ${
            classic ? "" : "text-[12px] leading-tight"
          }`}
        >
          {label}
        </span>
        <span
          className={`block truncate text-[11px] text-content/40 ${
            classic ? "" : "ml-auto"
          }`}
        >
          v{snapshot.currentVersion}
        </span>
      </span>
    </button>
  );

  if (!classic) return button;

  return (
    <div className="shrink-0 border-t border-content/10 p-2">{button}</div>
  );
}
