/**
 * What a terminal tab should be called when the shell reports a new OSC title.
 *
 * The shell reports its foreground process, so a hand-launched agent labels its
 * own tab. That used to be promoted to a permanent `customTitle`, which also
 * short-circuits every later update: the tab kept the agent's name, and the
 * icon derived from it, long after the agent exited, across cwd changes and
 * across restarts, on directories where the agent was never run.
 *
 * The label is held by the live agent signal instead. It lasts exactly as long
 * as the agent does, and nothing is written that outlives it.
 */

export type TerminalTitleDecision =
  | { kind: "keep" }
  | { kind: "rename"; title: string };

export type TerminalTitleInput = {
  /** A user rename or a launcher label. Always wins. */
  customTitle?: string | null;
  currentTitle: string;
  incomingTitle: string;
  /** The live per-pty detector says an agent owns this terminal right now. */
  agentActive: boolean;
  /** Label when the incoming title itself names an agent, else null. */
  agentLabel?: string | null;
};

export function planTerminalTitle(
  input: TerminalTitleInput,
): TerminalTitleDecision {
  if (input.customTitle) return { kind: "keep" };

  // A prompt repaint or a cd must not rename the tab under a running agent.
  if (input.agentActive) return { kind: "keep" };

  const next = input.agentLabel ?? input.incomingTitle;
  return next === input.currentTitle
    ? { kind: "keep" }
    : { kind: "rename", title: next };
}
