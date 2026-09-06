import { EquipmentCatalog, type EquipmentProduct } from './EquipmentCatalog';
import displaysJson from '../../data/displays.json';
import speakersJson from '../../data/speakers.json';
import microphonesJson from '../../data/microphones.json';
import camerasJson from '../../data/cameras.json';
import systemDevicesJson from '../../data/system-devices.json';

let defaultCatalog: EquipmentCatalog | null = null;

export function loadDefaultCatalog(): EquipmentCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new EquipmentCatalog();
    defaultCatalog.register(displaysJson as EquipmentProduct[]);
    defaultCatalog.register(speakersJson as EquipmentProduct[]);
    defaultCatalog.register(microphonesJson as EquipmentProduct[]);
    defaultCatalog.register(camerasJson as EquipmentProduct[]);
    defaultCatalog.register(systemDevicesJson as EquipmentProduct[]);
  }
  return defaultCatalog;
}

export function resetDefaultCatalog(): void {
  defaultCatalog = null;
}

