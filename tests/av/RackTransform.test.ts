import { describe, it, expect } from 'vitest';
import { equipmentWorldPosition, isRackRendered } from '../../src/av/RackTransform';
import { defaultFloorRack, RU_HEIGHT_M } from '../../src/av/AVRack';

describe('Rack transform', () => {
  const rack = defaultFloorRack('rack-1');

  it('computes world Y from RU position', () => {
    const pos = equipmentWorldPosition(rack, 1, 1, 0.3);
    // RU 1 should be near the bottom of the rack
    const rackBottom = rack.y - rack.height / 2 + 0.04;
    expect(pos.y).toBeCloseTo(rackBottom + RU_HEIGHT_M / 2, 3);
  });

  it('higher RU = higher Y', () => {
    const low = equipmentWorldPosition(rack, 1, 1, 0.3);
    const high = equipmentWorldPosition(rack, 10, 1, 0.3);
    expect(high.y).toBeGreaterThan(low.y);
  });

  it('multi-RU equipment has correct center height', () => {
    const pos1 = equipmentWorldPosition(rack, 5, 2, 0.3);
    const pos2 = equipmentWorldPosition(rack, 5, 1, 0.3);
    // 2RU center should be half an RU higher than 1RU center at same position
    expect(pos1.y).toBeCloseTo(pos2.y + RU_HEIGHT_M / 2, 3);
  });

  it('inherits rack rotation', () => {
    const rotatedRack = { ...rack, rotationY: Math.PI / 4 };
    const pos = equipmentWorldPosition(rotatedRack, 1, 1, 0.3);
    expect(pos.rotationY).toBe(Math.PI / 4);
  });

  it('position offset affected by rack rotation', () => {
    const noRotation = equipmentWorldPosition({ ...rack, rotationY: 0 }, 1, 1, 0.3);
    const rotated = equipmentWorldPosition({ ...rack, rotationY: Math.PI / 2 }, 1, 1, 0.3);
    // Same Y (height doesn't depend on rotation)
    expect(noRotation.y).toBeCloseTo(rotated.y, 3);
    // But X/Z differ due to rotation
    expect(noRotation.x).not.toBeCloseTo(rotated.x, 2);
  });

  it('non-overlapping devices have different Y', () => {
    const dev1 = equipmentWorldPosition(rack, 1, 2, 0.3);
    const dev2 = equipmentWorldPosition(rack, 3, 2, 0.3);
    expect(Math.abs(dev2.y - dev1.y)).toBeCloseTo(2 * RU_HEIGHT_M, 3);
  });
});

describe('isRackRendered', () => {
  it('returns true for rack-assigned equipment with RU', () => {
    expect(isRackRendered({ rackId: 'r1', rackPositionRU: 3 })).toBe(true);
  });

  it('returns false without rackId', () => {
    expect(isRackRendered({ rackPositionRU: 3 })).toBe(false);
  });

  it('returns false without rackPositionRU', () => {
    expect(isRackRendered({ rackId: 'r1' })).toBe(false);
  });

  it('returns false for RU position 0 or negative', () => {
    expect(isRackRendered({ rackId: 'r1', rackPositionRU: 0 })).toBe(false);
    expect(isRackRendered({ rackId: 'r1', rackPositionRU: -1 })).toBe(false);
  });
});
