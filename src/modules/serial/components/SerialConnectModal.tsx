import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/modules/i18n";
import {
  AlertCircleIcon,
  CpuIcon,
  Refresh01Icon,
  Settings01Icon,
  UsbIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { listSerialPorts } from "../serialApi";
import {
  COMMON_BAUD_RATES,
  type SerialConnectionConfig,
  type SerialPortDescriptor,
} from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: SerialConnectionConfig) => void;
};

export function SerialConnectModal({ open, onOpenChange, onConnect }: Props) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<SerialPortDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPort, setSelectedPort] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [customBaud, setCustomBaud] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(8);
  const [parity, setParity] = useState<"none" | "odd" | "even">("none");
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [flowControl, setFlowControl] = useState<
    "none" | "software" | "hardware"
  >("none");
  const [error, setError] = useState<string | null>(null);

  const fetchPorts = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSerialPorts();
      setPorts(list);
      if (list.length > 0) {
        if (!selectedPort || !list.some((p) => p.port_name === selectedPort)) {
          setSelectedPort(list[0].port_name);
        }
      } else {
        setSelectedPort("__custom__");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchPorts();
      setError(null);
    }
  }, [open]);

  const handleConnect = () => {
    const portName =
      selectedPort === "__custom__"
        ? customPort.trim()
        : selectedPort.trim();

    if (!portName) {
      setError(t("serial.errors.portRequired"));
      return;
    }

    let finalBaud = baudRate;
    if (baudRate === 0) {
      const parsed = parseInt(customBaud.trim(), 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        setError(
          t("serial.errors.invalidBaudRate"),
        );
        return;
      }
      finalBaud = parsed;
    }

    onConnect({
      portName,
      baudRate: finalBaud,
      dataBits,
      flowControl,
      parity,
      stopBits,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card text-card-foreground border-border shadow-2xl p-6">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <HugeiconsIcon icon={UsbIcon} size={18} strokeWidth={1.75} />
            </div>
            <DialogTitle className="text-base font-semibold">
              {t("serial.modalTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("serial.modalSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-destructive/10 text-destructive text-xs">
            <HugeiconsIcon icon={AlertCircleIcon} size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Port Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">
            {t("serial.port")}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                onClick={() => void fetchPorts()}
                disabled={loading}
              >
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={12}
                  className={loading ? "animate-spin text-primary" : ""}
                />
                {t("serial.refresh")}
              </Button>
            </div>

            {ports.length > 0 ? (
              <Select value={selectedPort} onValueChange={setSelectedPort}>
                <SelectTrigger className="w-full text-xs h-9 bg-background/50 border-input">
                  <SelectValue placeholder={t("serial.selectPort")} />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {ports.map((p) => {
                    const desc = [
                      p.product || p.manufacturer,
                      p.vid ? `VID:${p.vid.toString(16).padStart(4, "0")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" - ");

                    return (
                      <SelectItem
                        key={p.port_name}
                        value={p.port_name}
                        className="text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <HugeiconsIcon
                            icon={p.port_type === "USB" ? UsbIcon : CpuIcon}
                            size={13}
                            className="text-muted-foreground"
                          />
                          <span className="font-mono font-medium">
                            {p.port_name}
                          </span>
                          {desc && (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                              ({desc})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                  <SelectItem value="__custom__" className="text-xs text-muted-foreground">
                    + {t("serial.customPort")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-1.5">
                <Input
                  className="text-xs h-9 font-mono"
                  placeholder={
                    navigator.userAgent.includes("Win")
                      ? "COM3"
                      : "/dev/ttyUSB0"
                  }
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("serial.noPortsDetected")}
                </p>
              </div>
            )}

            {selectedPort === "__custom__" && ports.length > 0 && (
              <Input
                className="text-xs h-9 font-mono mt-1.5"
                placeholder={
                  navigator.userAgent.includes("Win") ? "COM1" : "/dev/ttyUSB0"
                }
                value={customPort}
                onChange={(e) => setCustomPort(e.target.value)}
              />
            )}
          </div>

          {/* Baud Rate Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">
              {t("serial.baudRate")}
            </Label>
            <Select
              value={String(baudRate)}
              onValueChange={(val) => setBaudRate(parseInt(val, 10))}
            >
              <SelectTrigger className="w-full text-xs h-9 bg-background/50 border-input font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-56 font-mono">
                {COMMON_BAUD_RATES.map((rate) => (
                  <SelectItem key={rate} value={String(rate)} className="text-xs">
                    {rate} {rate === 115200 ? `(${t("serial.default")})` : ""}
                  </SelectItem>
                ))}
                <SelectItem value="0" className="text-xs">
                  {t("serial.customBaud")}
                </SelectItem>
              </SelectContent>
            </Select>

            {baudRate === 0 && (
              <Input
                className="text-xs h-9 font-mono mt-1.5"
                type="number"
                placeholder="250000"
                value={customBaud}
                onChange={(e) => setCustomBaud(e.target.value)}
              />
            )}
          </div>

          {/* Advanced options toggle */}
          <div className="pt-1">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <HugeiconsIcon icon={Settings01Icon} size={13} />
              <span>
                {showAdvanced
                  ? t("serial.hideAdvanced")
                  : t("serial.showAdvanced")}
              </span>
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 mt-3 p-3 rounded-lg bg-muted/40 border border-border/50 text-xs">
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {t("serial.advanced.dataBits")}
                  </Label>
                  <Select
                    value={String(dataBits)}
                    onValueChange={(v) =>
                      setDataBits(parseInt(v, 10) as 5 | 6 | 7 | 8)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8">{t("serial.advanced.bits", { count: 8 })}</SelectItem>
                      <SelectItem value="7">{t("serial.advanced.bits", { count: 7 })}</SelectItem>
                      <SelectItem value="6">{t("serial.advanced.bits", { count: 6 })}</SelectItem>
                      <SelectItem value="5">{t("serial.advanced.bits", { count: 5 })}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {t("serial.advanced.parity")}
                  </Label>
                  <Select
                    value={parity}
                    onValueChange={(v) =>
                      setParity(v as "none" | "odd" | "even")
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("serial.advanced.none")}</SelectItem>
                      <SelectItem value="even">{t("serial.advanced.even")}</SelectItem>
                      <SelectItem value="odd">{t("serial.advanced.odd")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {t("serial.advanced.stopBits")}
                  </Label>
                  <Select
                    value={String(stopBits)}
                    onValueChange={(v) =>
                      setStopBits(parseInt(v, 10) as 1 | 2)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t("serial.advanced.bit", { count: 1 })}</SelectItem>
                      <SelectItem value="2">{t("serial.advanced.bits", { count: 2 })}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {t("serial.advanced.flowControl")}
                  </Label>
                  <Select
                    value={flowControl}
                    onValueChange={(v) =>
                      setFlowControl(v as "none" | "software" | "hardware")
                    }
                  >
                    <SelectTrigger className="h-8 text-xs font-mono mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("serial.advanced.none")}</SelectItem>
                      <SelectItem value="hardware">{t("serial.advanced.hardware")}</SelectItem>
                      <SelectItem value="software">{t("serial.advanced.software")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={UsbIcon} size={14} />
            {t("serial.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
