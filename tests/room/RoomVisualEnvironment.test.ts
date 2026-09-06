import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createDefaultRoom, type RoomModel } from '../../src/room/RoomModel';
import { renderCeilingFixtures } from '../../src/room/LightingRenderer';
import { renderSeating } from '../../src/room/SeatingRenderer';
import { generateRoomGeometry } from '../../src/room/RoomGenerator';
import type { LightingStyle, FurnitureStyle, WallStyle } from '../../src/room/RoomTemplateTypes';
import type { TableSpec, Seat } from '../../src/room/SeatingGenerator';

describe('Phase 7: Room Visual Quality, Furniture & Architectural Environment', () => {
  const baseRoom = createDefaultRoom('boardroom');

  describe('LightingRenderer ceiling fixtures (§17, §18)', () => {
    const lightingStyles: LightingStyle[] = [
      'recessed_troffers',
      'linear_pendants',
      'downlights',
      'perimeter_cove'
    ];

    lightingStyles.forEach((style) => {
      it(`renders ceiling fixtures for ${style}`, () => {
        const room: RoomModel = { ...baseRoom, lightingStyle: style };
        const fixtures = renderCeilingFixtures(room);
        expect(fixtures).toBeInstanceOf(THREE.Group);
        expect(fixtures.name).toBe('room-lighting-fixtures');
        expect(fixtures.userData.nonObstructive).toBe(true);
        expect(fixtures.children.length).toBeGreaterThan(0);
      });
    });

    it('keeps ceiling fixtures within room boundaries and at/below ceiling level', () => {
      const room: RoomModel = { ...baseRoom, lightingStyle: 'linear_pendants' };
      const fixtures = renderCeilingFixtures(room);
      const box = new THREE.Box3().setFromObject(fixtures);

      expect(box.min.x).toBeGreaterThanOrEqual(-room.width / 2 - 0.1);
      expect(box.max.x).toBeLessThanOrEqual(room.width / 2 + 0.1);
      expect(box.min.z).toBeGreaterThanOrEqual(-room.depth / 2 - 0.1);
      expect(box.max.z).toBeLessThanOrEqual(room.depth / 2 + 0.1);
      expect(box.max.y).toBeLessThanOrEqual(room.height + 0.1);
    });
  });

  describe('Furniture Quality & Styles (§17)', () => {
    const table: TableSpec = {
      id: 'conf-tbl-1',
      centerX: 0,
      centerZ: 0,
      sizeX: 1.6,
      sizeZ: 3.6,
      shape: 'rounded_rect',
      hasCableWell: true
    };

    const seats: Seat[] = [
      { id: 's-1', row: 1, indexInRow: 1, x: -0.7, z: 0, facing: 0, hasTable: true },
      { id: 's-2', row: 1, indexInRow: 2, x: 0.7, z: 0, facing: Math.PI, hasTable: true }
    ];

    const styles: FurnitureStyle[] = [
      'executive_wood',
      'modern_minimalist',
      'educational_laminate',
      'contemporary_office'
    ];

    styles.forEach((fStyle) => {
      it(`renders furniture with ${fStyle} palette`, () => {
        const seatingGroup = renderSeating(seats, [table], undefined, null, fStyle);
        expect(seatingGroup).toBeInstanceOf(THREE.Group);
        expect(seatingGroup.name).toBe('seating');

        // Verify pickable children
        let pickableChairs = 0;
        let pickableTables = 0;
        seatingGroup.traverse((obj) => {
          if (obj.userData.pickable === 'seat') pickableChairs++;
          if (obj.userData.pickable === 'table') pickableTables++;
        });

        expect(pickableChairs).toBeGreaterThan(0);
        expect(pickableTables).toBeGreaterThan(0);
      });
    });
  });

  describe('Wall Architectural Treatments (§16, §17)', () => {
    const wallStyles: WallStyle[] = [
      'painted_drywall',
      'acoustic_fabric_panels',
      'wood_paneling',
      'glass_storefront'
    ];

    wallStyles.forEach((wStyle) => {
      it(`generates room geometry with ${wStyle} wall style`, () => {
        const room: RoomModel = { ...baseRoom, wallStyle: wStyle };
        const geo = generateRoomGeometry(room);
        expect(geo).toBeInstanceOf(THREE.Group);
        expect(geo.name).toBe('room-architecture');

        // Check walls exist
        const walls = geo.children.filter((c) => c.name.startsWith('wall-'));
        expect(walls.length).toBe(4);

        if (wStyle !== 'painted_drywall') {
          // Verify treatments child group exists inside at least one wall
          const hasTreatments = walls.some((w) =>
            w.children.some((c) => c.name === 'wall-treatments')
          );
          expect(hasTreatments).toBe(true);
        }
      });
    });

    it('places baseboards along perimeter', () => {
      const room = createDefaultRoom('conference');
      const geo = generateRoomGeometry(room);
      const bbGroup = geo.children.find((c) => c.name === 'room-baseboards');
      expect(bbGroup).toBeDefined();
      expect(bbGroup?.children.length).toBe(4);
    });
  });
});
