import { EquipmentCatalog, type EquipmentProduct } from './EquipmentCatalog';
import { getAllStoredProducts } from './ProductLibrary';
import displaysJson from '../../data/displays.json';
import speakersJson from '../../data/speakers.json';
import microphonesJson from '../../data/microphones.json';
import camerasJson from '../../data/cameras.json';
import systemDevicesJson from '../../data/system-devices.json';

let defaultCatalog: EquipmentCatalog | null = null;

export function loadDefaultCatalog(): EquipmentCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new EquipmentCatalog();
    defaultCatalog.register(displaysJson as EquipmentProduct[], 'system');
    defaultCatalog.register(speakersJson as EquipmentProduct[], 'system');
    defaultCatalog.register(microphonesJson as EquipmentProduct[], 'system');
    defaultCatalog.register(camerasJson as EquipmentProduct[], 'system');
    defaultCatalog.register(systemDevicesJson as EquipmentProduct[], 'system');

    // Hydrate persistent company and user libraries into runtime catalog
    const stored = getAllStoredProducts();
    if (stored.length > 0) {
      defaultCatalog.register(stored);
    }
  }
  return defaultCatalog;
}

export function resetDefaultCatalog(): void {
  defaultCatalog = null;
}
