import { homeDir } from "../fs";
import { setHarnessModels } from "../models";
import { execChild, resolveFxBinary } from "./child";
import { modelsFromFxOutput } from "./fxProtocol";

let inflight: Promise<void> | null = null;

export function refreshFxCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverFxModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("fx", models);
    })
    .catch((error: unknown) => {
      console.debug("[monocode] fx catalog", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function discoverFxModels() {
  const { path } = await resolveFxBinary();
  const cwd = await homeDir();
  const stdout = await execChild(path, ["models", "--json"], cwd);
  return modelsFromFxOutput(stdout);
}
