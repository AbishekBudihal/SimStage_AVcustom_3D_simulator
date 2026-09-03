/**
 * UserLibrary.ts
 * Manages user-created devices with localStorage persistence.
 * Also serializable to project files for portability.
 */

import type { EquipmentProduct } from './EquipmentCatalog';

const STORAGE_KEY = 'simstage-user-library';

let memoryStore: Record<string, string> = {};

function getStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: (k: string) => memoryStore[k] ?? null,
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
    removeItem: (k: string) => { delete memoryStore[k]; }
  };
}

/**
 * Load user-created devices from localStorage.
 */
export function loadUserLibrary(): EquipmentProduct[] {
  try {
    const raw = getStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save a user-created device to the library.
 * Updates existing device if ID matches.
 */
export function saveUserDevice(product: EquipmentProduct): void {
  const lib = loadUserLibrary();
  const idx = lib.findIndex((p) => p.id === product.id);
  if (idx >= 0) {
    lib[idx] = product;
  } else {
    lib.push(product);
  }
  getStorage().setItem(STORAGE_KEY, JSON.stringify(lib));
}

/**
 * Remove a user-created device from the library.
 */
export function deleteUserDevice(productId: string): void {
  const lib = loadUserLibrary().filter((p) => p.id !== productId);
  getStorage().setItem(STORAGE_KEY, JSON.stringify(lib));
}

/**
 * Export the user library as a JSON string (for sharing/backup).
 */
export function exportUserLibrary(): string {
  return JSON.stringify(loadUserLibrary(), null, 2);
}

/**
 * Import devices from a JSON string into the user library.
 * Merges with existing library (skips duplicates by ID).
 */
export function importUserLibrary(json: string): EquipmentProduct[] {
  const imported: EquipmentProduct[] = JSON.parse(json);
  if (!Array.isArray(imported)) throw new Error('Invalid library format.');
  const existing = loadUserLibrary();
  const existingIds = new Set(existing.map((p) => p.id));
  const newDevices = imported.filter((p) => !existingIds.has(p.id));
  const merged = [...existing, ...newDevices];
  getStorage().setItem(STORAGE_KEY, JSON.stringify(merged));
  return newDevices;
}

/**
 * Clear all user-created devices.
 */
export function clearUserLibrary(): void {
  getStorage().removeItem(STORAGE_KEY);
}
