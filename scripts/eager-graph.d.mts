export const DEFAULT_WATCH: string[];
export function traceEager(
  entry: string,
  watch?: string[],
): {
  moduleCount: number;
  files: string[];
  hits: Map<string, { spec: string; file: string }>;
};
