import type { CloudflaredStatus } from "@/modules/collab/types";
import { invoke } from "@tauri-apps/api/core";

export function verifyCloudflared(
  customPath?: string,
): Promise<CloudflaredStatus> {
  return invoke<CloudflaredStatus>("collab_cloudflared_status", {
    customPath: customPath?.trim() || null,
  });
}
