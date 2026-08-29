/**
 * EquipmentCatalog.ts
 * Core catalog architecture (§6, §31). Every spec field is tagged
 * with a provenance so the app never claims manufacturer-verified
 * accuracy for a number nobody actually verified (§40).
 *
 * IMPORTANT: no manufacturer specifications are fabricated here.
 * Seed data in /data/*.json uses PUBLICLY PUBLISHED, commonly-cited
 * spec-sheet figures for well-known product lines and is marked
 * "verified" only where the figure matches the manufacturer's own
 * datasheet; anything else is marked "estimated" or left for the
 * engineer to fill in as "user_defined". Replace/expand this file
 * with your organization's confirmed datasheet data before relying
 * on it for real engineering sign-off.
 */

import type { PortDefinition, SignalType } from '../system/SystemTypes';

export type DataProvenance = 'verified' | 'estimated' | 'user_defined';

export interface Provenanced<T> {
  value: T;
  provenance: DataProvenance;
  /** e.g. manufacturer datasheet URL, or "engineering estimate" */
  source?: string;
}

export type EquipmentCategory =
  | 'display'
  | 'projector'
  | 'video_wall'
  | 'speaker'
  | 'microphone'
  | 'camera'
  | 'dsp'
  | 'amplifier'
  | 'codec'
  | 'switcher'
  | 'control'
  | 'rack'
  | 'furniture'
  | 'infrastructure'
  | 'source'
  | 'extender'
  | 'network';

/**
 * UI groups the fine-grained categories above into the browsing taxonomy
 * an engineer actually navigates by. This is deliberately a small,
 * fixed set of groups (not one nav item per category) so that categories
 * with no catalog data yet (projectors, DSP, switchers, etc.) don't each
 * need their own empty screen — they honestly report "no catalog data"
 * under "Infrastructure" until real product data is added. Adding a new
 * EquipmentCategory later only means adding it to a group here — no UI
 * or engineering-logic changes required.
 */
export interface CategoryGroup {
  id: string;
  label: string;
  categories: EquipmentCategory[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  { id: 'displays', label: 'Displays', categories: ['display'] },
  { id: 'projectors', label: 'Projectors', categories: ['projector'] },
  { id: 'sources', label: 'Sources', categories: ['source'] },
  { id: 'audio', label: 'Audio', categories: ['speaker', 'amplifier', 'dsp'] },
  { id: 'microphones', label: 'Microphones', categories: ['microphone'] },
  { id: 'cameras', label: 'Cameras', categories: ['camera'] },
  { id: 'collaboration', label: 'Collaboration', categories: ['codec'] },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    categories: ['video_wall', 'switcher', 'extender', 'control', 'rack', 'network', 'infrastructure']
  }
];

export interface PhysicalSpec {
  width: number;
  height: number;
  depth: number;
  weightKg?: number;
  /** Typical power consumption in watts. Omit when unknown — never invent. */
  powerWatts?: number;
}

export interface DisplaySpec {
  diagonalInches: number;
  resolution: string;
  aspectRatio: string;
  brightnessNits: number;
}

export interface SpeakerSpec {
  mount: 'ceiling' | 'wall' | 'pendant' | 'integrated';
  /** Nominal conical or single-axis width (degrees). Optional if H+V are both present. */
  dispersionDeg?: number;
  horizontalDispersionDeg?: number;
  verticalDispersionDeg?: number;
  maxSplAt1m?: number;
  sensitivityDb?: number;
  frequencyResponse?: string;
  powerRating?: string;
  /** Catalog-declared. Do not infer from marketing copy. */
  powerClass?: 'active' | 'passive';
}

export interface CameraSpec {
  mount: 'wall' | 'ceiling' | 'table';
  /** Horizontal field of view in degrees. Required for FOV coverage. Never invent 60/90. */
  horizontalFovDeg?: number;
  /** Vertical field of view in degrees. Optional; do not invent from 16:9. */
  verticalFovDeg?: number;
}

export interface MicrophoneSpec {
  mount: 'ceiling' | 'table' | 'wall' | 'integrated';
  pickupRadiusM: number;
  pattern: string;
  channels: number;
  connection: string;
  /**
   * When 'directional_sector', beamWidthDeg is required. Omitted/omni → disc
   * if pickupRadiusM is present. Do not infer this from free-text pattern.
   */
  coverageModel?: 'omni' | 'directional_sector';
  /** Horizontal sector width in degrees. Required for directional_sector. */
  beamWidthDeg?: number;
}

