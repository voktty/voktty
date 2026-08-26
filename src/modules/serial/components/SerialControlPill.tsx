import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { CpuIcon, UsbIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";
import { setSerialSignals } from "../serialApi";

type Props = {
  workspaceEnv?: WorkspaceEnv;
  activeLeafId?: number;
};

export function SerialControlPill({ workspaceEnv, activeLeafId }: Props) {
  const { t } = useTranslation();
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const [pulsing, setPulsing] = useState(false);

  if (workspaceEnv?.kind !== "serial") return null;

  const { portName, baudRate, dataBits = 8, parity = "none", stopBits = 1 } = workspaceEnv;
  const parityChar = parity === "even" ? "E" : parity === "odd" ? "O" : "N";
  const formatStr = `${dataBits}${parityChar}${stopBits}`;

  const handleToggleDtr = async () => {
    if (activeLeafId === undefined) return;
    const ptyId = ptyIdForLeaf(activeLeafId);
    if (!ptyId) return;
    const next = !dtr;
    setDtr(next);
    await setSerialSignals(ptyId, { dtr: next });
  };

  const handleToggleRts = async () => {
    if (activeLeafId === undefined) return;
    const ptyId = ptyIdForLeaf(activeLeafId);
    if (!ptyId) return;
    const next = !rts;
    setRts(next);
    await setSerialSignals(ptyId, { rts: next });
  };

  const handlePulseReset = async () => {
    if (activeLeafId === undefined || pulsing) return;
    const ptyId = ptyIdForLeaf(activeLeafId);
    if (!ptyId) return;
    setPulsing(true);
    try {
      // Common ESP32/Arduino hardware reset sequence via DTR/RTS
      await setSerialSignals(ptyId, { dtr: false, rts: true });
      await new Promise((r) => setTimeout(r, 100));
      await setSerialSignals(ptyId, { dtr: true, rts: false });
      await new Promise((r) => setTimeout(r, 50));
      await setSerialSignals(ptyId, { dtr: true, rts: true });
      setDtr(true);
      setRts(true);
    } finally {
      setPulsing(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 border border-border/40 text-[11px] font-mono">
      <div className="flex items-center gap-1 text-primary">
        <HugeiconsIcon icon={UsbIcon} size={12} />
        <span className="font-semibold">{portName}</span>
      </div>
      <span className="text-muted-foreground text-[10px]">
        {baudRate} {formatStr}
      </span>

      <div className="h-3 w-px bg-border/60 mx-0.5" />

      {/* DTR Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void handleToggleDtr()}
            className={`px-1 rounded text-[10px] font-bold transition-colors ${
              dtr
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            DTR
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("serial.toggleDtr")}
        </TooltipContent>
      </Tooltip>

      {/* RTS Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void handleToggleRts()}
            className={`px-1 rounded text-[10px] font-bold transition-colors ${
              rts
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            RTS
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("serial.toggleRts")}
        </TooltipContent>
      </Tooltip>

      {/* Reset Pulse */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handlePulseReset()}
            disabled={pulsing}
            className="h-4 px-1 text-[10px] text-muted-foreground hover:text-foreground gap-0.5"
          >
            <HugeiconsIcon icon={CpuIcon} size={10} className={pulsing ? "animate-pulse text-amber-500" : ""} />
            <span>{t("serial.resetBoard")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("serial.pulseReset")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
