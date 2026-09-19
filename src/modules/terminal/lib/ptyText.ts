/**
 * Streaming UTF-8 decoder for one PTY session.
 *
 * PTY chunks are cut at byte offsets the shell knows nothing about, so a
 * multi-byte character routinely straddles two of them. Decoding each chunk
 * with a fresh decoder turns both halves into U+FFFD, which the terminal grid
 * never shows (xterm receives the raw bytes) but every text consumer does:
 * the progress parser and the dev-server URL detector read the corrupted text.
 *
 * State is per session. A decoder shared between leaves would carry one
 * terminal's pending bytes into another terminal's output.
 */
export class PtyTextDecoder {
  private decoder: TextDecoder | null = null;

  decode(bytes: Uint8Array): string {
    this.decoder ??= new TextDecoder("utf-8", { fatal: false });
    return this.decoder.decode(bytes, { stream: true });
  }

  /**
   * Drops any bytes held back mid-character. Called when the stream restarts
   * (respawn, reconnect) so a truncated sequence cannot prefix fresh output.
   */
  reset(): void {
    this.decoder = null;
  }
}
