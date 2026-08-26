export type VaultItemType =
  | "ssh_key"
  | "ssh_passphrase"
  | "api_key"
  | "token"
  | "generic_secret";

export type VaultItem = {
  id: string;
  name: string;
  type: VaultItemType;
  secret: string; // Plaintext in memory only when unlocked
  publicKey?: string; // Optional SSH public key
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export type VaultEncryptedRecord = {
  version: 1;
  salt: string; // Base64
  challengeIv: string; // Base64
  challengeCiphertext: string; // Base64
  payloadIv: string; // Base64
  payloadCiphertext: string; // Base64
  updatedAt: string;
};

export type VaultStatus = {
  isConfigured: boolean;
  isUnlocked: boolean;
  itemCount: number;
  autoLockMinutes: number;
};
