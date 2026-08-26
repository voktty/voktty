import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  decryptString,
  deriveVaultKey,
  encryptString,
  generatePassword,
  generateRandomSalt,
  generateSshKeyPair,
  uint8ArrayToBase64,
  VAULT_CHALLENGE_STRING,
} from "./vaultCrypto";

describe("vaultCrypto", () => {
  it("converts Uint8Array to base64 and back", () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const b64 = uint8ArrayToBase64(original);
    const roundtrip = base64ToUint8Array(b64);
    expect(Array.from(roundtrip)).toEqual(Array.from(original));
  });

  it("encrypts and decrypts string correctly with derived key", async () => {
    const salt = generateRandomSalt();
    const password = "SuperSecretPassword123!";
    const key = await deriveVaultKey(password, salt);

    const message = "my-private-ssh-key-data-content-here";
    const encrypted = await encryptString(key, message);

    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();

    const decrypted = await decryptString(
      key,
      encrypted.iv,
      encrypted.ciphertext,
    );
    expect(decrypted).toBe(message);
  });

  it("fails decryption when key is derived from incorrect password", async () => {
    const salt = generateRandomSalt();
    const keyCorrect = await deriveVaultKey("CorrectPassword", salt);
    const keyWrong = await deriveVaultKey("WrongPassword", salt);

    const encrypted = await encryptString(keyCorrect, VAULT_CHALLENGE_STRING);

    await expect(
      decryptString(keyWrong, encrypted.iv, encrypted.ciphertext),
    ).rejects.toThrow();
  });

  it("generates random passwords with correct length", () => {
    const pass16 = generatePassword(16);
    expect(pass16).toHaveLength(16);

    const pass32 = generatePassword(32, { symbols: false });
    expect(pass32).toHaveLength(32);
  });

  it("generates SSH key pairs", async () => {
    const rsaKeys = await generateSshKeyPair("rsa");
    expect(rsaKeys.privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect(rsaKeys.publicKey).toContain("ssh-rsa");

    const ecdsaKeys = await generateSshKeyPair("ecdsa");
    expect(ecdsaKeys.privateKey).toContain("BEGIN PRIVATE KEY");
    expect(ecdsaKeys.publicKey).toContain("ecdsa-sha2-nistp256");
  });
});
