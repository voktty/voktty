import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { DiscoveredSkill } from "@/modules/harness/lib/fs";
import type { LspCustomServer } from "@/modules/settings/store";
import {
  detectProjectStack,
  type ProjectStackInfo,
} from "@/modules/statusbar/lib/detectProjectStack";
import {
  DEFAULT_PROJECT_TOOLS,
  ensureToolsConfigTarget,
  loadToolsConfigSnapshot,
} from "@/modules/statusbar/lib/toolsConfigFile";
import { LOCAL_WORKSPACE } from "@/modules/workspace";

export function useProjectToolkit({
  cwd,
  workspace,
  sourceKey,
  customServers,
  openFile,
  onError,
  enabled = true,
}: {
  cwd: string | null | undefined;
  workspace: WorkspaceEnv;
  sourceKey?: string;
  customServers: LspCustomServer[];
  openFile?: (path: string, workspace: WorkspaceEnv) => void;
  onError?: () => void;
  enabled?: boolean;
}) {
  const [tools, setTools] = useState(DEFAULT_PROJECT_TOOLS);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [stackInfo, setStackInfo] = useState<ProjectStackInfo | null>(null);
  const [configFilePath, setConfigFilePath] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const binding = useMemo(
    () => ({ cwd, workspace, sourceKey, openFile }),
    [cwd, workspace, sourceKey, openFile],
  );
  const activity = useMemo(() => ({ binding, enabled }), [binding, enabled]);
  const configPublication = useMemo(
    () => ({ binding, configFilePath, configLoaded }),
    [binding, configFilePath, configLoaded],
  );
  const publishedConfig = useRef<object | null>(null);
  useLayoutEffect(() => {
    publishedConfig.current = configPublication;
    return () => {
      if (publishedConfig.current === configPublication)
        publishedConfig.current = null;
    };
  }, [configPublication]);
  const owner = useRef<{ activity: typeof activity; current: boolean } | null>(
    null,
  );
  const pending = useRef(new Set<object>());
  const latestTools = useRef<object | null>(null);
  const latestSkills = useRef<object | null>(null);
  useLayoutEffect(() => {
    const receipt = { activity, current: enabled };
    owner.current = receipt;
    return () => {
      receipt.current = false;
      if (owner.current === receipt) owner.current = null;
    };
  }, [activity, enabled]);
  const admit = useCallback(() => {
    const receipt = owner.current;
    if (
      !receipt?.current ||
      receipt.activity !== activity ||
      pending.current.size >= 256
    )
      return null;
    const request = {};
    pending.current.add(request);
    return {
      request,
      current: () => receipt.current && owner.current === receipt,
      release: () => {
        pending.current.delete(request);
      },
    };
  }, [activity]);
  const reloadTools = useCallback(async () => {
    const receipt = admit();
    if (!receipt) return;
    latestTools.current = receipt.request;
    const current = () =>
      receipt.current() && latestTools.current === receipt.request;
    try {
      const { tools: loaded, target } = await loadToolsConfigSnapshot(
        cwd,
        workspace,
        current,
      );
      if (!current()) return;
      setTools(loaded);
      setConfigFilePath(target.path);
      setConfigLoaded(true);
    } catch {
      if (current()) {
        setTools(DEFAULT_PROJECT_TOOLS);
        setConfigFilePath(null);
        setConfigLoaded(true);
      }
    } finally {
      receipt.release();
    }
  }, [admit, cwd, workspace]);
  const localSkills =
    workspace.kind === "local" && !cwd?.startsWith("remote://");
  const reloadSkills = useCallback(async () => {
    const receipt = admit();
    if (!receipt) return;
    latestSkills.current = receipt.request;
    const current = () =>
      receipt.current() && latestSkills.current === receipt.request;
    try {
      if (!cwd || !localSkills) {
        if (current()) setSkills([]);
        return;
      }
      const { listSkills } = await import("@/modules/harness/lib/fs");
      if (!current()) return;
      const list = await listSkills(cwd);
      if (current()) setSkills(list);
    } catch {
      if (current()) setSkills([]);
    } finally {
      receipt.release();
    }
  }, [admit, cwd, localSkills]);
  const resetBinding = useRef(binding);
  useLayoutEffect(() => {
    if (resetBinding.current === binding) return;
    resetBinding.current = binding;
    setTools(DEFAULT_PROJECT_TOOLS);
    setSkills([]);
    setConfigFilePath(null);
    setConfigLoaded(false);
    setStackInfo(null);
  }, [binding]);
  useEffect(() => {
    void reloadTools();
    void reloadSkills();
  }, [reloadTools, reloadSkills]);
  useEffect(() => {
    const receipt = admit();
    if (!receipt) return;
    let active = true;
    void detectProjectStack(cwd, customServers, workspace)
      .then((result) => {
        if (active && receipt.current()) setStackInfo(result);
      })
      .catch(() => {
        if (active && receipt.current()) setStackInfo(null);
      })
      .finally(receipt.release);
    return () => {
      active = false;
    };
  }, [admit, cwd, customServers, workspace]);
  const editConfig = useCallback(async () => {
    if (
      !openFile ||
      !configPublication.configLoaded ||
      !configPublication.configFilePath ||
      publishedConfig.current !== configPublication ||
      configPublication.configFilePath.startsWith("remote://")
    )
      return false;
    const receipt = admit();
    if (!receipt) return false;
    try {
      const target = await ensureToolsConfigTarget(
        cwd,
        workspace,
        receipt.current,
      );
      if (
        !receipt.current() ||
        !openFile ||
        target.path.startsWith("remote://")
      )
        return false;
      openFile(target.path, target.workspace);
      return receipt.current();
    } catch {
      if (receipt.current()) onError?.();
      return false;
    } finally {
      receipt.release();
    }
  }, [admit, cwd, workspace, openFile, onError, configPublication]);
  const openSkill = useCallback(
    (path: string) => {
      if (
        !owner.current?.current ||
        owner.current.activity !== activity ||
        !localSkills ||
        !openFile
      )
        return false;
      const receipt = owner.current;
      openFile(path, LOCAL_WORKSPACE);
      return receipt.current && owner.current === receipt;
    },
    [activity, localSkills, openFile],
  );
  return {
    tools,
    skills,
    stackInfo,
    configFilePath,
    reloadTools,
    reloadSkills,
    editConfig,
    openSkill,
    skillsDisabledReason: localSkills ? undefined : "workspace.localMachine",
    editDisabledReason: !configLoaded
      ? "common.loading"
      : !openFile || !configFilePath || configFilePath.startsWith("remote://")
        ? "feedback.editorUnavailable"
        : undefined,
  };
}
