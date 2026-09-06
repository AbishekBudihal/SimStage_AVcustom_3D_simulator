/**
 * UserLibrary.ts
 * ────────────────────────────────────────────────────────────
 * Backward compatibility facade for user-created devices.
 * Delegates directly to the multi-tier ProductLibrary module.
 * ────────────────────────────────────────────────────────────
 */

import type { EquipmentProduct } from './EquipmentCatalog';
import {
  loadLibrary,
  saveProductToLibrary,
  deleteProductFromLibrary,
  exportLibrary,
  importLibrary,
  clearLibrary
} from './ProductLibrary';

/**
 * Load user-created devices from localStorage.
 */
export function loadUserLibrary(): EquipmentProduct[] {
  return loadLibrary('user');
}

/**
 * Save a user-created device to the library.
 * Updates existing device if ID matches.
 */
export function saveUserDevice(product: EquipmentProduct): void {
  saveProductToLibrary(product, 'user');
}

/**
 * Remove a user-created device from the library.
 */
export function deleteUserDevice(productId: string): void {
  deleteProductFromLibrary(productId, 'user');
}

/**
 * Export the user library as a JSON string (for sharing/backup).
 */
export function exportUserLibrary(): string {
  return exportLibrary('user');
}

/**
 * Import devices from a JSON string into the user library.
 * Merges with existing library (skips duplicates by ID).
 */
export function importUserLibrary(json: string): EquipmentProduct[] {
  return importLibrary(json, 'user');
}

/**
 * Clear all user-created devices.
 */
export function clearUserLibrary(): void {
  clearLibrary('user');
}
