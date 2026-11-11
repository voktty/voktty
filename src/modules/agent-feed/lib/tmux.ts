const TMUX_TARGET = /^([A-Za-z0-9_.-]{1,64}):(@\d{1,9})(?:\.%\d{1,9})?$/;

/**
 * `forgenex:@11.%11` -> `tmux attach-session -t 'forgenex:@11'`. Only plain
 * session names and numeric window ids are accepted, so the command is safe
 * to paste into a shell.
 */
export function tmuxAttachCommand(target: string): string | null {
  const match = TMUX_TARGET.exec(target.trim());
  if (!match) return null;
  return `tmux attach-session -t '${match[1]}:${match[2]}'`;
}
