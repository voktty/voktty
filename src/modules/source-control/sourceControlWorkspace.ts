import { createContext, useContext } from "react";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

export const SourceControlWorkspace = createContext<WorkspaceEnv | undefined>(undefined);

export function useSourceControlWorkspace() {
  const explicit = useContext(SourceControlWorkspace);
  const ambient = useWorkspaceEnvStore((state) => state.env);
  return explicit ?? ambient;
}
