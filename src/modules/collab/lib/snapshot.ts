import {
  beginHostedSnapshotBarrier,
  setHostedSnapshot,
} from "@/modules/collab/lib/host";
import { captureLeafCollaborationSnapshot } from "@/modules/terminal/lib/rendererPool";
import {
  createSnapshotBarrierToken,
  registerSnapshotBarrier,
} from "@/modules/terminal/lib/snapshotBarrier";

export async function synchronizeHostedTerminalSnapshot(
  leafId: number,
  ptyId: number,
): Promise<void> {
  const token = createSnapshotBarrierToken();
  const barrier = registerSnapshotBarrier(leafId, token);
  try {
    const sequence = await beginHostedSnapshotBarrier(ptyId, token);
    await barrier.reached;
    const captured = await captureLeafCollaborationSnapshot(leafId);
    await setHostedSnapshot(
      ptyId,
      sequence,
      captured.cols,
      captured.rows,
      captured.snapshot,
    );
  } finally {
    barrier.cancel();
  }
}
