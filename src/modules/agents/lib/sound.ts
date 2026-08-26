import { playVokttySound } from "@/modules/sound";

export function playAgentNotificationSound(): void {
  playVokttySound("notification", { retrigger: "restart" });
}
