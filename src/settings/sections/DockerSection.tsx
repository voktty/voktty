import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/modules/i18n";
import {
  setDockerCustomHost,
  setDockerDefaultShell,
  setDockerEnabled,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useDockerStore } from "@/modules/docker";
import {
  CheckmarkCircle02Icon,
  RefreshIcon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function DockerSection() {
  const { t } = useTranslation();
  const prefs = usePreferencesStore();
  const dockerEnabled = prefs.dockerEnabled;
  const dockerCustomHost = prefs.dockerCustomHost;
  const dockerDefaultShell = prefs.dockerDefaultShell;

  const { status, pingDaemon } = useDockerStore();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (dockerEnabled) {
      pingDaemon(dockerCustomHost);
    }
  }, [dockerEnabled, dockerCustomHost]);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await pingDaemon(dockerCustomHost);
      if (res.connected) {
        setTestResult(t("settings.docker.connected"));
      } else {
        setTestResult(res.error || t("docker.daemonNotRunning"));
      }
    } catch (e) {
      setTestResult(String(e));
    } finally {
      setTesting(false);
    }
  };

  const isConnected = status?.connected ?? false;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.docker.title")}
        description={t("settings.docker.subtitle")}
      />

      <div className="rounded-xl border border-border/40 bg-card/60 divide-y divide-border/30 overflow-hidden">
        {/* Enable Toggle */}
        <SettingRow
          title={t("settings.docker.enable")}
          description={t("settings.docker.enableDesc")}
        >
          <Switch
            checked={dockerEnabled}
            onCheckedChange={(checked) => void setDockerEnabled(checked)}
          />
        </SettingRow>

        {/* Connection Status & Test */}
        {dockerEnabled && (
          <div className="p-4 space-y-3 bg-muted/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={isConnected ? CheckmarkCircle02Icon : UnavailableIcon}
                  className={`size-4 ${isConnected ? "text-emerald-400" : "text-amber-400"}`}
                />
                <span className="text-xs font-medium">
                  {isConnected
                    ? t("settings.docker.connected")
                    : t("settings.docker.disconnected")}
                </span>
                {status?.version && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    v{status.version}
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleTestConnection}
                disabled={testing}
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  className={`size-3.5 ${testing ? "animate-spin" : ""}`}
                />
                {t("settings.docker.testConnection")}
              </Button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs font-mono border ${
                  isConnected
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                }`}
              >
                {testResult}
              </div>
            )}
          </div>
        )}

        {/* Custom Socket / Host */}
        {dockerEnabled && (
          <SettingRow
            title={t("settings.docker.customHost")}
            description={t("settings.docker.customHostDesc")}
          >
            <div className="w-72">
              <Input
                value={dockerCustomHost}
                onChange={(e) => void setDockerCustomHost(e.target.value)}
                placeholder={t("settings.docker.customHostPlaceholder")}
                className="h-8 text-xs font-mono"
              />
            </div>
          </SettingRow>
        )}

        {/* Default Container Shell */}
        {dockerEnabled && (
          <SettingRow
            title={t("settings.docker.defaultShell")}
            description={t("settings.docker.defaultShellDesc")}
          >
            <div className="w-48">
              <Input
                value={dockerDefaultShell}
                onChange={(e) => void setDockerDefaultShell(e.target.value)}
                placeholder="/bin/sh"
                className="h-8 text-xs font-mono"
              />
            </div>
          </SettingRow>
        )}
      </div>
    </div>
  );
}
