import { createContext, useContext } from "react";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

export type MarkdownDocContextValue = {
  docPath: string;
  workspaceEnv: WorkspaceEnv;
};

export const MarkdownDocContext = createContext<MarkdownDocContextValue>({
  docPath: "",
  workspaceEnv: LOCAL_WORKSPACE,
});

export const useMarkdownDoc = () => useContext(MarkdownDocContext);
