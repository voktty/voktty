import { useEffect, useRef, useState } from "react";
import { defaultNetworkAllowlist } from "../lib/networkSandboxDefaults";
import type { HarnessId, NetworkSandboxConfig } from "../lib/session";
import { Shield, ShieldOff } from "./icons";
import { Popover } from "./Popover";

type Props = {
  harness: HarnessId;
  value: NetworkSandboxConfig | undefined;
  onChange: (config: NetworkSandboxConfig) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 300;

export function NetworkSandboxPicker({
  harness,
  value,
  onChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const enabled = value?.enabled === true;
  const allowlist = value?.allowlist ?? [];
  const [draft, setDraft] = useState(() => allowlist.join("\n"));

  useEffect(() => {
    if (open) setDraft(allowlist.join("\n"));
  }, [open, allowlist]);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  const commitDraft = (text: string) => {
    setDraft(text);
    const hosts = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    onChange({ enabled: true, allowlist: hosts });
  };

  const setEnabled = (next: boolean) => {
    if (next && allowlist.length === 0) {
      const seeded = defaultNetworkAllowlist(harness);
      setDraft(seeded.join("\n"));
      onChange({ enabled: true, allowlist: seeded });
      return;
    }
    onChange({ enabled: next, allowlist });
  };

  const Icon = enabled ? Shield : ShieldOff;
  const label = enabled ? "Network sandbox: On" : "Network sandbox: Off";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title="Restrict this session's outbound network to an allowed host list"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={`flex h-6.5 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-content/10 text-content"
            : "bg-content/10 text-content hover:bg-content/15"
        }`}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label="Network sandbox"
          className="p-2"
        >
          <div className="mb-2 flex items-center gap-1 rounded-lg bg-content/5 p-0.5">
            <button
              type="button"
              onClick={() => setEnabled(false)}
              className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium ${
                !enabled
                  ? "bg-content/15 text-content"
                  : "text-content/60 hover:text-content"
              }`}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => setEnabled(true)}
              className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium ${
                enabled
                  ? "bg-content/15 text-content"
                  : "text-content/60 hover:text-content"
              }`}
            >
              On
            </button>
          </div>
          {enabled ? (
            <>
              <p className="mb-1 text-[11px] leading-4 text-content/50">
                One host per line. Prefix with <code>*.</code> to allow any
                subdomain. Nothing else can be reached.
              </p>
              <textarea
                value={draft}
                onChange={(e) => commitDraft(e.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full resize-none rounded-md border border-content/10 bg-content/5 p-1.5 font-mono text-[11px] text-content outline-none focus:border-content/30"
              />
            </>
          ) : (
            <p className="text-[11px] leading-4 text-content/50">
              The agent's outbound network is unrestricted.
            </p>
          )}
        </Popover>
      ) : null}
    </div>
  );
}
