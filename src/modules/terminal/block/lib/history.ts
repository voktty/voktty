import { invoke } from "@tauri-apps/api/core";

export type VokttyHistoryEntry = {
  cmd: string;
  count: number;
  last: number;
  shell_type?: string;
  category?: string;
};

export function historySuggest(
  line: string,
  shellType?: string,
): Promise<string | null> {
  return invoke<string | null>("history_suggest", {
    line,
    shellType: shellType ?? null,
  }).catch(() => null);
}

export function historyCommands(
  prefix: string,
  limit = 50,
): Promise<string[]> {
  return invoke<string[]>("history_commands", { prefix, limit }).catch(
    () => [],
  );
}

export function historyList(
  query: string,
  shellType?: string,
  limit = 200,
): Promise<VokttyHistoryEntry[]> {
  return invoke<VokttyHistoryEntry[]>("history_list", {
    query,
    shellType: shellType ?? null,
    limit,
  }).catch(() => []);
}

export function historyRecord(
  command: string,
  shellType?: string,
  category?: string,
): void {
  void invoke("history_record", {
    command,
    shellType: shellType ?? null,
    category: category ?? null,
  }).catch(() => {});
}

export function historyExport(): Promise<string> {
  return invoke<string>("history_export").catch(() => "[]");
}

export function historyImport(jsonData: string): Promise<number> {
  return invoke<number>("history_import", { jsonData });
}

export function historyDeleteEntry(command: string): Promise<boolean> {
  return invoke<boolean>("history_delete_entry", { command }).catch(
    () => false,
  );
}

export function historyClear(shellType?: string): Promise<number> {
  return invoke<number>("history_clear", {
    shellType: shellType ?? null,
  }).catch(() => 0);
}
