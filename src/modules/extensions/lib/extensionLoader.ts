import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveExtension,
  ExtensionContext,
  ExtensionInfo,
  ExtensionModule,
} from "../types";
import { createVokttyApi } from "./vokttyApi";

export async function loadExtension(
  info: ExtensionInfo,
): Promise<ActiveExtension> {
  const context: ExtensionContext = {
    subscriptions: [],
    extensionPath: info.folder_path,
    storagePath: info.folder_path,
  };

  const vokttyApi = createVokttyApi();

  try {
    const rawCode = await invoke<string>("extensions_read_code", {
      entryPath: info.entry_path,
    });

    const moduleExports: ExtensionModule = {};
    const moduleObj = { exports: moduleExports };

    // Support both CommonJS / bundled format and standard exports
    const runner = new Function(
      "voktty",
      "context",
      "exports",
      "module",
      `"use strict";\n${rawCode}\n;return module.exports;`,
    );

    const result = runner(vokttyApi, context, moduleExports, moduleObj);
    const mod: ExtensionModule =
      result && typeof result === "object" ? result : moduleObj.exports;

    if (typeof mod.activate === "function") {
      const ACTIVATION_TIMEOUT_MS = 5_000;
      const activationTimeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Extension "${info.id}" activate() timed out after ${ACTIVATION_TIMEOUT_MS}ms`)),
          ACTIVATION_TIMEOUT_MS,
        ),
      );
      await Promise.race([Promise.resolve(mod.activate(context, vokttyApi)), activationTimeout]);
    }

    return {
      info,
      context,
      module: mod,
      status: "active",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Cleanup any partial subscriptions created before error
    for (const sub of context.subscriptions) {
      try {
        sub.dispose();
      } catch {
        // ignore cleanup error
      }
    }
    return {
      info,
      context: { subscriptions: [], extensionPath: info.folder_path, storagePath: info.folder_path },
      module: {},
      status: "error",
      error: errorMsg,
    };
  }
}

export async function unloadExtension(
  instance: ActiveExtension,
): Promise<void> {
  if (typeof instance.module.deactivate === "function") {
    try {
      await Promise.resolve(instance.module.deactivate());
    } catch {
      // ignore deactivation errors on shutdown
    }
  }

  for (const sub of instance.context.subscriptions) {
    try {
      sub.dispose();
    } catch {
      // ignore disposal errors
    }
  }
  instance.context.subscriptions = [];
  instance.status = "disabled";
}
