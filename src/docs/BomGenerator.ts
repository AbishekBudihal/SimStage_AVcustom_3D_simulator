/**
 * BomGenerator.ts
 * Generates a Bill of Materials from project equipment.
 * Groups by product, counts quantities, tracks rack-mounted vs room-mounted.
 * Never invents pricing — only includes fields the catalog actually provides.
 */

import type { EquipmentInstance, EquipmentCatalog, EquipmentProduct } from '../catalog/EquipmentCatalog';

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
}

export interface BomReport {
  lines: BomLine[];
  totalItems: number;
  totalUniqueProducts: number;
  customDeviceCount: number;
}

/**
 * Generate BOM from placed equipment.
 * Groups by productId and aggregates quantity.
 */
export function generateBom(
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog
): BomReport {
  const grouped = new Map<string, { product: EquipmentProduct; instances: EquipmentInstance[] }>();

  for (const inst of equipment) {
    const product = catalog.get(inst.productId);
    if (!product) continue;
    const entry = grouped.get(inst.productId);
    if (entry) {
      entry.instances.push(inst);
    } else {
      grouped.set(inst.productId, { product, instances: [inst] });
    }
  }

  let idx = 0;
  const lines: BomLine[] = [];
  for (const [productId, { product, instances }] of grouped) {
    idx++;
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
      isCustomDevice: product.provenance === 'user_defined'
    });
  }

  return {
    lines,
    totalItems: equipment.length,
    totalUniqueProducts: lines.length,
    customDeviceCount: lines.filter((l) => l.isCustomDevice).length
  };
}

/**
 * Export BOM to CSV format.
 */
export function bomToCsv(report: BomReport): string {
  const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const header = 'Item,Manufacturer,Model,Category,Description,Qty,Rack Mounted,Custom Device';
  const rows = report.lines.map((l) =>
    [l.itemId, esc(l.manufacturer), esc(l.model), l.category, esc(l.description),
     l.quantity, l.rackMounted ? 'Yes' : 'No', l.isCustomDevice ? 'Yes' : 'No'].join(',')
  );
  return [header, ...rows].join('\n');
}
