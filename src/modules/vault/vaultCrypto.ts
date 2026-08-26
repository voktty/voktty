/**
 * Robust Cryptography Utilities for Voktty Key Vault
 * Uses Web Crypto API (SubtleCrypto) with PBKDF2-SHA256 and AES-256-GCM.
 */

export const VAULT_CHALLENGE_STRING = "VOKTTY_VAULT_CHALLENGE_OK_v1";
export const PBKDF2_ITERATIONS = 100_000;
export const SALT_LENGTH_BYTES = 16;
export const AES_GCM_IV_LENGTH_BYTES = 12;

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateRandomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

export function generateRandomIv(): Uint8Array {
  const iv = new Uint8Array(AES_GCM_IV_LENGTH_BYTES);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a master password and salt using PBKDF2-SHA256.
 */
export async function deriveVaultKey(
  masterPassword: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(masterPassword),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts a string with AES-256-GCM.
 * Returns base64-encoded IV and ciphertext.
 */
export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = generateRandomIv();
  const enc = new TextEncoder();
  const data = enc.encode(plaintext);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
    },
    key,
    data,
  );

  return {
    iv: uint8ArrayToBase64(iv),
    ciphertext: uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
  };
}

/**
 * Decrypts base64-encoded ciphertext with AES-256-GCM.
 * Throws an Error if decryption fails (e.g. invalid key, corrupted data, or bad tag).
 */
export async function decryptString(
  key: CryptoKey,
  ivBase64: string,
  ciphertextBase64: string,
): Promise<string> {
  const iv = base64ToUint8Array(ivBase64);
  const ciphertext = base64ToUint8Array(ciphertextBase64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
    },
    key,
    ciphertext as BufferSource,
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBuffer);
}

/**
 * Generates a strong random password/token with customizable character sets.
 */
export function generatePassword(
  length = 24,
  options: { symbols?: boolean; numbers?: boolean; uppercase?: boolean } = {
    symbols: true,
    numbers: true,
    uppercase: true,
  },
): string {
  const lowercaseChars = "abcdefghijklmnopqrstuvwxyz";
  const uppercaseChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numberChars = "0123456789";
  const symbolChars = "!@#$%^&*()_+-=[]{}|;:,.<>?";

  let validChars = lowercaseChars;
  if (options.uppercase !== false) validChars += uppercaseChars;
  if (options.numbers !== false) validChars += numberChars;
  if (options.symbols !== false) validChars += symbolChars;

  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  let result = "";
  for (let i = 0; i < length; i++) {
    result += validChars[randomValues[i] % validChars.length];
  }
  return result;
}

/**
 * Generates an RSA or ECDSA key pair and formats it as standard PEM / Public key strings.
 */
export async function generateSshKeyPair(
  type: "rsa" | "ecdsa" = "rsa",
): Promise<{ privateKey: string; publicKey: string }> {
  if (type === "ecdsa") {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );

    const privateBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const privateBase64 = uint8ArrayToBase64(new Uint8Array(privateBuffer));
    const publicBase64 = uint8ArrayToBase64(new Uint8Array(publicBuffer));

    const formattedPrivate = [
      "-----BEGIN PRIVATE KEY-----",
      privateBase64.match(/.{1,64}/g)?.join("\n") ?? privateBase64,
      "-----END PRIVATE KEY-----",
    ].join("\n");

    return {
      privateKey: formattedPrivate,
      publicKey: `ecdsa-sha2-nistp256 ${publicBase64} voktty-generated-key`,
    };
  }

  // Standard RSA 2048-bit key
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );

  const privateBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  const privateBase64 = uint8ArrayToBase64(new Uint8Array(privateBuffer));
  const publicBase64 = uint8ArrayToBase64(new Uint8Array(publicBuffer));

  const formattedPrivate = [
    "-----BEGIN RSA PRIVATE KEY-----",
    privateBase64.match(/.{1,64}/g)?.join("\n") ?? privateBase64,
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");

  const formattedPublic = `ssh-rsa ${publicBase64} voktty-generated-rsa-key`;

  return {
    privateKey: formattedPrivate,
    publicKey: formattedPublic,
  };
}
