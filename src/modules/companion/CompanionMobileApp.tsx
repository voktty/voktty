import { useTranslation } from "@/modules/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CompanionTransport,
  decodeBase64Url,
  encodeBase64Url,
} from "@/modules/companion/transport";
import { useRef, useState } from "react";

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

/**
 * Android intentionally has no desktop workbench fallback. Until a device is
 * paired it exposes no local files, terminals, workspace state, or controls.
 */
export function CompanionMobileApp() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "pending" | "approved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const transport = useRef<CompanionTransport | null>(null);

  const connect = async () => {
    setState("connecting");
    setError(null);
    try {
      const parsed = JSON.parse(payload) as { type?: string; invitation?: Invitation };
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
      setState("approved");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

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
          {state === "pending" || state === "approved" ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              {state === "pending"
                ? t("companion.mobile.waitingForApproval")
                : t("companion.mobile.paired")}
            </p>
          ) : (
            <div className="mt-6">
              <label className="text-xs font-medium" htmlFor="companion-payload">
                {t("companion.mobile.payloadLabel")}
              </label>
              <Textarea
                id="companion-payload"
                className="mt-2 min-h-24 text-xs"
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                placeholder={t("companion.mobile.payloadPlaceholder")}
                disabled={state === "connecting"}
              />
              <Button
                className="mt-3 w-full"
                disabled={!payload.trim() || state === "connecting"}
                onClick={() => void connect()}
              >
                {state === "connecting"
                  ? t("companion.mobile.connecting")
                  : t("companion.mobile.connect")}
              </Button>
              {state === "error" && error ? (
                <p className="mt-3 text-center text-xs text-destructive">
                  {t("companion.mobile.connectionError")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
