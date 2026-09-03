import { describe, it, expect } from 'vitest';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { evaluateRackRequirement } from '../../src/av/RackRequirement';
import type { EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import { AppState } from '../../src/app/AppState';
import { createDefaultRoom } from '../../src/room/RoomModel';

const catalog = loadDefaultCatalog();

describe('Intelligent AV rack requirement', () => {
  it('returns required=false for huddle room with only room peripherals', () => {
    // Typical huddle room: display + USB camera + soundbar
    const equipment: EquipmentInstance[] = [
      {
        instanceId: 'disp-1',
        productId: 'lg-86uh5j', // display
        name: 'Main Display',
        position: { x: 0, y: 1.5, z: -3 },
        rotationY: 0,
        wall: 'front'
      },
      {
        instanceId: 'cam-1',
        productId: 'yealink-uvc84', // camera
        name: 'Conference Camera',
        position: { x: 0, y: 0.9, z: -2.9 },
        rotationY: 0,
        wall: 'front'
      },
      {
        instanceId: 'spk-1',
        productId: 'qsc-ad-s8t', // speaker
        name: 'Surface Speaker',
        position: { x: -1.2, y: 1.5, z: -3 },
        rotationY: 0,
        wall: 'front'
      }
    ];

    const result = evaluateRackRequirement(equipment, catalog);
    expect(result.required).toBe(false);
    expect(result.totalRU).toBe(0);
    expect(result.rackDeviceCount).toBe(0);
    expect(result.suggestedRackType).toBe('none');
    expect(result.reason).toContain('room-mounted peripherals');
  });

  it('returns required=true for system with DSP and amplifier', () => {
    const equipment: EquipmentInstance[] = [
      {
        instanceId: 'disp-1',
        productId: 'lg-86uh5j',
        name: 'Main Display',
        position: { x: 0, y: 1.5, z: -3 },
        rotationY: 0
      },
      {
        instanceId: 'dsp-1',
        productId: 'biamp-tesiraforte-vt4', // 1RU DSP
        name: 'Biamp DSP',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0
      },
      {
        instanceId: 'amp-1',
        productId: 'user-amp-2ch', // 2RU amplifier
        name: 'Power Amp',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0
      }
    ];

    const result = evaluateRackRequirement(equipment, catalog);
    expect(result.required).toBe(true);
    expect(result.rackDeviceCount).toBe(2);
    expect(result.totalRU).toBeGreaterThanOrEqual(2);
    expect(result.suggestedRackType).toBe('floor');
    expect(result.devices.map((d) => d.instanceId)).toEqual(['dsp-1', 'amp-1']);
  });

  it('suggests wall rack for single 1RU centralized device', () => {
    const equipment: EquipmentInstance[] = [
      {
        instanceId: 'dsp-1',
        productId: 'biamp-tesiraforte-vt4',
        name: 'Biamp DSP',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0
      }
    ];

    const result = evaluateRackRequirement(equipment, catalog);
    expect(result.required).toBe(true);
    expect(result.totalRU).toBe(1);
    expect(result.rackDeviceCount).toBe(1);
    expect(result.suggestedRackType).toBe('wall');
    expect(result.reason).toContain('compact wall-mount rack recommended');
  });

  it('honors explicit mountingKind=rack on any product', () => {
    const equipment: EquipmentInstance[] = [
      {
        instanceId: 'custom-rack-item',
        productId: 'user-laptop-source',
        name: 'Dedicated Media Player',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        mountingKind: 'rack',
        rackUnits: 2
      }
    ];

    const result = evaluateRackRequirement(equipment, catalog);
    expect(result.required).toBe(true);
    expect(result.totalRU).toBe(2);
    expect(result.devices[0].instanceId).toBe('custom-rack-item');
  });

  it('allows manual rack addition via AppState.addDefaultRack', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    expect(state.racks.length).toBe(0);

    const rack = state.addDefaultRack('floor');
    expect(state.racks.length).toBe(1);
    expect(rack.kind).toBe('floor');
    expect(rack.ruTotal).toBe(42);

    // Can delete manually added rack
    state.select('rack', rack.id);
    state.deleteSelected();
    expect(state.racks.length).toBe(0);
  });
});
