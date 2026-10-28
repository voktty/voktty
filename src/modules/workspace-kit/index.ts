export { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
export {
  parseKitTemplate,
  renderKitTemplate,
} from "@/modules/workspace-kit/lib/template";
export type {
  KitFile,
  KitTemplate,
} from "@/modules/workspace-kit/lib/template";
export { planKitDeployment } from "@/modules/workspace-kit/lib/deployment";
export { prepareKitDeployment } from "@/modules/workspace-kit/lib/lock";
export {
  instructionFingerprint,
  buildMemoryContext,
} from "@/modules/workspace-kit/lib/context";
export type {
  InstructionFingerprint,
  MemoryContextPacket,
  MemoryContextResult,
} from "@/modules/workspace-kit/lib/context";
export { memoryProjectKey } from "@/modules/workspace-kit/lib/identity";
export { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
export type {
  NativeMemorySelection,
  NativeMemoryScope,
} from "@/modules/workspace-kit/lib/nativeMemory";
export { resolveMemoryScope } from "@/modules/workspace-kit/lib/scope";
export type { MemoryScope } from "@/modules/workspace-kit/lib/scope";
export { evaluateMemoryUse } from "@/modules/workspace-kit/lib/policy";
export type {
  MemoryUsePolicy,
  MemoryUseDecision,
} from "@/modules/workspace-kit/lib/policy";
export {
  inspectMemoryText,
  measureMemory,
} from "@/modules/workspace-kit/lib/memory";
export type {
  MemoryText,
  MemoryMeasurement,
  HandoffInventory,
} from "@/modules/workspace-kit/lib/memory";
export type {
  KitPathFact,
  KitDeploymentEntry,
} from "@/modules/workspace-kit/lib/deployment";
export {
  parseAgentRoster,
  parseKitConfig,
  parseKitLock,
} from "@/modules/workspace-kit/lib/validation";
export type { KitValidationCode } from "@/modules/workspace-kit/lib/validation";
export type {
  AgentDefinition,
  AgentRoster,
  AgentRuntime,
  KitConfig,
  KitLock,
  KitValues,
} from "@/modules/workspace-kit/lib/configTypes";
