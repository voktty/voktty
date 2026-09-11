export type StartupBudgetEntry = {
  html: string;
  maxResources?: number;
  maxGzipBytes?: number;
  forbiddenAssets?: string[];
};

export type StartupBudgetConfig = { entries: StartupBudgetEntry[] };

export type StartupResource = {
  path: string;
  bytes: number;
  gzipBytes: number;
};

export type StartupBudgetResult = {
  html: string;
  resources: StartupResource[];
  externalResources: string[];
  rawBytes: number;
  gzipBytes: number;
  topResources: StartupResource[];
};

export function analyzeStartupEntry(
  outputDir: string,
  entry: StartupBudgetEntry,
): StartupBudgetResult;
export function checkStartupBudget(
  config: StartupBudgetConfig,
  outputDir?: string,
): StartupBudgetResult[];
