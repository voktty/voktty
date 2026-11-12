import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IS_MAC } from "@/lib/platform";
import { useTranslation } from "@/modules/i18n";
import { useSshConnections } from "@/modules/ssh/sshStore";
import { SectionHeader } from "@/settings/components/SectionHeader";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectComputerUse, type DetectState } from "./lib/detect";
import {
  COMPUTER_USE_INSTALL_COMMAND,
  COMPUTER_USE_INSTALL_EVENT,
  COMPUTER_USE_VERSION,
  type ComputerUseTarget,
} from "./lib/probe";

const THIS_COMPUTER = "__local__";
const DOCS_URL =
  "https://github.com/iFurySt/open-computer-use/blob/main/skills/open-computer-use/references/installation.md";

export function ComputerUseSection() {
  const { t } = useTranslation();
  const connections = useSshConnections();
  const [hostKey, setHostKey] = useState(THIS_COMPUTER);
  const [state, setState] = useState<DetectState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [started, setStarted] = useState(false);
  const generation = useRef(0);

  const target: ComputerUseTarget = {
    hostId: hostKey === THIS_COMPUTER ? null : hostKey,
  };
  const saved = connections.find((c) => c.id === target.hostId);
  const hostName =
    target.hostId === null
      ? t("settings.computerUse.thisComputer")
      : saved?.name || saved?.host || target.hostId;
  // On macOS `doctor` can open the system permission prompts, so it only runs
  // when the user asks for it.
  const localMac = target.hostId === null && IS_MAC;

  const check = useCallback(
    async (runDoctor: boolean) => {
      const run = ++generation.current;
      setState(null);
      const next = await detectComputerUse(
        { hostId: hostKey === THIS_COMPUTER ? null : hostKey },
        runDoctor,
      );
      if (run === generation.current) setState(next);
    },
    [hostKey],
  );

  useEffect(() => {
    setStarted(false);
    void check(!(hostKey === THIS_COMPUTER && IS_MAC));
    return () => {
      generation.current++;
    };
  }, [check, hostKey]);

  const install = () => {
    setConfirming(false);
    void emit(COMPUTER_USE_INSTALL_EVENT, { hostId: target.hostId });
    setStarted(true);
  };

  const probe = state?.kind === "result" ? state.probe : null;
  const canInstall =
    probe?.status === "not-installed" || probe?.status === "unusable";

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("settings.computerUse.title")}
        description={t("settings.computerUse.description")}
      />

      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted-foreground">
          {t("settings.computerUse.target")}
        </span>
        <Select value={hostKey} onValueChange={setHostKey}>
          <SelectTrigger size="sm" className="h-8 w-56 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={THIS_COMPUTER} className="text-[12px]">
              {t("settings.computerUse.thisComputer")}
            </SelectItem>
            {connections.map((connection) => (
              <SelectItem
                key={connection.id}
                value={connection.id}
                className="text-[12px]"
              >
                {connection.name || connection.host}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void check(!localMac)}
        >
          {t("settings.computerUse.refresh")}
        </Button>
      </div>

      <div
        className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3 text-[12px]"
        aria-live="polite"
      >
        {state === null ? (
          <p className="text-muted-foreground">
            {t("settings.computerUse.checking")}
          </p>
        ) : state.kind === "helper-outdated" ? (
          <p role="alert">{t("settings.computerUse.helperOutdated")}</p>
        ) : state.kind === "unknown-host" ? (
          <p role="alert">{t("settings.computerUse.unknownHost")}</p>
        ) : state.kind === "error" ? (
          <p role="alert" className="text-destructive">
            {t("settings.computerUse.error", { message: state.message })}
          </p>
        ) : (
          <>
            <p className="font-medium">
              {state.probe.status === "not-installed"
                ? t("settings.computerUse.notInstalled")
                : state.probe.status === "unusable"
                  ? t("settings.computerUse.unusable")
                  : state.probe.status === "doctor-problem"
                    ? t("settings.computerUse.doctorProblem", {
                        version: state.probe.version ?? "",
                      })
                    : t("settings.computerUse.installed", {
                        version: state.probe.version ?? "",
                      })}
            </p>
            {state.probe.status === "not-installed" ? (
              <p className="text-muted-foreground">
                {t("settings.computerUse.notInstalledHint")}
              </p>
            ) : null}
            {state.probe.status === "installed" ? (
              <p className="text-muted-foreground">
                {t("settings.computerUse.installedHint")}
              </p>
            ) : null}
            {state.probe.path ? (
              <p className="break-all text-muted-foreground">
                {t("settings.computerUse.path", { path: state.probe.path })}
              </p>
            ) : null}
            {state.probe.error ? (
              <p className="text-muted-foreground">{state.probe.error}</p>
            ) : null}
            {state.probe.doctor ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {t("settings.computerUse.diagnostics")}
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                  {state.probe.doctor}
                </pre>
              </div>
            ) : null}
            {state.probe.doctor === null &&
            state.probe.status === "installed" ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {t("settings.computerUse.diagnosticsSkipped")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void check(true)}
                >
                  {t("settings.computerUse.runDiagnostics")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {canInstall ? (
        <div className="space-y-2">
          <Button size="sm" onClick={() => setConfirming(true)}>
            {t("settings.computerUse.install", {
              version: COMPUTER_USE_VERSION,
            })}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.computerUse.noAccessNote")}
          </p>
        </div>
      ) : null}
      {started ? (
        <p className="text-[12px] text-muted-foreground" role="status">
          {t("settings.computerUse.installStarted")}
        </p>
      ) : null}

      {IS_MAC ? (
        <div className="space-y-1 rounded-xl border border-border/60 p-3 text-[12px]">
          <p className="font-medium">{t("settings.computerUse.macTitle")}</p>
          <p className="text-muted-foreground">
            {t("settings.computerUse.macBody")}
          </p>
        </div>
      ) : null}
      <Button
        size="sm"
        variant="link"
        className="h-auto p-0 text-[12px]"
        onClick={() => void openUrl(DOCS_URL).catch(() => {})}
      >
        {t("settings.computerUse.docs")}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.computerUse.installTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.computerUse.installDescription", {
                where: hostName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[12px]">
            {COMPUTER_USE_INSTALL_COMMAND}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("settings.computerUse.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={install}>
              {t("settings.computerUse.installConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
