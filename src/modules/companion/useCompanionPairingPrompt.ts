import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import {
  type CompanionPairingRequestedPayload,
  useCompanionPairingStore,
} from "./useCompanionPairingStore";

export type { CompanionPairingRequestedPayload };

export function useCompanionPairingPrompt(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<CompanionPairingRequestedPayload>(
      "companion:pairing-requested",
      (event) => {
        const { id, deviceName, fingerprint } = event.payload;
        if (!id) return;

        useCompanionPairingStore.getState().setPendingRequest(event.payload);

        const toastId = `companion-pairing-${id}`;
        toast.info(t("companion.pairing.promptTitle", { device: deviceName }), {
          id: toastId,
          description: t("companion.pairing.promptDesc", { fingerprint }),
          duration: 120_000,
          action: {
            label: t("companion.pairing.allow"),
            onClick: () => {
              void invoke("companion_decide_pairing", {
                requestId: id,
                approved: true,
              })
                .then(() => {
                  toast.success(
                    t("companion.pairing.allowedSuccess", { device: deviceName }),
                  );
                })
                .catch((error) => {
                  toast.error(String(error));
                });
            },
          },
          cancel: {
            label: t("companion.pairing.deny"),
            onClick: () => {
              void invoke("companion_decide_pairing", {
                requestId: id,
                approved: false,
              }).catch(() => {});
            },
          },
        });
      },
    )
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
