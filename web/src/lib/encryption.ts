/**
 * End-to-end encryption using Web Crypto API.
 *
 * Architecture:
 *   - Each user has an RSA-OAEP 2048 key pair stored in IndexedDB.
 *   - Each channel (DM or group) has a random AES-256-GCM "channel key".
 *   - The channel key is encrypted for each participant with their RSA public key
 *     and stored on the server.
 *   - Messages are encrypted with the channel AES key.
 *
 * Private keys never leave the browser. If a user loses their keys (new device/
 * browser) they cannot read historical messages — this is the expected trade-off
 * for E2E security. A future version can add key backup via a user passphrase.
 */

const IDB_NAME = "shema-study-e2e";
const IDB_STORE = "keys";
const KEY_ENTRY = "user";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Codec helpers ────────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Array.from(atob(s), (c) => c.charCodeAt(0))) as unknown as Uint8Array<ArrayBuffer>;
}

// ─── RSA-OAEP user key pair ───────────────────────────────────────────────────

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ["encrypt", "decrypt"]);
}

/** Persist key pair to IndexedDB. */
export async function storeKeyPair(pair: CryptoKeyPair): Promise<void> {
  const db = await openIDB();
  await idbPut(db, KEY_ENTRY, { privateKey: pair.privateKey, publicKey: pair.publicKey });
}

/** Load key pair from IndexedDB, or null if none exists. */
export async function loadKeyPair(): Promise<CryptoKeyPair | null> {
  try {
    const db = await openIDB();
    const stored = await idbGet<{ privateKey: CryptoKey; publicKey: CryptoKey }>(db, KEY_ENTRY);
    if (!stored?.privateKey || !stored?.publicKey) return null;
    return { privateKey: stored.privateKey, publicKey: stored.publicKey };
  } catch {
    return null;
  }
}

/** Get or create the user key pair. */
export async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const existing = await loadKeyPair();
  if (existing) return existing;
  const pair = await generateKeyPair();
  await storeKeyPair(pair);
  return pair;
}

/** Export a public key as a JWK string for uploading to the server. */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(jwk);
}

/** Import a public key from a JWK string (received from server). */
export async function importPublicKey(jwkStr: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkStr) as JsonWebKey;
  return crypto.subtle.importKey("jwk", jwk, RSA_PARAMS, true, ["encrypt"]);
}

// ─── Channel (AES-256-GCM) keys ──────────────────────────────────────────────

/** Generate a random AES-256-GCM channel key. */
export async function generateChannelKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a channel key with a recipient's RSA public key. Returns base64. */
export async function encryptChannelKey(
  channelKey: CryptoKey,
  recipientPublicKey: CryptoKey,
): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", channelKey);
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    recipientPublicKey,
    rawKey,
  );
  return toBase64(encrypted);
}

/** Decrypt a base64-encoded encrypted channel key using my RSA private key. */
export async function decryptChannelKey(
  encryptedBase64: string,
  myPrivateKey: CryptoKey,
): Promise<CryptoKey> {
  const encrypted = fromBase64(encryptedBase64);
  const rawKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    myPrivateKey,
    encrypted,
  );
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// ─── Message encryption ───────────────────────────────────────────────────────

export interface EncryptedMessage {
  iv: string;   // base64
  ct: string;   // base64 ciphertext
}

/** Encrypt a plaintext string with the channel AES key. */
export async function encryptMessage(
  plaintext: string,
  channelKey: CryptoKey,
): Promise<EncryptedMessage> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as unknown as Uint8Array<ArrayBuffer>;
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    channelKey,
    encoded,
  );
  return { iv: toBase64((iv as unknown as Uint8Array).buffer as ArrayBuffer), ct: toBase64(ciphertext) };
}

/** Decrypt an encrypted message with the channel AES key. */
export async function decryptMessage(
  msg: EncryptedMessage,
  channelKey: CryptoKey,
): Promise<string> {
  const iv = fromBase64(msg.iv);
  const ciphertext = fromBase64(msg.ct);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as Uint8Array<ArrayBuffer> },
    channelKey,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ─── Key cache (in-memory, per session) ──────────────────────────────────────

const channelKeyCache = new Map<string, CryptoKey>();

export function cacheChannelKey(channelId: string, key: CryptoKey): void {
  channelKeyCache.set(channelId, key);
}

export function getCachedChannelKey(channelId: string): CryptoKey | undefined {
  return channelKeyCache.get(channelId);
}

export function clearKeyCache(): void {
  channelKeyCache.clear();
}