export interface MountingSpec {
  wall: boolean;
  floor: boolean;
  ceiling: boolean;
  table?: boolean;
  rack?: boolean;
  freestanding?: boolean;
  vesa?: string;
}

export interface ConnectivitySpec {
  hdmi?: number;
  displayPort?: number;
  usb?: number;
  ethernet?: boolean;
}

export interface EquipmentProduct {
  id: string;
  manufacturer: string;
  model: string;
  category: EquipmentCategory;
  type: string;
  /** Optional identity copy. Omit rather than invent marketing text. */
  description?: string;
  family?: string;
  physical: PhysicalSpec;
  display?: DisplaySpec;
  speaker?: SpeakerSpec;
  microphone?: MicrophoneSpec;
  camera?: CameraSpec;
  mounting?: MountingSpec;
  connectivity?: ConnectivitySpec;
  /** Explicit I/O. Prefer this over inferring from connectivity counts. */
  ports?: PortDefinition[];
  signalForwarding?: SignalType[];
  provenance: DataProvenance;
  source?: string;
  datasheetUrl?: string;
  modelAsset?: string; // path to .glb, if a real model exists
  /** Catalog rack units. Omit when unknown — do not invent. */
  rackUnits?: number;
}

export type PlacementMode = 'smart' | 'manual';
/** How the product/instance entered the design. Manual edits of Auto Design items become 'manual'. */
export type EquipmentOrigin = 'auto' | 'manual';

/** An equipment product placed into a specific project (has position/rotation/instance id). */
export interface EquipmentInstance {
  instanceId: string;
  productId: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  wall?: 'front' | 'back' | 'left' | 'right';
  /** Whether this position came from the suggestion engine or was manually edited. */
  placementMode?: PlacementMode;
  origin?: EquipmentOrigin;
  /** Assigned AV rack. Optional. */
  rackId?: string;
  /** Bottom RU index (1-based). Optional. */
  rackPositionRU?: number;
  /** Consumed RU. Only when catalog or user provides it — never invented. */
  rackUnits?: number;
  /** Project mounting, when the catalog allows more than one. */
  mountingKind?: 'wall' | 'ceiling' | 'floor' | 'table' | 'rack' | 'freestanding';
}

export class EquipmentCatalog {
  private products = new Map<string, EquipmentProduct>();

  register(products: EquipmentProduct[]): void {
    products.forEach((p) => this.products.set(p.id, p));
  }

  get(id: string): EquipmentProduct | undefined {
    return this.products.get(id);
  }

  all(): EquipmentProduct[] {
    return Array.from(this.products.values());
  }

  byCategory(category: EquipmentCategory): EquipmentProduct[] {
    return this.all().filter((p) => p.category === category);
  }

  search(query: {
    category?: EquipmentCategory;
    manufacturer?: string;
    text?: string;
  }): EquipmentProduct[] {
    return this.all().filter((p) => {
      if (query.category && p.category !== query.category) return false;
      if (query.manufacturer && p.manufacturer !== query.manufacturer) return false;
      if (query.text) {
        const q = query.text.toLowerCase();
        const hay = `${p.id} ${p.manufacturer} ${p.model} ${p.type} ${p.category} ${p.family ?? ''} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  manufacturers(category?: EquipmentCategory): string[] {
    const list = category ? this.byCategory(category) : this.all();
    return Array.from(new Set(list.map((p) => p.manufacturer))).sort();
  }

  byGroup(groupId: string): EquipmentProduct[] {
    const group = CATEGORY_GROUPS.find((g) => g.id === groupId);
    if (!group) return [];
    return this.all().filter((p) => group.categories.includes(p.category));
  }

  /** Distinct display diagonal sizes present in the catalog, for the "Display Size" filter. */
  displaySizes(): number[] {
    return Array.from(
      new Set(this.byCategory('display').map((p) => p.display?.diagonalInches).filter((n): n is number => !!n))
    ).sort((a, b) => a - b);
  }

  /** Distinct display resolutions present in the catalog, for the "Resolution" filter. */
  displayResolutions(): string[] {
    return Array.from(
      new Set(this.byCategory('display').map((p) => p.display?.resolution).filter((r): r is string => !!r))
    ).sort();
  }
}
