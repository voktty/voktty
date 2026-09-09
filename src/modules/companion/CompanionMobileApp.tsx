import { useTranslation } from "@/modules/i18n";

/**
 * Android intentionally has no desktop workbench fallback. Until a device is
 * paired it exposes no local files, terminals, workspace state, or controls.
 */
export function CompanionMobileApp() {
  const { t } = useTranslation();

  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-sm flex-col justify-center">
        <div className="rounded-3xl border border-border/60 bg-card/70 p-6 shadow-xl">
          <img
            src="/voktty-icon.png"
            alt="Voktty"
            className="mb-5 size-14 rounded-2xl"
          />
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
            Voktty
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {t("companion.mobile.title")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("companion.mobile.description")}
          </p>
          <div className="mt-6 rounded-2xl border border-border/50 bg-background/45 p-4">
            <p className="text-sm font-medium">{t("companion.mobile.agentOnlyTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("companion.mobile.agentOnlyDescription")}
            </p>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("companion.mobile.waitingForPairing")}
          </p>
        </div>
      </div>
    </main>
  );
}
