import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import {
  CompanionTransport,
  decodeBase64Url,
  encodeBase64Url,
  type AgentState,
  type AgentSummary,
} from "@/modules/companion/transport";
import { groupTranscript } from "@/modules/companion/lib/transcript";
import { ReasoningFold } from "@/modules/companion/ReasoningFold";
import type { Block } from "@/modules/harness/lib/session";
import { Badge } from "panelui-web/badge";
import { Message } from "panelui-web/message";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Logout01Icon,
  QrCodeIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

type Invitation = {
  protocol: number;
  publicUrl: string;
  invitationId: string;
  hostPublicKey: string;
  secret: string;
};

const PROOF_CONTEXT = new TextEncoder().encode("voktty-companion-pair-v1");

async function deriveSessionSecret(invitation: Invitation, privateKey: CryptoKey): Promise<ArrayBuffer> {
  const hostKey = await crypto.subtle.importKey(
    "raw",
    decodeBase64Url(invitation.hostPublicKey).buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return crypto.subtle.deriveBits(
    { name: "ECDH", public: hostKey },
    privateKey,
    256,
  );
}

function lengthPrefix(value: Uint8Array): Uint8Array {
  const prefix = new Uint8Array(8);
  new DataView(prefix.buffer).setBigUint64(0, BigInt(value.length));
  return prefix;
}

async function pairingProof(invitation: Invitation, deviceName: string, deviceKey: string) {
  const encoder = new TextEncoder();
  const fields = [
    PROOF_CONTEXT,
    encoder.encode(invitation.invitationId),
    encoder.encode(deviceName),
    encoder.encode(deviceKey),
  ];
  const payload = new Uint8Array(
    fields.reduce((total, field) => total + 8 + field.length, 0),
  );
  let offset = 0;
  for (const field of fields) {
    payload.set(lengthPrefix(field), offset);
    offset += 8;
    payload.set(field, offset);
    offset += field.length;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64Url(invitation.secret).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, payload.buffer as ArrayBuffer),
  );
}

async function waitForDecision(publicUrl: string, requestId: string): Promise<"approved"> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    const response = await fetch(new URL(`/v1/companion/pair/${encodeURIComponent(requestId)}`, publicUrl));
    if (response.status === 200) return "approved";
    if (response.status !== 202) throw new Error("pairing-rejected");
  }
  throw new Error("pairing-expired");
}

function renderStateBadge(state: AgentState, t: (key: string) => string) {
  switch (state) {
    case "working":
      return (
        <Badge variant="warning" size="sm" dot="pulse">
          {t("companion.mobile.stateWorking")}
        </Badge>
      );
    case "attention":
      return (
        <Badge variant="destructive" size="sm" dot>
          {t("companion.mobile.stateAttention")}
        </Badge>
      );
    case "finished":
      return (
        <Badge variant="success" size="sm" dot>
          {t("companion.mobile.stateFinished")}
        </Badge>
      );
    case "idle":
    default:
      return (
        <Badge variant="secondary" size="sm">
          {t("companion.mobile.stateIdle")}
        </Badge>
      );
  }
}

