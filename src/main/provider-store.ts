// Provider configurations and their keys, owned by the main process (one store for every window).
// Keys are encrypted with the OS keychain (safeStorage) and are only saved when it is there; they
// never leave this process except to the provider itself, and IPC answers only carry masked previews.
import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_IMAGE_SERVER, type ImageModel, type ImageSettings } from "../agent/image-gen.js";
import {
  BUILT_IN_PROVIDERS,
  builtInProvider,
  checkDraft,
  maskKey,
  orderProviders,
  parseProviderModel,
  type ApiType,
  type ProviderModel,
  type ProviderRecord,
  type ResolvedProvider,
} from "../agent/providers.js";

/** A key at rest, encrypted with safeStorage (base64 of its ciphertext). */
interface StoredKey {
  enc: "safe";
  data: string;
}

interface StoredCustom {
  id: string;
  name: string;
  apiType: ApiType;
  baseUrl: string;
  models: ProviderModel[];
  headers?: Record<string, string>;
  key: StoredKey | null;
}

interface Stored {
  version: 1;
  customs: StoredCustom[];
  /** Built-in providers' keys, by their fixed ids. */
  keys: Record<string, StoredKey | undefined>;
  /** The image model scripts' Generate("ai", …) asks (Settings → Images). */
  images?: { baseUrl: string; key: StoredKey | null };
}

const EMPTY: Stored = { version: 1, customs: [], keys: {} };

const file = () => join(app.getPath("userData"), "providers.json");

function load(): Stored {
  try {
    if (!existsSync(file())) return { ...EMPTY };
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<Stored>;
    return {
      version: 1,
      customs: Array.isArray(raw.customs)
        ? raw.customs
            .filter((c): c is StoredCustom => !!c && typeof c.id === "string" && typeof c.name === "string")
            .map((c) => ({ ...c, models: Array.isArray(c.models) ? c.models : [] }))
        : [],
      keys: raw.keys && typeof raw.keys === "object" ? raw.keys : {},
      ...(raw.images && typeof raw.images === "object" && typeof raw.images.baseUrl === "string" ? { images: { baseUrl: raw.images.baseUrl, key: raw.images.key ?? null } } : {}),
    };
  } catch {
    // A broken file must not keep the app from starting; it is rewritten on the next change.
    return { ...EMPTY };
  }
}

function store(stored: Stored): void {
  writeFileSync(file(), JSON.stringify(stored, null, 2));
}

/**
 * Whether keys can be kept encrypted. Linux without a keyring falls back to a fixed password
 * ("basic_text"), which is no better than plain text, so it counts as unavailable.
 */
function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function encrypt(plain: string): StoredKey {
  if (!canEncrypt()) throw new Error("This computer has no keychain to keep the key safe, so it wasn't saved.");
  return { enc: "safe", data: safeStorage.encryptString(plain).toString("base64") };
}

function decrypt(key: StoredKey): string {
  try {
    return key.enc === "safe" && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(key.data, "base64")) : "";
  } catch {
    return "";
  }
}

const shown = (key: StoredKey | null | undefined): string | undefined => (key ? maskKey(decrypt(key)) || undefined : undefined);

const customRecord = (c: StoredCustom): ProviderRecord => ({
  id: c.id,
  name: c.name,
  apiType: c.apiType,
  baseUrl: c.baseUrl,
  models: c.models,
  ...(c.headers && Object.keys(c.headers).length ? { headers: c.headers } : {}),
  ...(shown(c.key) ? { keyMasked: shown(c.key) } : {}),
});

/** Every provider the picker and settings show: the set-up ones first, then the rest. */
export function listProviders(): ProviderRecord[] {
  const stored = load();
  const builtIns = BUILT_IN_PROVIDERS.map((p) => ({ ...p, ...(shown(stored.keys[p.id]) ? { keyMasked: shown(stored.keys[p.id]) } : {}) }));
  return orderProviders([...builtIns, ...stored.customs.map(customRecord)]);
}

function writeKey(stored: Stored, id: string, plain: string | null): void {
  const key = plain ? encrypt(plain) : null;
  if (builtInProvider(id)) {
    if (key) stored.keys[id] = key;
    else delete stored.keys[id];
  } else {
    const custom = stored.customs.find((c) => c.id === id);
    if (custom) custom.key = key;
  }
}

/**
 * Adds a custom provider, or updates one (name, endpoint, models — and its key when `key` is given).
 * The draft comes from a window, so it is checked here; a bad one throws with what to fix.
 */
