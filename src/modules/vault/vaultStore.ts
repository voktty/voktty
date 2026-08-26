import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import type { VaultEncryptedRecord, VaultItem } from "./types";
import {
  base64ToUint8Array,
  decryptString,
  deriveVaultKey,
  encryptString,
  generateRandomSalt,
  uint8ArrayToBase64,
  VAULT_CHALLENGE_STRING,
} from "./vaultCrypto";

const VAULT_STORE_FILE = "voktty-vault.json";
const KEY_VAULT_RECORD = "vault_record";
const KEY_AUTO_LOCK_MINUTES = "vault_autolock_minutes";
const VAULT_STATUS_CHANGED_EVENT = "voktty://vault-status-changed";

const store = new LazyStore(VAULT_STORE_FILE);

// In-memory decrypted key kept strictly while unlocked
let activeVaultKey: CryptoKey | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

export type VaultStore = {
  isConfigured: boolean;
  isUnlocked: boolean;
  items: VaultItem[];
  autoLockMinutes: number;
  error: string | null;
  isBusy: boolean;

  init: () => Promise<void>;
  initializeVault: (masterPassword: string) => Promise<boolean>;
  unlockVault: (masterPassword: string) => Promise<boolean>;
  lockVault: () => void;
  changeMasterPassword: (
    oldPass: string,
    newPass: string,
  ) => Promise<boolean>;
  wipeVault: () => Promise<boolean>;
  addItem: (
    item: Omit<VaultItem, "id" | "createdAt" | "updatedAt">,
  ) => Promise<VaultItem | null>;
  updateItem: (
    id: string,
    updates: Partial<Omit<VaultItem, "id" | "createdAt">>,
  ) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  setAutoLockMinutes: (minutes: number) => Promise<void>;
  resetAutoLockTimer: () => void;
};

