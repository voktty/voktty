import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVaultStore } from "./vaultStore";

// Mock @tauri-apps/plugin-store LazyStore
const mockStorage = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => {
  return {
    LazyStore: class {
      get(key: string) {
        return Promise.resolve(mockStorage.get(key) ?? null);
      }
      set(key: string, value: unknown) {
        mockStorage.set(key, value);
        return Promise.resolve();
      }
      delete(key: string) {
        mockStorage.delete(key);
        return Promise.resolve();
      }
      save() {
        return Promise.resolve();
      }
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("vaultStore", () => {
  beforeEach(() => {
    mockStorage.clear();
    useVaultStore.setState({
      isConfigured: false,
      isUnlocked: false,
      items: [],
      error: null,
      isBusy: false,
    });
  });

  it("initializes vault with master password", async () => {
    const store = useVaultStore.getState();
    const success = await store.initializeVault("MasterPassword123!");

    expect(success).toBe(true);
    expect(useVaultStore.getState().isConfigured).toBe(true);
    expect(useVaultStore.getState().isUnlocked).toBe(true);
    expect(useVaultStore.getState().items).toHaveLength(0);
    expect(mockStorage.has("vault_record")).toBe(true);
  });

  it("adds and persists keys in unlocked vault", async () => {
    const store = useVaultStore.getState();
    await store.initializeVault("MasterPassword123!");

    const added = await useVaultStore.getState().addItem({
      name: "Prod SSH Key",
      type: "ssh_key",
      secret: "-----BEGIN PRIVATE KEY-----\nMY-SECRET-SSH-KEY\n-----END PRIVATE KEY-----",
      publicKey: "ssh-rsa AAAAB3... prod-server",
      description: "Main server key",
    });

    expect(added).not.toBeNull();
    expect(added?.name).toBe("Prod SSH Key");
    expect(useVaultStore.getState().items).toHaveLength(1);
    expect(useVaultStore.getState().items[0].secret).toContain("MY-SECRET-SSH-KEY");
  });

  it("locks and clears in-memory items", async () => {
    const store = useVaultStore.getState();
    await store.initializeVault("MasterPassword123!");
    await useVaultStore.getState().addItem({
      name: "Secret Token",
      type: "token",
      secret: "token-12345",
    });

    expect(useVaultStore.getState().items).toHaveLength(1);

    useVaultStore.getState().lockVault();

    expect(useVaultStore.getState().isUnlocked).toBe(false);
    expect(useVaultStore.getState().items).toHaveLength(0);
  });

  it("unlocks vault with master password and restores items", async () => {
    const store = useVaultStore.getState();
    await store.initializeVault("MasterPassword123!");
    await useVaultStore.getState().addItem({
      name: "API Secret",
      type: "api_key",
      secret: "sk-my-api-key-999",
    });

    useVaultStore.getState().lockVault();
    expect(useVaultStore.getState().isUnlocked).toBe(false);

    // Unlock with correct password
    const unlockSuccess = await useVaultStore
      .getState()
      .unlockVault("MasterPassword123!");
    expect(unlockSuccess).toBe(true);
    expect(useVaultStore.getState().isUnlocked).toBe(true);
    expect(useVaultStore.getState().items).toHaveLength(1);
    expect(useVaultStore.getState().items[0].secret).toBe("sk-my-api-key-999");
  });

  it("fails to unlock with wrong password", async () => {
    const store = useVaultStore.getState();
    await store.initializeVault("MasterPassword123!");

    useVaultStore.getState().lockVault();

    const unlockSuccess = await useVaultStore
      .getState()
      .unlockVault("WrongPassword999!");
    expect(unlockSuccess).toBe(false);
    expect(useVaultStore.getState().isUnlocked).toBe(false);
    expect(useVaultStore.getState().items).toHaveLength(0);
  });

  it("wipes all keys and resets configuration", async () => {
    const store = useVaultStore.getState();
    await store.initializeVault("MasterPassword123!");
    await useVaultStore.getState().addItem({
      name: "Temporary Key",
      type: "ssh_key",
      secret: "temp-secret",
    });

    expect(useVaultStore.getState().items).toHaveLength(1);
    expect(useVaultStore.getState().isConfigured).toBe(true);

    const wipeSuccess = await useVaultStore.getState().wipeVault();
    expect(wipeSuccess).toBe(true);
    expect(useVaultStore.getState().isConfigured).toBe(false);
    expect(useVaultStore.getState().isUnlocked).toBe(false);
    expect(useVaultStore.getState().items).toHaveLength(0);
    expect(mockStorage.has("vault_record")).toBe(false);
  });
});
