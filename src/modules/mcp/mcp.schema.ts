import { z } from "zod";
import type { McpServerConfig } from "./types";

const boundedText = (max: number) =>
  z.string().min(1).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const base = {
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
  name: boundedText(128),
  enabled: z.boolean(),
  automaticReadTools: z.array(boundedText(128)).max(256).optional(),
};

const stdioServerSchema = z
  .object({
    ...base,
    authMode: z.literal("none"),
    transport: z
      .object({
        kind: z.literal("stdio"),
        executable: boundedText(8 * 1024),
        args: z.array(boundedText(8 * 1024)).max(128),
        cwd: boundedText(8 * 1024),
        authorizedRoot: boundedText(8 * 1024),
      })
      .strict(),
  })
  .strict();

const httpServerSchema = z
  .object({
    ...base,
    authMode: z.enum(["none", "bearer", "oauth"]),
    oauthClientId: boundedText(1024).optional(),
    oauthScopes: z.array(boundedText(256).refine((value) => !/\s/.test(value))).max(32).optional(),
    transport: z
      .object({
        kind: z.literal("http"),
        endpoint: z.url().max(8 * 1024),
        allowPrivateNetwork: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authMode === "oauth" && !value.oauthClientId) {
      context.addIssue({ code: "custom", path: ["oauthClientId"], message: "" });
    }
    if (value.authMode !== "oauth" && (value.oauthClientId || value.oauthScopes?.length)) {
      context.addIssue({ code: "custom", path: ["authMode"], message: "" });
    }
  });

export const mcpServerSchema = z.union([stdioServerSchema, httpServerSchema]);

export function parseStoredMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 64)
    .map((entry) => mcpServerSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data as McpServerConfig);
}