function renderBlock(
  block: Block,
  onApproval: (grantId: string, approved: boolean) => void,
  isApproving: boolean,
  t: (key: string) => string,
) {
  if (block.role === "user") {
    return (
      <Message from="user">
        <Message.Content>
          <Message.Bubble>
            <Message.BubbleContent className="whitespace-pre-wrap break-words text-xs">
              {block.text}
            </Message.BubbleContent>
          </Message.Bubble>
        </Message.Content>
      </Message>
    );
  }

  const isPendingApproval = block.approval && !block.approval.decided;

  return (
    <div className="mr-auto max-w-[92%] space-y-2">
      {block.text ? (
        <Message from="assistant" streaming={block.streaming === true}>
          <Message.Content>
            <Message.Bubble>
              <Message.BubbleContent className="whitespace-pre-wrap break-words text-xs">
                {block.text}
              </Message.BubbleContent>
            </Message.Bubble>
          </Message.Content>
        </Message>
      ) : null}

      {block.tool ? (
        <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-xs">
          <p className="font-mono text-[11px] font-medium text-muted-foreground">
            {t("companion.mobile.toolExecution")}: {block.tool.title || block.tool.kind || ""}
          </p>
          {block.tool.detail || block.tool.preview?.path || block.tool.preview?.query ? (
            <pre className="mt-1.5 overflow-x-auto rounded bg-background/70 p-2 font-mono text-[10px] text-foreground">
              {block.tool.detail || block.tool.preview?.path || block.tool.preview?.query}
            </pre>
          ) : null}
        </div>
      ) : null}

      {isPendingApproval ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 shadow-sm space-y-2">
          <div className="flex items-center gap-1.5 text-amber-500">
            <HugeiconsIcon icon={AlertCircleIcon} size={15} />
            <p className="text-xs font-semibold">{t("companion.mobile.approvalRequired")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("companion.mobile.approvalDescription")}{" "}
            <span className="font-mono text-foreground">
              {block.tool?.title || block.tool?.kind || block.text || ""}
            </span>
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 flex-1 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
              disabled={isApproving}
              onClick={() => onApproval(String(block.approval?.requestId), true)}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
              <span>{t("companion.mobile.approve")}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 text-xs font-medium"
              disabled={isApproving}
              onClick={() => onApproval(String(block.approval?.requestId), false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
              <span>{t("companion.mobile.deny")}</span>
            </Button>
          </div>
        </div>
      ) : block.approval?.decided ? (
        <div className="rounded-xl border border-border/30 bg-muted/20 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
          {t("companion.mobile.decided")}: {block.approval.decided}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Android intentionally has no desktop workbench fallback. Until a device is
 * paired it exposes no local files, terminals, workspace state, or controls.
 */
export function CompanionMobileApp() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "pending" | "approved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<{ publicUrl: string; sessionId: string } | null>(null);

  const [sessions, setSessions] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "working" | "attention" | "idle">("all");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [promptInput, setPromptInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const transport = useRef<CompanionTransport | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<IScannerControls | null>(null);

  const refreshSessions = useCallback(async () => {
    if (!transport.current || !connectionInfo) return;
    try {
      const response = await transport.current.exchange(
        connectionInfo.publicUrl,
        connectionInfo.sessionId,
        { type: "inventory_subscribe", protocol: 1 },
      );
      if (response.type === "inventory") {
        setSessions(response.agents);
      }
    } catch {
      // Ignore transient polling failure
    }
  }, [connectionInfo]);

  const refreshSnapshot = useCallback(async (agentId: string) => {
    if (!transport.current || !connectionInfo) return;
    try {
      const response = await transport.current.exchange(
        connectionInfo.publicUrl,
        connectionInfo.sessionId,
        { type: "agent_snapshot", protocol: 1, agentId, after: 0 },
      );
      if (response.type === "agent_delta") {
        const parsed = JSON.parse(response.content) as Block[];
        if (Array.isArray(parsed)) {
          setBlocks(parsed);
        }
      }
    } catch {
      // Ignore transient polling failure
    }
  }, [connectionInfo]);

  useEffect(() => {
    if (state !== "approved" || !connectionInfo) return;
    void refreshSessions();
    if (selectedAgentId) {
      void refreshSnapshot(selectedAgentId);
    }
    const interval = window.setInterval(() => {
      void refreshSessions();
      if (selectedAgentId) {
        void refreshSnapshot(selectedAgentId);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [state, connectionInfo, selectedAgentId, refreshSessions, refreshSnapshot]);

  const handleSendPrompt = async () => {
    if (!promptInput.trim() || !selectedAgentId || !transport.current || !connectionInfo || isSending) return;
    const text = promptInput.trim();
    setPromptInput("");
    setIsSending(true);
    try {
      await transport.current.exchange(
        connectionInfo.publicUrl,
        connectionInfo.sessionId,
        {
          type: "agent_message",
          protocol: 1,
          agentId: selectedAgentId,
          message: text,
        },
      );
      await refreshSnapshot(selectedAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  };

  const handleApprovalDecision = async (grantId: string, approved: boolean) => {
    if (!selectedAgentId || !transport.current || !connectionInfo || isApproving) return;
    setIsApproving(true);
    try {
      await transport.current.exchange(
        connectionInfo.publicUrl,
        connectionInfo.sessionId,
        {
          type: "approval_respond",
          protocol: 1,
          agentId: selectedAgentId,
          grantId,
          approved,
        },
      );
      await refreshSnapshot(selectedAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApproving(false);
    }
  };

  const handleDisconnect = () => {
    transport.current = null;
    setConnectionInfo(null);
    setState("idle");
    setSelectedAgentId(null);
    setSessions([]);
    setBlocks([]);
  };

  const connect = async (overridePayload?: string) => {
    const raw = (typeof overridePayload === "string" ? overridePayload : payload).trim();
    if (!raw) return;
    setState("connecting");
    setError(null);
    try {
      const parsed = JSON.parse(raw) as { type?: string; invitation?: Invitation };
      if (parsed.type !== "voktty-companion" || !parsed.invitation) throw new Error("invalid-payload");
      const invitation = parsed.invitation;
      const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
      const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey);
      const deviceName = "Android companion";
      const devicePublicKey = encodeBase64Url(publicKey);
      const proof = await pairingProof(invitation, deviceName, devicePublicKey);
      const response = await fetch(new URL("/v1/companion/pair", invitation.publicUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: invitation.protocol,
          invitationId: invitation.invitationId,
          deviceName,
          devicePublicKey,
          proof,
        }),
      });
      if (response.status !== 202) throw new Error("pairing-rejected");
      const { requestId } = (await response.json()) as { requestId?: string };
      if (!requestId) throw new Error("missing-pairing-request");
      setState("pending");
      const decision = await waitForDecision(invitation.publicUrl, requestId);
      if (decision !== "approved") throw new Error("pairing-rejected");
      const secret = await deriveSessionSecret(invitation, pair.privateKey);
      const session = await CompanionTransport.forAndroid(secret, requestId);
      const confirmation = await fetch(
        new URL(`/v1/companion/session/${encodeURIComponent(requestId)}/confirm`, invitation.publicUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await session.confirm()),
        },
      );
      if (!confirmation.ok) throw new Error("session-confirmation-failed");
      await session.acceptConfirmation((await confirmation.json()) as Parameters<CompanionTransport["acceptConfirmation"]>[0]);
      transport.current = session;
      setConnectionInfo({ publicUrl: invitation.publicUrl, sessionId: requestId });
      setState("approved");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleScanResult = useCallback((code: string) => {
    if (!code) return;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(80);
      }
    } catch {
      // ignore
    }
    setPayload(code);
    setScanning(false);
    void connect(code);
  }, []);

  useEffect(() => {
    if (!scanning) {
      scannerRef.current?.stop();
      scannerRef.current = null;
      return;
    }

    let active = true;
    let localStream: MediaStream | null = null;
    let frameId: number | null = null;

    async function startScanner() {
      try {
        if (!videoRef.current) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
        if (!active || !videoRef.current) return;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        }

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream = stream;

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});

        // 1. Hardware accelerated native BarcodeDetector if available
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          try {
            const detector = new (window as unknown as {
              BarcodeDetector: new (opts: { formats: string[] }) => {
                detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
              };
            }).BarcodeDetector({ formats: ["qr_code"] });

            let detecting = true;
            const scanFrame = async () => {
              if (!detecting || !active || !video) return;
              try {
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                  const barcodes = await detector.detect(video);
                  if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                    detecting = false;
                    handleScanResult(barcodes[0].rawValue);
                    return;
                  }
                }
              } catch {
                // frame detection pass skipped
              }
              if (detecting && active) {
                frameId = requestAnimationFrame(scanFrame);
              }
            };
            frameId = requestAnimationFrame(scanFrame);

            scannerRef.current = {
              stop: () => {
                detecting = false;
                if (frameId) cancelAnimationFrame(frameId);
                stream.getTracks().forEach((t) => t.stop());
                video.srcObject = null;
              },
            };
            return;
          } catch {
            // fallback to ZXing below
          }
        }

        // 2. ZXing continuous scanner fallback
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 80,
        });
        const controls = await reader.decodeFromStream(
          stream,
          video,
          (result) => {
            if (!result || !active) return;
            handleScanResult(result.getText());
          },
        );
        if (!active) {
          controls.stop();
        } else {
          scannerRef.current = {
            stop: () => {
              controls.stop();
              stream.getTracks().forEach((t) => t.stop());
              video.srcObject = null;
            },
          };
        }
      } catch (err) {
        if (!active) return;
        console.error("Camera scanner error:", err);
        setScanning(false);
        setError(t("companion.mobile.cameraError"));
      }
    }

    void startScanner();

    return () => {
      active = false;
      if (frameId) cancelAnimationFrame(frameId);
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, [scanning, t, handleScanResult]);

  const stopScanner = () => {
    setScanning(false);
  };

  const scan = () => {
    setError(null);
    setScanning(true);
  };

  if (state === "approved") {
    const selectedSession = sessions.find((s) => s.agentId === selectedAgentId);
    const filteredSessions = sessions.filter((s) => {
      if (filter === "all") return true;
      if (filter === "working") return s.state === "working";
      if (filter === "attention") return s.state === "attention";
      if (filter === "idle") return s.state === "idle" || s.state === "finished";
      return true;
    });

    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/50 bg-background/90 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <img src="/voktty-icon.png" alt="Voktty" className="size-7 rounded-lg" />
            <div>
              <p className="text-xs font-semibold tracking-tight text-foreground">
                {t("companion.mobile.title")}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-medium text-muted-foreground">
                  {t("companion.mobile.directLan")}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleDisconnect}
          >
            <HugeiconsIcon icon={Logout01Icon} size={14} />
            <span>{t("companion.mobile.disconnect")}</span>
          </Button>
        </header>

        {selectedAgentId ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2.5 backdrop-blur-md">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                onClick={() => setSelectedAgentId(null)}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={15} />
                <span>{t("companion.mobile.backToSessions")}</span>
              </Button>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pl-1">
                <p className="truncate text-xs font-semibold text-foreground">
                  {selectedSession?.title || selectedAgentId}
                </p>
                {selectedSession ? renderStateBadge(selectedSession.state, t) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-24">
              {blocks.length === 0 ? (
                <p className="pt-8 text-center text-xs text-muted-foreground">
                  {selectedSession?.title || selectedAgentId}
                </p>
              ) : (
                groupTranscript(blocks).map((item) =>
                  item.kind === "reasoning" ? (
                    <ReasoningFold
                      key={`reasoning-${item.id}`}
                      text={item.text}
                      streaming={item.streaming}
                      label={t("companion.mobile.thinking")}
                      liveLabel={t("companion.mobile.thinkingLive")}
                    />
                  ) : (
                    <div key={item.block.id} className="space-y-1.5">
                      {renderBlock(item.block, handleApprovalDecision, isApproving, t)}
                    </div>
                  ),
                )
              )}
            </div>

            <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-border/60 bg-background/95 p-3 backdrop-blur-md">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSendPrompt();
                }}
                className="mx-auto flex max-w-lg items-center gap-2"
              >
                <Input
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder={t("companion.mobile.inputPlaceholder")}
                  disabled={isSending}
                  className="h-10 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!promptInput.trim() || isSending}
                  className="h-10 shrink-0 gap-1 px-3"
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={16} />
                </Button>
              </form>
            </footer>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="flex gap-1.5 overflow-x-auto p-4 pb-2">
              {(["all", "working", "attention", "idle"] as const).map((key) => {
                const count =
                  key === "all"
                    ? sessions.length
                    : key === "working"
                      ? sessions.filter((s) => s.state === "working").length
                      : key === "attention"
                        ? sessions.filter((s) => s.state === "attention").length
                        : sessions.filter((s) => s.state === "idle" || s.state === "finished").length;
                const label =
                  key === "all"
                    ? t("companion.mobile.filterAll")
                    : key === "working"
                      ? t("companion.mobile.filterWorking")
                      : key === "attention"
                        ? t("companion.mobile.filterAttention")
                        : t("companion.mobile.filterIdle");
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                        active
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-background/60 text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2.5 p-4 pt-2">
              {filteredSessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
                  {t("companion.mobile.noActiveSessions")}
                </div>
              ) : (
                filteredSessions.map((session) => (
                  <button
                    key={session.agentId}
                    type="button"
                    onClick={() => setSelectedAgentId(session.agentId)}
                    className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-card/60 p-4 text-left shadow-sm transition active:scale-[0.99] hover:bg-card/90"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
                        {session.provider}
                      </span>
                      {renderStateBadge(session.state, t)}
                    </div>
                    <p className="line-clamp-2 text-sm font-medium text-foreground">
                      {session.title || session.agentId}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-sm flex-col justify-center">
        <div className="rounded-3xl border border-border/60 bg-card/70 p-5 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <img
              src="/voktty-icon.png"
              alt="Voktty"
              className="size-11 rounded-xl shadow-sm"
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Voktty
              </p>
              <h1 className="text-lg font-semibold tracking-tight">
                {t("companion.mobile.title")}
              </h1>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t("companion.mobile.description")}
          </p>

          <div className="mt-3.5 rounded-xl border border-border/50 bg-background/50 p-3">
            <p className="text-xs font-medium text-foreground">{t("companion.mobile.agentOnlyTitle")}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t("companion.mobile.agentOnlyDescription")}
            </p>
          </div>

          {state === "pending" ? (
            <div className="mt-6 flex flex-col items-center py-6 text-center">
              <div className="relative flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <HugeiconsIcon icon={Loading03Icon} size={28} className="animate-spin" />
              </div>
              <h2 className="mt-4 text-sm font-semibold tracking-tight">
                {t("companion.mobile.waitingForApprovalTitle")}
              </h2>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {t("companion.mobile.waitingForApprovalDesc")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setState("idle");
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {scanning ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative aspect-square w-full max-w-[260px] overflow-hidden rounded-2xl border-2 border-primary/40 bg-black shadow-inner">
                    <video
                      ref={videoRef}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                    />
                    {/* Reticle corner accents */}
                    <div className="pointer-events-none absolute inset-3">
                      <span className="absolute top-0 left-0 size-4 border-t-2 border-l-2 border-primary rounded-tl" />
                      <span className="absolute top-0 right-0 size-4 border-t-2 border-r-2 border-primary rounded-tr" />
                      <span className="absolute bottom-0 left-0 size-4 border-b-2 border-l-2 border-primary rounded-bl" />
                      <span className="absolute bottom-0 right-0 size-4 border-b-2 border-r-2 border-primary rounded-br" />
                      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary/40 shadow-[0_0_8px_rgba(var(--primary),0.8)] animate-pulse" />
                    </div>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("companion.mobile.scanQrPrompt")}
                  </p>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={stopScanner}
                  >
                    {t("companion.mobile.stopScanning")}
                  </Button>
                </div>
              ) : (
                <Button
                  size="lg"
                  className="w-full gap-2 py-5 text-xs font-semibold shadow-sm"
                  onClick={scan}
                >
                  <HugeiconsIcon icon={QrCodeIcon} size={18} />
                  <span>{t("companion.mobile.scanQr")}</span>
                </Button>
              )}

              <div className="relative flex items-center justify-center py-1">
                <div className="w-full border-t border-border/50" />
                <span className="absolute bg-card px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("companion.mobile.payloadLabel")}
                </span>
              </div>

              <div className="space-y-2">
                <Textarea
                  id="companion-payload"
                  className="min-h-20 text-xs font-mono"
                  value={payload}
                  onChange={(event) => setPayload(event.target.value)}
                  placeholder={t("companion.mobile.payloadPlaceholder")}
                  disabled={state === "connecting"}
                />
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!payload.trim() || state === "connecting"}
                  onClick={() => void connect()}
                >
                  {state === "connecting"
                    ? t("companion.mobile.connecting")
                    : t("companion.mobile.connect")}
                </Button>
              </div>

              {state === "error" && error ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-2.5 text-center text-xs text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
