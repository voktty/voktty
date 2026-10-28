import {
  parseKitTemplate,
  type KitTemplate,
} from "@/modules/workspace-kit/lib/template";

const resources = import.meta.glob<string>(
  [
    "/templates/workspace-kit/manifest.json",
    "/templates/workspace-kit/placeholders.json",
    "/templates/workspace-kit/dot-voktty/**/*",
    "/templates/workspace-kit/dot-voktty/.gitignore",
    "/templates/workspace-kit/root/*",
  ],
  { query: "?raw", import: "default" },
);

export async function loadKitTemplate(): Promise<KitTemplate> {
  const entries = await Promise.all(
    Object.entries(resources).map(
      async ([path, read]) =>
        [path.replace("/templates/workspace-kit/", ""), await read()] as const,
    ),
  );
  return parseKitTemplate(Object.fromEntries(entries));
}
