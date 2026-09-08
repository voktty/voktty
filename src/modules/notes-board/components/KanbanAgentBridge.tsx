import {
  useKanbanAgentBridge,
  type KanbanBridgeOptions,
} from "../lib/useKanbanAgentBridge";

export function KanbanAgentBridge(props: KanbanBridgeOptions) {
  useKanbanAgentBridge(props);
  return null;
}
