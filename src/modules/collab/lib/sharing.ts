import {
  publishHostedTerminal,
  startHostedTerminal,
  stopHostedTerminal,
} from "@/modules/collab/lib/host";
import { synchronizeHostedTerminalSnapshot } from "@/modules/collab/lib/snapshot";
import type {
  HostedTerminalInvite,
  PublishedCollabTunnel,
} from "@/modules/collab/types";

export type HostedTerminalTarget = {
  leafId: number;
  ptyId: number;
  cols: number;
  rows: number;
  fileCitationRoot?: string | null;
};

export type HostedShare = {
  invite: HostedTerminalInvite;
  tunnel: PublishedCollabTunnel;
};

type HostedShareDependencies = {
  start: typeof startHostedTerminal;
  snapshot: typeof synchronizeHostedTerminalSnapshot;
  publish: typeof publishHostedTerminal;
  stop: typeof stopHostedTerminal;
};

const defaultDependencies: HostedShareDependencies = {
  start: startHostedTerminal,
  snapshot: synchronizeHostedTerminalSnapshot,
  publish: publishHostedTerminal,
  stop: stopHostedTerminal,
};

export async function createHostedShare(
  target: HostedTerminalTarget,
  dependencies: HostedShareDependencies = defaultDependencies,
  customPath?: string,
): Promise<HostedShare> {
  const invite = target.fileCitationRoot
    ? await dependencies.start(
        target.ptyId,
        target.cols,
        target.rows,
        target.fileCitationRoot,
      )
    : await dependencies.start(target.ptyId, target.cols, target.rows);
  try {
    await dependencies.snapshot(target.leafId, target.ptyId);
    const tunnel = await dependencies.publish(target.ptyId, customPath);
    return { invite, tunnel };
  } catch (error) {
    await dependencies.stop(target.ptyId).catch(() => false);
    throw error;
  }
}
