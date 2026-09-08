/**
 * BomGenerator.ts
 * Generates a Bill of Materials from project equipment.
 * Groups by product, counts quantities, tracks rack-mounted vs room-mounted.
 * Never invents pricing — only includes fields the catalog actually provides.
 */

import type { EquipmentInstance, EquipmentCatalog, EquipmentProduct, ProvenanceTier, DataProvenance } from '../catalog/EquipmentCatalog';
import type { AVRack } from '../av/AVRack';
import type { SystemConnection } from '../system/SystemTypes';
import type { CableScheduleResult } from '../system/CableSchedule';

export interface BomLine {
  /** BOM item reference (B-001, B-002, ...) */
  itemId: string;
  productId: string;
  manufacturer: string;
  model: string;
  category: string;
  description: string;
  quantity: number;
  /** Instance IDs of all placed items of this product. */
  equipmentIds: string[];
  /** True if any instance is rack-mounted. */
  rackMounted: boolean;
  /** True if this is a user-created device. */
  isCustomDevice: boolean;
  /** Manufacturer part number / SKU if declared */
  partNumber?: string;
  /** Data provenance tier */
  provenance: ProvenanceTier | DataProvenance;
  /** Power consumption in watts (single unit) */
  powerWatts?: number;
  /** Estimated unit cost if available */
  unitCost?: number;
  /** Classification of the line item */
  lineKind: 'equipment' | 'rack' | 'cable' | 'accessory';
}

export interface BomOptions {
  racks?: AVRack[];
  connections?: SystemConnection[];
  cableSchedule?: CableScheduleResult;
}

export interface BomReport {
  lines: BomLine[];
  totalItems: number;
  totalUniqueProducts: number;
  customDeviceCount: number;
  totalPowerWatts: number;
  poePowerWatts: number;
  rackCount: number;
  totalCableLengthM: number;
}

/**
 * Generate BOM from placed equipment and optional racks/cables.
 * Groups by productId and aggregates quantity.
 */
export function generateBom(
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog,
  options?: BomOptions
): BomReport {
  const grouped = new Map<string, { product: EquipmentProduct; instances: EquipmentInstance[] }>();

  let totalPowerWatts = 0;
  let poePowerWatts = 0;

  for (const inst of equipment) {
    const product = catalog.get(inst.productId);
    if (!product) continue;
    const entry = grouped.get(inst.productId);
    if (entry) {
      entry.instances.push(inst);
    } else {
      grouped.set(inst.productId, { product, instances: [inst] });
    }

    const watts = product.power?.powerWatts ?? product.physical.powerWatts ?? 0;
    totalPowerWatts += watts;
    if (product.power?.poeClass != null) {
      poePowerWatts += watts;
    }
  }

  let idx = 0;
  const lines: BomLine[] = [];
  for (const [productId, { product, instances }] of grouped) {
    idx++;
    const watts = product.power?.powerWatts ?? product.physical.powerWatts;
    lines.push({
      itemId: `B-${String(idx).padStart(3, '0')}`,
      productId,
      manufacturer: product.manufacturer,
      model: product.model,
      category: product.category,
      description: product.description ?? product.type,
      quantity: instances.length,
      equipmentIds: instances.map((i) => i.instanceId),
      rackMounted: instances.some((i) => i.rackId != null),
      isCustomDevice: product.provenance === 'user_defined',
      partNumber: product.partNumber ?? product.sku,
      provenance: product.provenance ?? 'manufacturer_verified',
      powerWatts: watts && watts > 0 ? watts : undefined,
      lineKind: 'equipment'
    });
  }

  // Include physical racks if provided
  const racks = options?.racks ?? [];
  for (const rack of racks) {
    idx++;
    lines.push({
      itemId: `B-${String(idx).padStart(3, '0')}`,
      productId: `rack-${rack.id}`,
      manufacturer: 'AV Rack Enclosure',
      model: `${rack.ruTotal}RU ${rack.kind === 'floor' ? 'Floor' : 'Wall'} Rack`,
      category: 'rack',
      description: `${rack.ruTotal}RU equipment cabinet (${rack.width}m W × ${rack.depth}m D × ${rack.height}m H)`,
      quantity: 1,
      equipmentIds: [rack.id],
      rackMounted: false,
      isCustomDevice: false,
      provenance: 'manufacturer_verified',
      lineKind: 'rack'
    });
  }

  // Include cable runs aggregated by media type if provided
  let totalCableLengthM = 0;
  if (options?.cableSchedule && options.cableSchedule.rows.length > 0) {
    totalCableLengthM = options.cableSchedule.summary.totalEstimatedLengthM;
    for (const group of options.cableSchedule.summary.byType) {
      idx++;
      lines.push({
        itemId: `B-${String(idx).padStart(3, '0')}`,
        productId: `cable-${group.cableType.toLowerCase()}`,
        manufacturer: 'Structured Cabling',
        model: `${group.cableType} Infrastructure Cable`,
        category: 'cable',
        description: `${group.count} runs · ${group.totalLengthM.toFixed(1)} m total run length (estimated)`,
        quantity: group.count,
        equipmentIds: [],
        rackMounted: false,
        isCustomDevice: false,
        provenance: 'engineering_estimate',
        lineKind: 'cable'
      });
    }
  }

  const cableItemCount = options?.cableSchedule?.rows.length ?? 0;
  const totalItems = equipment.length + racks.length + cableItemCount;

  return {
    lines,
    totalItems,
    totalUniqueProducts: lines.length,
    customDeviceCount: lines.filter((l) => l.isCustomDevice).length,
    totalPowerWatts: Number(totalPowerWatts.toFixed(1)),
    poePowerWatts: Number(poePowerWatts.toFixed(1)),
    rackCount: racks.length,
    totalCableLengthM: Number(totalCableLengthM.toFixed(1))
  };
}

/**
 * Export BOM to CSV format.
 */
export function bomToCsv(report: BomReport): string {
  const esc = (s: string) => '"' + (s ?? '').replace(/"/g, '""') + '"';
  const header = 'Item,Manufacturer,Model,Part Number,Category,Kind,Description,Qty,Power (W),Rack Mounted,Custom Device';
  const rows = report.lines.map((l) =>
    [
      l.itemId,
      esc(l.manufacturer),
      esc(l.model),
      esc(l.partNumber ?? '—'),
      l.category,
      l.lineKind,
      esc(l.description),
      l.quantity,
      l.powerWatts != null ? l.powerWatts : '—',
      l.rackMounted ? 'Yes' : 'No',
      l.isCustomDevice ? 'Yes' : 'No'
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Export BOM to structured JSON format.
 */
export function bomToJson(report: BomReport): string {
  return JSON.stringify(report, null, 2);
}