function scheduleAutoLock(minutes: number, onLock: () => void) {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  if (minutes > 0) {
    autoLockTimer = setTimeout(() => {
      onLock();
    }, minutes * 60 * 1000);
  }
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  isConfigured: false,
  isUnlocked: false,
  items: [],
  autoLockMinutes: 15,
  error: null,
  isBusy: false,

  init: async () => {
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      const savedAutoLock = await store.get<number>(KEY_AUTO_LOCK_MINUTES);
      const isConfigured = !!(record && record.salt && record.challengeCiphertext);
      set({
        isConfigured,
        autoLockMinutes: typeof savedAutoLock === "number" ? savedAutoLock : 15,
      });
    } catch {
      set({ isConfigured: false });
    }
  },

  resetAutoLockTimer: () => {
    const { isUnlocked, autoLockMinutes, lockVault } = get();
    if (isUnlocked && autoLockMinutes > 0) {
      scheduleAutoLock(autoLockMinutes, lockVault);
    }
  },

  initializeVault: async (masterPassword: string) => {
    const trimmed = masterPassword.trim();
    if (trimmed.length < 6) {
      set({ error: "Master password must be at least 6 characters" });
      return false;
    }

    set({ isBusy: true, error: null });
    try {
      const salt = generateRandomSalt();
      const key = await deriveVaultKey(trimmed, salt);

      // Encrypt challenge string
      const challengeEncrypted = await encryptString(key, VAULT_CHALLENGE_STRING);

      // Encrypt empty items payload
      const initialItems: VaultItem[] = [];
      const payloadEncrypted = await encryptString(key, JSON.stringify(initialItems));

      const record: VaultEncryptedRecord = {
        version: 1,
        salt: uint8ArrayToBase64(salt),
        challengeIv: challengeEncrypted.iv,
        challengeCiphertext: challengeEncrypted.ciphertext,
        payloadIv: payloadEncrypted.iv,
        payloadCiphertext: payloadEncrypted.ciphertext,
        updatedAt: new Date().toISOString(),
      };

      await store.set(KEY_VAULT_RECORD, record);
      await store.save();

      activeVaultKey = key;
      set({
        isConfigured: true,
        isUnlocked: true,
        items: initialItems,
        isBusy: false,
        error: null,
      });

      scheduleAutoLock(get().autoLockMinutes, get().lockVault);
      await emit(VAULT_STATUS_CHANGED_EVENT, { isConfigured: true });
      return true;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to initialize vault",
      });
      return false;
    }
  },

  unlockVault: async (masterPassword: string) => {
    set({ isBusy: true, error: null });
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      if (!record || !record.salt) {
        set({ isBusy: false, error: "Vault is not configured" });
        return false;
      }

      const salt = base64ToUint8Array(record.salt);
      const key = await deriveVaultKey(masterPassword, salt);

      // Verify challenge
      const verified = await decryptString(
        key,
        record.challengeIv,
        record.challengeCiphertext,
      );

      if (verified !== VAULT_CHALLENGE_STRING) {
        set({ isBusy: false, error: "Invalid master password" });
        return false;
      }

      // Decrypt items payload
      let items: VaultItem[] = [];
      if (record.payloadCiphertext && record.payloadIv) {
        const decryptedPayload = await decryptString(
          key,
          record.payloadIv,
          record.payloadCiphertext,
        );
        items = JSON.parse(decryptedPayload);
      }

      activeVaultKey = key;
      set({
        isUnlocked: true,
        items,
        isBusy: false,
        error: null,
      });

      scheduleAutoLock(get().autoLockMinutes, get().lockVault);
      return true;
    } catch {
      set({
        isBusy: false,
        error: "Incorrect master password",
      });
      return false;
    }
  },

  lockVault: () => {
    activeVaultKey = null;
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
    set({
      isUnlocked: false,
      items: [],
      error: null,
    });
  },

  changeMasterPassword: async (oldPass: string, newPass: string) => {
    const trimmedNew = newPass.trim();
    if (trimmedNew.length < 6) {
      set({ error: "New master password must be at least 6 characters" });
      return false;
    }

    set({ isBusy: true, error: null });
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      if (!record || !record.salt) {
        set({ isBusy: false, error: "Vault not configured" });
        return false;
      }

      const oldSalt = base64ToUint8Array(record.salt);
      const oldKey = await deriveVaultKey(oldPass, oldSalt);

      // Verify old password
      const verified = await decryptString(
        oldKey,
        record.challengeIv,
        record.challengeCiphertext,
      );
      if (verified !== VAULT_CHALLENGE_STRING) {
        set({ isBusy: false, error: "Current master password incorrect" });
        return false;
      }

      // Decrypt existing items with old key
      let currentItems: VaultItem[] = get().items;
      if (record.payloadCiphertext && record.payloadIv) {
        const decryptedPayload = await decryptString(
          oldKey,
          record.payloadIv,
          record.payloadCiphertext,
        );
        currentItems = JSON.parse(decryptedPayload);
      }

      // Derive new key with new salt
      const newSalt = generateRandomSalt();
      const newKey = await deriveVaultKey(trimmedNew, newSalt);

      const challengeEncrypted = await encryptString(newKey, VAULT_CHALLENGE_STRING);
      const payloadEncrypted = await encryptString(newKey, JSON.stringify(currentItems));

      const newRecord: VaultEncryptedRecord = {
        version: 1,
        salt: uint8ArrayToBase64(newSalt),
        challengeIv: challengeEncrypted.iv,
        challengeCiphertext: challengeEncrypted.ciphertext,
        payloadIv: payloadEncrypted.iv,
        payloadCiphertext: payloadEncrypted.ciphertext,
        updatedAt: new Date().toISOString(),
      };

      await store.set(KEY_VAULT_RECORD, newRecord);
      await store.save();

      activeVaultKey = newKey;
      set({
        isUnlocked: true,
        items: currentItems,
        isBusy: false,
        error: null,
      });

      scheduleAutoLock(get().autoLockMinutes, get().lockVault);
      return true;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to change master password",
      });
      return false;
    }
  },

  wipeVault: async () => {
    set({ isBusy: true, error: null });
    try {
      activeVaultKey = null;
      if (autoLockTimer) {
        clearTimeout(autoLockTimer);
        autoLockTimer = null;
      }

      await store.delete(KEY_VAULT_RECORD);
      await store.save();

      set({
        isConfigured: false,
        isUnlocked: false,
        items: [],
        isBusy: false,
        error: null,
      });

      await emit(VAULT_STATUS_CHANGED_EVENT, { isConfigured: false });
      return true;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to wipe vault",
      });
      return false;
    }
  },

  addItem: async (itemData) => {
    if (!activeVaultKey) {
      set({ error: "Vault must be unlocked to add keys" });
      return null;
    }

    set({ isBusy: true, error: null });
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      if (!record) throw new Error("Vault record not found");

      const now = new Date().toISOString();
      const newItem: VaultItem = {
        ...itemData,
        id: `key_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        updatedAt: now,
      };

      const updatedItems = [...get().items, newItem];
      const payloadEncrypted = await encryptString(
        activeVaultKey,
        JSON.stringify(updatedItems),
      );

      const updatedRecord: VaultEncryptedRecord = {
        ...record,
        payloadIv: payloadEncrypted.iv,
        payloadCiphertext: payloadEncrypted.ciphertext,
        updatedAt: now,
      };

      await store.set(KEY_VAULT_RECORD, updatedRecord);
      await store.save();

      set({
        items: updatedItems,
        isBusy: false,
        error: null,
      });

      get().resetAutoLockTimer();
      return newItem;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to add key to vault",
      });
      return null;
    }
  },

  updateItem: async (id, updates) => {
    if (!activeVaultKey) {
      set({ error: "Vault must be unlocked to update keys" });
      return false;
    }

    set({ isBusy: true, error: null });
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      if (!record) throw new Error("Vault record not found");

      const now = new Date().toISOString();
      const updatedItems = get().items.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt: now } : item,
      );

      const payloadEncrypted = await encryptString(
        activeVaultKey,
        JSON.stringify(updatedItems),
      );

      const updatedRecord: VaultEncryptedRecord = {
        ...record,
        payloadIv: payloadEncrypted.iv,
        payloadCiphertext: payloadEncrypted.ciphertext,
        updatedAt: now,
      };

      await store.set(KEY_VAULT_RECORD, updatedRecord);
      await store.save();

      set({
        items: updatedItems,
        isBusy: false,
        error: null,
      });

      get().resetAutoLockTimer();
      return true;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to update key in vault",
      });
      return false;
    }
  },

  deleteItem: async (id) => {
    if (!activeVaultKey) {
      set({ error: "Vault must be unlocked to delete keys" });
      return false;
    }

    set({ isBusy: true, error: null });
    try {
      const record = await store.get<VaultEncryptedRecord>(KEY_VAULT_RECORD);
      if (!record) throw new Error("Vault record not found");

      const now = new Date().toISOString();
      const updatedItems = get().items.filter((item) => item.id !== id);

      const payloadEncrypted = await encryptString(
        activeVaultKey,
        JSON.stringify(updatedItems),
      );

      const updatedRecord: VaultEncryptedRecord = {
        ...record,
        payloadIv: payloadEncrypted.iv,
        payloadCiphertext: payloadEncrypted.ciphertext,
        updatedAt: now,
      };

      await store.set(KEY_VAULT_RECORD, updatedRecord);
      await store.save();

      set({
        items: updatedItems,
        isBusy: false,
        error: null,
      });

      get().resetAutoLockTimer();
      return true;
    } catch (err) {
      set({
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to delete key from vault",
      });
      return false;
    }
  },

  setAutoLockMinutes: async (minutes: number) => {
    const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
    await store.set(KEY_AUTO_LOCK_MINUTES, clamped);
    await store.save();
    set({ autoLockMinutes: clamped });
    get().resetAutoLockTimer();
  },
}));

export function onVaultStatusChanged(
  cb: (status: { isConfigured: boolean }) => void,
): Promise<UnlistenFn> {
  return listen<{ isConfigured: boolean }>(VAULT_STATUS_CHANGED_EVENT, (e) =>
    cb(e.payload),
  );
}
