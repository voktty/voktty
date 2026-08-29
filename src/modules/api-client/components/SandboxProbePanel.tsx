import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useTranslation } from "@/modules/i18n";
import {
  Copy01Icon,
  PlayIcon,
  Shield01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { generateWebhookMarkdownReceipt } from "../lib/markdownReceipt";
import { WEBHOOK_PRESETS } from "../lib/presets";
import { useApiClientStore } from "../store/apiClientStore";

export function SandboxProbePanel() {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const {
    webhookConfig,
    webhookResult,
    isDispatchingWebhook,
    setWebhookTargetUrl,
    setWebhookPayload,
    setWebhookSecret,
    setWebhookDuplicateCount,
    applyWebhookPreset,
    triggerWebhookDispatch,
  } = useApiClientStore();

  const [selectedPresetId, setSelectedPresetId] = useState(WEBHOOK_PRESETS[0].id);
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(webhookConfig.payload, null, 2),
  );

  const presetLabelKeys: Record<string, string> = {
    "stripe-payment-intent-succeeded": "apiClient.sandbox.presets.stripePaymentIntentSucceeded",
    "stripe-charge-failed": "apiClient.sandbox.presets.stripeChargeFailed",
    "stripe-charge-refunded": "apiClient.sandbox.presets.stripeChargeRefunded",
    "github-push": "apiClient.sandbox.presets.githubPush",
    "supabase-user-created": "apiClient.sandbox.presets.supabaseUserCreated",
    "resend-email-delivered": "apiClient.sandbox.presets.resendEmailDelivered",
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = WEBHOOK_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      applyWebhookPreset(preset);
      setPayloadText(JSON.stringify(preset.payload, null, 2));
    }
  };

  const handlePayloadChange = (text: string) => {
    setPayloadText(text);
    try {
      const parsed = JSON.parse(text);
      setWebhookPayload(parsed);
    } catch {
      // Keep invalid JSON in text state until valid
    }
  };

  const handleCopyReceipt = () => {
    if (!webhookResult) return;
    const receipt = generateWebhookMarkdownReceipt(webhookResult);
    void navigator.clipboard.writeText(receipt);
    toast.success(t("apiClient.sandbox.receiptCopied"));
  };

  const handleFixWithAi = () => {
    if (!webhookResult) return;
    const prompt = `Help me fix my webhook handler:
- Service: ${webhookResult.service}
- Event: ${webhookResult.eventType}
- Target: ${webhookResult.targetUrl}
- Idempotency Test Result: ${webhookResult.isIdempotent ? "Passed" : "FAILED (Duplicate execution error or duplicate state created)"}
- Summary: ${webhookResult.summary}
- Attempt details:
${webhookResult.attempts.map((a) => `Attempt #${a.attempt}: HTTP ${a.status} (${a.durationMs.toFixed(1)}ms) - Output: ${a.responseBody.slice(0, 300)}`).join("\n")}

Please inspect my webhook route, implement atomic deduplication / idempotency check by event ID, and ensure duplicate webhooks return 200 OK without double processing.`;

    const chat = useChatStore.getState();
    if (!chat.activeSessionId) {
      chat.newSession();
    }
    chat.openPanel();
    chat.focusInput(prompt);
  };

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
      {/* Left Column: Webhook & Probe Config */}
      <div className="flex h-full flex-col overflow-y-auto p-3 bg-background/50">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Shield01Icon} size={15} className="text-primary" />
            <span className="text-xs font-semibold text-foreground">{t("apiClient.sandbox.title")}</span>
          </div>
          <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400">
            {t("apiClient.sandbox.simulator")}
          </Badge>
        </div>

        {/* Preset Selector */}
        <div className="mb-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("apiClient.sandbox.selectPreset")}</span>
          <Select value={selectedPresetId} onValueChange={handleSelectPreset}>
            <SelectTrigger className="h-8 text-xs font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBHOOK_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {t(presetLabelKeys[p.id] ?? "apiClient.sandbox.selectPreset")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target URL */}
        <div className="mb-2.5 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("apiClient.sandbox.localWebhookUrl")}</span>
          <Input
            value={webhookConfig.targetUrl}
            onChange={(e) => setWebhookTargetUrl(e.target.value)}
            placeholder="http://localhost:3000/api/webhooks/stripe"
            className="h-8 font-mono text-xs"
          />
        </div>

        {/* Secret for HMAC Signatures */}
        <div className="mb-2.5 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("apiClient.sandbox.signingSecret")}
          </span>
          <Input
            type="password"
            value={webhookConfig.secret ?? ""}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_..."
            className="h-8 font-mono text-xs"
          />
        </div>

        {/* Probe Mode: 1x vs 3x Idempotency */}
        <div className="mb-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("apiClient.sandbox.deliveryMode")}</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWebhookDuplicateCount(1)}
              className={cn(
                "flex flex-col items-start rounded border p-2 text-left transition-colors",
                (webhookConfig.duplicateCount ?? 1) === 1
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              <span className="text-xs font-semibold">{t("apiClient.sandbox.singleDelivery")}</span>
              <span className="text-[10px]">{t("apiClient.sandbox.singleDeliveryDescription")}</span>
            </button>

            <button
              type="button"
              onClick={() => setWebhookDuplicateCount(3)}
              className={cn(
                "flex flex-col items-start rounded border p-2 text-left transition-colors",
                (webhookConfig.duplicateCount ?? 1) > 1
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              <span className="text-xs font-semibold">{t("apiClient.sandbox.idempotencyProbe")}</span>
              <span className="text-[10px]">{t("apiClient.sandbox.idempotencyProbeDescription")}</span>
            </button>
          </div>
        </div>

        {/* Payload JSON Editor */}
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("apiClient.sandbox.payload")}</span>
          <textarea
            value={payloadText}
            onChange={(e) => handlePayloadChange(e.target.value)}
            className="min-h-36 flex-1 resize-none rounded border border-border/60 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-primary"
            dir="ltr"
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={isDispatchingWebhook || !webhookConfig.targetUrl.trim()}
            onClick={() => void triggerWebhookDispatch()}
            className="h-8 gap-1.5 px-4 text-xs font-semibold"
          >
            <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
            <span>{isDispatchingWebhook ? t("apiClient.sandbox.dispatching") : t("apiClient.sandbox.dispatch")}</span>
          </Button>
        </div>
      </div>

      {/* Right Column: Dispatch Results & Diagnostics */}
      <div className="flex h-full flex-col bg-background/50 p-3 overflow-y-auto">
        <div className="mb-2 flex items-center justify-between border-b border-border/50 pb-2">
          <span className="text-xs font-semibold text-foreground">{t("apiClient.sandbox.results")}</span>
          {webhookResult && (
            <Button size="sm" variant="ghost" onClick={handleCopyReceipt} className="h-6 gap-1 text-[10.5px]">
              <HugeiconsIcon icon={Copy01Icon} size={11} /> {t("apiClient.sandbox.copyReceipt")}
            </Button>
          )}
        </div>

        {!webhookResult ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground/60">
            <HugeiconsIcon icon={Shield01Icon} size={28} className="opacity-30" />
            <span className="text-xs font-medium">{t("apiClient.sandbox.ready")}</span>
            <span className="max-w-xs text-[11px]">
              {t("apiClient.sandbox.emptyDescription")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Status Card */}
            <div
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3",
                webhookResult.isIdempotent
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {webhookResult.isIdempotent ? t("apiClient.sandbox.passed") : t("apiClient.sandbox.failed")}
                </span>
                <Badge variant={webhookResult.isIdempotent ? "default" : "destructive"} className="text-[10px]">
                  {webhookResult.isIdempotent ? t("apiClient.sandbox.verified") : t("apiClient.sandbox.fixNeeded")}
                </Badge>
              </div>
              <p className="text-[11.5px] leading-relaxed opacity-90">{webhookResult.summary}</p>
            </div>

            {/* AI Fix Trigger if failed */}
            {!webhookResult.isIdempotent && aiAvailable && (
              <Button
                size="sm"
                onClick={handleFixWithAi}
                className="h-8 gap-1.5 bg-gradient-to-r from-indigo-600 to-cyan-600 text-xs font-semibold text-white shadow hover:opacity-90"
              >
                <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={2} />
                <span>{t("apiClient.sandbox.fixWithAi")}</span>
              </Button>
            )}

            {/* Delivery Attempts List */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">{t("apiClient.sandbox.deliveryAttempts")}</span>
              {webhookResult.attempts.map((att) => (
                <div
                  key={att.attempt}
                  className="flex flex-col gap-1 rounded border border-border/50 bg-muted/20 p-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{t("apiClient.sandbox.attempt", { count: att.attempt })}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-muted-foreground">{att.durationMs.toFixed(1)} ms</span>
                      <Badge
                        variant={att.success ? "outline" : "destructive"}
                        className={cn("text-[10px]", att.success && "border-emerald-500/40 text-emerald-600")}
                      >
                        HTTP {att.status}
                      </Badge>
                    </div>
                  </div>
                  <pre className="max-h-28 overflow-y-auto rounded bg-background/60 p-1.5 font-mono text-[10.5px] text-foreground" dir="ltr">
                    {att.responseBody}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
