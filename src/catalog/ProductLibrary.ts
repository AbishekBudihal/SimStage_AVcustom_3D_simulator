/**
 * ProductLibrary.ts
 * ────────────────────────────────────────────────────────────
 * Multi-Tier Product Library Management (§14 of Master Architecture Document)
 *
 * Implements strict separation between:
 * 1. System Library ('system'): Curated, verified manufacturer products.
 * 2. Company Library ('company'): Organization-wide standard products & templates.
 * 3. User Library ('user'): Engineer personal scratchpad & custom devices.
 *
 * All three tiers conform to the Universal Device Model (EquipmentProduct).
 * ────────────────────────────────────────────────────────────
 */

import type { EquipmentProduct, LibraryTier } from './EquipmentCatalog';

const COMPANY_STORAGE_KEY = 'simstage-company-library';
const USER_STORAGE_KEY = 'simstage-user-library';

let memoryStore: Record<string, string> = {};

function getStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: (k: string) => memoryStore[k] ?? null,
    setItem: (k: string, v: string) => {
      memoryStore[k] = v;
    },
    removeItem: (k: string) => {
      delete memoryStore[k];
    }
  };
}

function getStorageKey(tier: LibraryTier): string | null {
  if (tier === 'company') return COMPANY_STORAGE_KEY;
  if (tier === 'user') return USER_STORAGE_KEY;
  return null; // 'system' library is immutable seed data
}

/**
 * Load devices for a specific library tier.
 */
export function loadLibrary(tier: LibraryTier): EquipmentProduct[] {
  const key = getStorageKey(tier);
  if (!key) return [];
  try {
    const raw = getStorage().getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      ...item,
      libraryTier: tier
    }));
  } catch {
    return [];
  }
}

/**
 * Save a device to a specific library tier (defaulting to product.libraryTier or 'user').
 * Updates existing device if ID matches.
 */
export function saveProductToLibrary(product: EquipmentProduct, tier?: LibraryTier): void {
  const targetTier: LibraryTier = tier ?? product.libraryTier ?? 'user';
  if (targetTier === 'system') {
    throw new Error('System Library products are curated and cannot be overwritten directly.');
  }

  const key = getStorageKey(targetTier);
  if (!key) return;

  const lib = loadLibrary(targetTier);
  const updatedProduct: EquipmentProduct = {
    ...product,
    libraryTier: targetTier
  };

  const idx = lib.findIndex((p) => p.id === product.id);
  if (idx >= 0) {
    lib[idx] = updatedProduct;
  } else {
    lib.push(updatedProduct);
  }
  getStorage().setItem(key, JSON.stringify(lib));
}

/**
 * Remove a device from a specific library tier.
 */
export function deleteProductFromLibrary(productId: string, tier: LibraryTier): void {
  const key = getStorageKey(tier);
  if (!key) return;
  const lib = loadLibrary(tier).filter((p) => p.id !== productId);
  getStorage().setItem(key, JSON.stringify(lib));
}

/**
 * Export a library tier as a structured JSON string.
 */
export function exportLibrary(tier: LibraryTier): string {
  const products = loadLibrary(tier);
  return JSON.stringify(
    {
      tier,
      exportedAt: new Date().toISOString(),
      count: products.length,
      products
    },
    null,
    2
  );
}

/**
 * Import devices from a JSON string into a specific library tier.
 * Skips duplicates by ID unless overwrite is specified.
 */
export function importLibrary(
  json: string,
  tier: LibraryTier,
  options?: { overwrite?: boolean }
): EquipmentProduct[] {
  if (tier === 'system') {
    throw new Error('Cannot import directly into System Library.');
  }
  const key = getStorageKey(tier);
  if (!key) return [];

  let importedItems: EquipmentProduct[] = [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      importedItems = parsed;
    } else if (parsed && Array.isArray(parsed.products)) {
      importedItems = parsed.products;
    } else {
      throw new Error('Invalid library format: expected array or library export object.');
    }
  } catch (err) {
    throw new Error(`Failed to parse library JSON: ${(err as Error).message}`);
  }

  const existing = loadLibrary(tier);
  const existingMap = new Map(existing.map((p) => [p.id, p]));

  const newlyAdded: EquipmentProduct[] = [];
  for (const item of importedItems) {
    const itemWithTier: EquipmentProduct = {
      ...item,
      libraryTier: tier
    };
    if (existingMap.has(item.id)) {
      if (options?.overwrite) {
        existingMap.set(item.id, itemWithTier);
        newlyAdded.push(itemWithTier);
      }
    } else {
      existingMap.set(item.id, itemWithTier);
      newlyAdded.push(itemWithTier);
    }
  }

  const merged = Array.from(existingMap.values());
  getStorage().setItem(key, JSON.stringify(merged));
  return newlyAdded;
}

/**
 * Clear all devices from a specific library tier.
 */
export function clearLibrary(tier: LibraryTier): void {
  const key = getStorageKey(tier);
  if (key) {
    getStorage().removeItem(key);
  }
}

/**
 * Retrieve all custom and company products across non-system tiers.
 */
export function getAllStoredProducts(): EquipmentProduct[] {
  const company = loadLibrary('company');
  const user = loadLibrary('user');
  return [...company, ...user];
}

/**
 * Reset memory store (mainly for testing environments).
 */
export function resetLibraryMemoryStore(): void {
  memoryStore = {};
}
