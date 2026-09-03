import { describe, it, expect } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { loadDefaultCatalog } from '../../src/catalog/loadCatalog';
import { createDefaultRoom } from '../../src/room/RoomModel';
import { displayFaceNormal, calculateHorizontalViewingAngle, calculateVisibility } from '../../src/av/ViewingDistanceEngine';
import { resolveActiveDisplay } from '../../src/av/DesignAnalysis';

const catalog = loadDefaultCatalog();

describe('Display rotation and orientation', () => {
  it('displayFaceNormal follows arbitrary rotationY accurately', () => {
    // 0 rad: faces +Z
    const normal0 = displayFaceNormal({ wall: 'front', rotationY: 0 } as any);
    expect(normal0.x).toBeCloseTo(0, 4);
    expect(normal0.z).toBeCloseTo(1, 4);

    // PI/2 rad (90 deg): faces +X
    const normal90 = displayFaceNormal({ wall: 'front', rotationY: Math.PI / 2 } as any);
    expect(normal90.x).toBeCloseTo(1, 4);
    expect(normal90.z).toBeCloseTo(0, 4);

    // PI rad (180 deg): faces -Z
    const normal180 = displayFaceNormal({ wall: 'front', rotationY: Math.PI } as any);
    expect(normal180.x).toBeCloseTo(0, 4);
    expect(normal180.z).toBeCloseTo(-1, 4);

    // PI/4 rad (45 deg): faces (+X, +Z)
    const normal45 = displayFaceNormal({ wall: 'front', rotationY: Math.PI / 4 } as any);
    expect(normal45.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(normal45.z).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('resolveActiveDisplay preserves rotationY even when wall metadata is set', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const displayProduct = catalog.get('lg-86uh5j')!;

    state.addEquipment({
      instanceId: 'disp-1',
      productId: displayProduct.id,
      name: 'Main Display',
      position: { x: 0, y: 1.5, z: -3 },
      rotationY: Math.PI / 4, // 45 deg angled display
      wall: 'front'
    });

    const active = resolveActiveDisplay(state.equipment, catalog);
    expect(active.kind).toBe('ok');
    if (active.kind === 'ok') {
      expect(active.placement.rotationY).toBeCloseTo(Math.PI / 4, 4);
      expect(active.placement.wall).toBe('front');
    }
  });

  it('viewer horizontal viewing angle changes when display is rotated', () => {
    const displayBase = {
      widthM: 2.0,
      heightM: 1.1,
      position: { x: 0, y: 1.5, z: -3 },
      wall: 'front' as const,
      rotationY: 0
    };

    // Viewer directly in front at (0, 1.2, 0)
    const viewerPos = { x: 0, y: 1.2, z: 0, eyeHeightM: 1.2 };
    const angleFacing = calculateHorizontalViewingAngle(displayBase as any, viewerPos as any);
    expect(angleFacing.value).toBeCloseTo(0, 1);

    // Now rotate display 45 degrees
    const displayRotated = { ...displayBase, rotationY: Math.PI / 4 };
    const angleRotated = calculateHorizontalViewingAngle(displayRotated as any, viewerPos as any);
    expect(angleRotated.value).toBeCloseTo(45, 1);

    // Viewer behind the display plane when rotated 135 degrees
    const displayReversed = { ...displayBase, rotationY: Math.PI * 0.75 };
    const visReversed = calculateVisibility(displayReversed as any, viewerPos as any);
    expect(visReversed.value).toBe('behind_display');
  });

  it('undo/redo restores display rotation angle correctly', () => {
    const state = new AppState();
    state.setRoom(createDefaultRoom('conference'));
    const displayProduct = catalog.get('lg-86uh5j')!;

    state.addEquipment({
      instanceId: 'disp-1',
      productId: displayProduct.id,
      name: 'Main Display',
      position: { x: 0, y: 1.5, z: -3 },
      rotationY: 0,
      wall: 'front'
    });

    // Rotate display to 30 degrees
    state.updateEquipment('disp-1', { rotationY: Math.PI / 6 });
    expect(state.equipment[0].rotationY).toBeCloseTo(Math.PI / 6, 4);

    // Undo rotation
    state.undo();
    expect(state.equipment[0].rotationY).toBeCloseTo(0, 4);

    // Redo rotation
    state.redo();
    expect(state.equipment[0].rotationY).toBeCloseTo(Math.PI / 6, 4);
  });
});
