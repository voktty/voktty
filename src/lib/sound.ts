import { playVokttySound } from "@/modules/sound";

/**
 * Plays the application error cue. Delegates to the Voktty sound engine
 * (uisfx) when enabled, or synthesizes a subtle audio fallback.
 */
export function playErrorTone(): void {
  const played = playVokttySound("error");
  if (played) return;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(240, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.14);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Non-critical audio feedback fallback
  }
}
