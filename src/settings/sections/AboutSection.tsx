import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import { useUpdater } from "@/modules/updater";
import { GithubIcon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getName, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const REPO_URL = "https://github.com/voktty/voktty";
const WEBSITE = "https://voktty.dev";

const PLATFORM_LABEL: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
};

export function AboutSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [_name, setName] = useState("Voktty");
  const [build, setBuild] = useState("");
  const { status, check, install } = useUpdater({ autoCheck: false });
  const checking = status.kind === "checking";
  const downloading = status.kind === "downloading";
  const available = status.kind === "available";
  const manualAvailable = status.kind === "manual-available";
  const ready = status.kind === "ready";
  const checkLabel =
    status.kind === "uptodate"
      ? t("settings.about.upToDate")
      : status.kind === "error"
        ? t("settings.about.checkFailed")
        : checking
          ? t("settings.about.checking")
          : downloading
            ? t("settings.about.downloading")
            : ready
              ? t("settings.about.restartToInstall")
              : available
                ? t("settings.about.installVersion", { version: status.update.version })
                : manualAvailable
                  ? t("settings.about.updateToVersion", { version: status.info.version })
                  : t("settings.about.checkForUpdates");
  const onUpdateClick = () => {
    if (available) void install();
    else void check({ manual: true });
  };

  useEffect(() => {
    void getVersion().then(setVersion);
    void getName().then(setName);
    try {
      const p = platform();
      const a = arch();
      const platformLabel = PLATFORM_LABEL[p] ?? p;
      setBuild(`${platformLabel} · ${a}`);
    } catch {
      setBuild("");
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("settings.about.title")}
        description={t("settings.about.description")}
      />

      {/* Splash Hero Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-[#0B0F19] shadow-xl">
        <div className="relative w-full aspect-[3/1] max-h-48 overflow-hidden">
          <img
            src="/logo-splash.svg"
            alt={t("settings.about.splashAlt")}
            className="w-full h-full object-cover select-none pointer-events-none"
            draggable={false}
          />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/40 bg-card/70 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
            <span className="font-mono text-xs font-semibold text-foreground">
              v{version || "—"}
            </span>
            {build && (
              <span className="font-mono text-[11px] text-muted-foreground">
                ({build})
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            dev.voktty
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[12px]">
        <dt className="text-muted-foreground">{t("settings.about.build")}</dt>
        <dd className="font-mono text-[11.5px]">
          {build ? `${build} · v${version}` : `v${version}`}
        </dd>

        <dt className="text-muted-foreground">{t("settings.about.bundleId")}</dt>
        <dd className="font-mono text-[11.5px]">dev.voktty</dd>

        <dt className="text-muted-foreground">{t("settings.about.license")}</dt>
        <dd>Apache 2.0</dd>

        <dt className="text-muted-foreground">{t("settings.about.sourceCode")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(REPO_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            voktty/voktty
          </button>
        </dd>
        <dt className="text-muted-foreground">{t("settings.about.website")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(WEBSITE)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={Globe02Icon} size={12} strokeWidth={1.75} />
            voktty.dev
          </button>
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onUpdateClick}
            disabled={checking || downloading || ready}
          >
            {checkLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPO_URL)}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            {t("settings.about.viewOnGithub")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(`${REPO_URL}/issues/new`)}
          >
            {t("settings.about.reportIssue")}
          </Button>
        </div>
        {status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/80">
            {status.message}
          </p>
        )}
        {downloading && status.contentLength ? (
          <p className="text-[11px] text-muted-foreground">
            {Math.min(
              100,
              Math.round((status.downloaded / status.contentLength) * 100),
            )}
            %
          </p>
        ) : null}
      </div>
    </div>
  );
}