export function saveProvider(raw: unknown): ProviderRecord {
  const draft = checkDraft(raw);
  const stored = load();
  const key = draft.key === undefined ? undefined : draft.key?.trim() ? encrypt(draft.key.trim()) : null;
  let custom = draft.id ? stored.customs.find((c) => c.id === draft.id) : undefined;
  if (draft.id && !custom) throw new Error("That provider was removed.");
  if (custom) {
    custom.name = draft.name;
    custom.apiType = draft.apiType;
    custom.baseUrl = draft.baseUrl;
    custom.models = draft.models;
    custom.headers = draft.headers;
    if (key !== undefined) custom.key = key;
  } else {
    custom = {
      id: randomUUID(),
      name: draft.name,
      apiType: draft.apiType,
      baseUrl: draft.baseUrl,
      models: draft.models,
      ...(draft.headers ? { headers: draft.headers } : {}),
      key: key ?? null,
    };
    stored.customs.push(custom);
  }
  store(stored);
  return customRecord(custom);
}

export function removeProvider(id: unknown): void {
  if (typeof id !== "string") return;
  const stored = load();
  stored.customs = stored.customs.filter((c) => c.id !== id);
  delete stored.keys[id];
  store(stored);
}

/** Saves (or, with an empty `key`, clears) the key of a built-in or custom provider. */
export function setProviderKey(id: unknown, key: unknown): void {
  if (typeof id !== "string" || typeof key !== "string" || key.length > 4000) throw new Error("That key couldn't be read.");
  const stored = load();
  if (!builtInProvider(id) && !stored.customs.some((c) => c.id === id)) throw new Error("That provider was removed.");
  writeKey(stored, id, key.trim() || null);
  store(stored);
}

export function clearProviderKey(id: unknown): void {
  setProviderKey(id, "");
}

/** What an agent run needs for a "prov:provider:model" choice, or undefined when it isn't one. */
export function resolveProviderModel(model: string): ResolvedProvider | undefined {
  const parsed = parseProviderModel(model);
  if (!parsed) return undefined;
  const stored = load();
  const builtIn = builtInProvider(parsed.providerId);
  const record: ProviderRecord | undefined = builtIn ?? stored.customs.map(customRecord).find((c) => c.id === parsed.providerId);
  const found = record?.models.find((m) => m.id === parsed.modelId);
  if (!record || !found) return undefined;
  const keyStored = builtIn ? stored.keys[builtIn.id] : stored.customs.find((c) => c.id === record.id)?.key;
  const apiKey = (keyStored && decrypt(keyStored)) || undefined;
  return {
    name: record.name,
    apiType: record.apiType,
    baseUrl: record.baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(record.headers ? { headers: record.headers } : {}),
    model: found.id,
    ...(found.maxTokens ? { maxTokens: found.maxTokens } : {}),
    ...(found.images ? { images: true } : {}),
  };
}

export function imageSettings(): ImageSettings {
  const images = load().images;
  const masked = shown(images?.key);
  return { baseUrl: images?.baseUrl || DEFAULT_IMAGE_SERVER, ...(masked ? { keyMasked: masked } : {}) };
}

/** Saves the image server (and its key when `key` is given; an empty one clears it). */
export function setImageSettings(raw: unknown): ImageSettings {
  const draft = (raw && typeof raw === "object" ? raw : {}) as { baseUrl?: unknown; key?: unknown };
  const stored = load();
  const baseUrl = typeof draft.baseUrl === "string" && draft.baseUrl.trim() ? draft.baseUrl.trim() : stored.images?.baseUrl || DEFAULT_IMAGE_SERVER;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("The server address isn't a web address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("The server address must start with https://.");
  if (draft.key !== undefined && (typeof draft.key !== "string" || draft.key.length > 4000)) throw new Error("That key couldn't be read.");
  const key = typeof draft.key === "string" ? (draft.key.trim() ? encrypt(draft.key.trim()) : null) : (stored.images?.key ?? null);
  stored.images = { baseUrl, key };
  store(stored);
  return imageSettings();
}

/** The image model to ask, or undefined when no key is saved. */
export function imageModel(): ImageModel | undefined {
  const images = load().images;
  const apiKey = images?.key ? decrypt(images.key) : "";
  return apiKey ? { baseUrl: images?.baseUrl || DEFAULT_IMAGE_SERVER, apiKey } : undefined;
}
