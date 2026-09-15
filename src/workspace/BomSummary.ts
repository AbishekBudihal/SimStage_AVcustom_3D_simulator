import type { DeviceState, DeviceKind } from './DeviceStore';
export interface BomRow { catalogId: string; kind: DeviceKind; quantity: number; power: number; heat: number; unknownPower: number; unknownHeat: number }
export function summarizeBom(devices: DeviceState['devices']) {
  const groups = new Map<string, BomRow>();
  let count = 0, power = 0, heat = 0, incomplete = 0;
  for (const device of Object.values(devices)) {
    if (!device) continue;
    const key = JSON.stringify([device.catalogId, device.kind]);
    const row = groups.get(key) ?? { catalogId: device.catalogId, kind: device.kind, quantity: 0, power: 0, heat: 0, unknownPower: 0, unknownHeat: 0 };
    row.quantity++; count++;
    const watts = device.metadata.powerWatts, btu = device.metadata.heatBtuPerHour;
    if (watts === null) row.unknownPower++; else { row.power += watts; power += watts; }
    if (btu === null) row.unknownHeat++; else { row.heat += btu; heat += btu; }
    if (watts === null || btu === null) incomplete++;
    groups.set(key, row);
  }
  return { rows: [...groups.values()], count, power, heat, incomplete };
}
