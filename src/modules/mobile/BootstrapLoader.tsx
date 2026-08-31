import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/modules/i18n";

interface Progress {
  message: string;
  current: number;
  total: number;
}

export function BootstrapLoader({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress>({
    message: "",
    current: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("bootstrap_status")
      .then((done) => {
        if (done) {
          onComplete();
        }
      })
      .catch(() => {
        // Desktop or unbootstrapped Android
      });

    const unlisteners: Promise<UnlistenFn>[] = [];

    unlisteners.push(
      listen<Progress>("voktty:bootstrap-progress", (e) => {
        setProgress(e.payload);
      }),
    );

    unlisteners.push(
      listen("voktty:bootstrap-complete", () => {
        onComplete();
      }),
    );

    unlisteners.push(
      listen<string>("voktty:bootstrap-error", (e) => {
        setError(e.payload);
      }),
    );

    return () => {
      Promise.all(unlisteners).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [onComplete]);

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background text-foreground select-none">
      <div className="mb-8 flex flex-col items-center text-center">
        <img
          src="/voktty-icon.png"
          alt="Voktty"
          className="mb-4 h-16 w-16 rounded-2xl shadow-lg"
        />
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">
          Voktty
        </h1>
        <p className="text-xs text-muted-foreground">
          {t("common.loading")}
        </p>
      </div>

      {error ? (
        <div className="max-w-xs text-center">
          <p className="mb-2 text-sm font-medium text-destructive">
            {t("common.error")}
          </p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="mb-6 h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <p className="mb-3 text-sm font-medium text-foreground/90">
            {progress.message || t("common.loading")}
          </p>

          {progress.total > 0 && (
            <div className="w-64">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
                {progress.current.toLocaleString()} /{" "}
                {progress.total.toLocaleString()} ({pct}%)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
