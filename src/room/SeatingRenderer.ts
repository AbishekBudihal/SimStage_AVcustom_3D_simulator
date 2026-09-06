/**
 * SeatingRenderer.ts
 * Turns Seat[] + TableSpec[] (pure data) into actual chair/table geometry.
 * Uses InstancedMesh for the chair parts so 100+ seats (auditorium
 * scenario) stay cheap to render — the old prototype spawned a
 * fresh Mesh per chair, which doesn't scale.
 *
 * Tables are rendered directly from the TableSpec[] the generator
 * produces — this renderer does NOT infer table shape/position from seat
 * positions. That inference (grouping seats by row and drawing a box
 * around them) is what produced two disconnected table strips hugging a
 * boardroom's side walls instead of one conference table in the middle.
 */

import * as THREE from 'three';
import type { Seat, TableSpec } from './SeatingGenerator';
import type { CheckStatus } from '../av/ViewingDistanceEngine';
import type { FurnitureStyle } from './RoomTemplateTypes';
import { seatForward } from './RoomGeometry';

// Default and style-specific materials
export interface FurnitureMaterialPalette {
  tableMat: THREE.MeshStandardMaterial;
  tableEdgeMat: THREE.MeshStandardMaterial;
  pedestalMat: THREE.MeshStandardMaterial;
  legMat: THREE.MeshStandardMaterial;
  wellMat: THREE.MeshStandardMaterial;
  armMat?: THREE.MeshStandardMaterial;
}

const PALETTES: Record<FurnitureStyle, FurnitureMaterialPalette> = {
  executive_wood: {
    tableMat: new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.35, metalness: 0.05 }), // Dark walnut
    tableEdgeMat: new THREE.MeshStandardMaterial({ color: 0x2b1b17, roughness: 0.3 }),
    pedestalMat: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.6 }), // Brushed metal/dark base
    legMat: new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.3, metalness: 0.7 }),
    wellMat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.25, metalness: 0.8 }),
    armMat: new THREE.MeshStandardMaterial({ color: 0x2b1b17, roughness: 0.35 })
  },
  modern_minimalist: {
    tableMat: new THREE.MeshStandardMaterial({ color: 0xe8e4de, roughness: 0.45, metalness: 0.02 }), // Pale birch / matte white
    tableEdgeMat: new THREE.MeshStandardMaterial({ color: 0xd2ccc4, roughness: 0.4 }),
    pedestalMat: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.5 }), // Matte black steel
    legMat: new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.4, metalness: 0.6 }),
    wellMat: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.4 })
  },
  educational_laminate: {
    tableMat: new THREE.MeshStandardMaterial({ color: 0xc4b49b, roughness: 0.6, metalness: 0.0 }), // Durable neutral oak laminate
    tableEdgeMat: new THREE.MeshStandardMaterial({ color: 0x5a5d62, roughness: 0.7 }), // Black bumper edge
    pedestalMat: new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.5, metalness: 0.3 }),
    legMat: new THREE.MeshStandardMaterial({ color: 0x6a6d73, roughness: 0.45, metalness: 0.4 }),
    wellMat: new THREE.MeshStandardMaterial({ color: 0x3d4044, roughness: 0.4, metalness: 0.2 })
  },
  contemporary_office: {
    tableMat: new THREE.MeshStandardMaterial({ color: 0xb08962, roughness: 0.5 }), // Warm medium wood
    tableEdgeMat: new THREE.MeshStandardMaterial({ color: 0x8a6848, roughness: 0.45 }),
    pedestalMat: new THREE.MeshStandardMaterial({ color: 0x6a6d73, roughness: 0.4, metalness: 0.2 }),
    legMat: new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.45, metalness: 0.35 }),
    wellMat: new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.35, metalness: 0.2 })
  }
};

const defaultPalette = PALETTES.contemporary_office;
const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a6573, roughness: 0.55 });
const chairLegMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.45, metalness: 0.35 });
const selectedRingMat = new THREE.MeshBasicMaterial({ color: 0x2f8cff });

/** Seat-pan colors reflecting the actual viewing-analysis result for that seat (§2) — never decorative. */
const STATUS_COLOR: Record<CheckStatus, THREE.Color> = {
  pass: new THREE.Color(0x2fae5a),
  warning: new THREE.Color(0xe0a934),
  fail: new THREE.Color(0xd6483f)
};
const NO_ANALYSIS_COLOR = new THREE.Color(0x2b3a55);

/** One reusable chair "part set" — seat pan, backrest, 4 legs — built once, instanced per seat. */
function buildChairParts() {
  const pan = new THREE.BoxGeometry(0.42, 0.045, 0.4);
  const back = new THREE.BoxGeometry(0.42, 0.46, 0.04);
  const leg = new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8);
  return { pan, back, leg };
}

function renderChairs(
  root: THREE.Group,
  seats: Seat[],
  statusBySeatId?: Map<string, CheckStatus>,
  selectedSeatIds: string[] = []
): void {
  if (seats.length === 0) return;
  const selected = new Set(selectedSeatIds);

  const { pan, back, leg } = buildChairParts();
  const panMesh = new THREE.InstancedMesh(pan, seatMat, seats.length);
  const backMesh = new THREE.InstancedMesh(back, seatMat, seats.length);
  const legMeshes = [0, 1, 2, 3].map(() => new THREE.InstancedMesh(leg, chairLegMat, seats.length));
  [panMesh, backMesh, ...legMeshes].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
  });

  // Index -> seat id, so SceneManager's raycaster (which returns an InstancedMesh
  // intersection's `instanceId`, i.e. array index) can resolve a click to a seat.
  // Tag every chair part (not just the pan) with the same lookup so clicking a
  // backrest or leg still selects the seat, not just the exact seat-pan pixel.
  const seatIds = seats.map((s) => s.id);
  [panMesh, backMesh, ...legMeshes].forEach((mesh) => {
    mesh.userData.pickable = 'seat';
    mesh.userData.seatIds = seatIds;
  });

  const legOffsets: [number, number][] = [
    [0.18, 0.17], [-0.18, 0.17], [0.18, -0.17], [-0.18, -0.17]
  ];

  const m = new THREE.Matrix4();

  seats.forEach((seat, i) => {
    const seatY = 0.44;
    m.makeRotationY(seat.facing);
    m.setPosition(seat.x, seatY, seat.z);
    panMesh.setMatrixAt(i, m);

    const status = statusBySeatId?.get(seat.id);
    const color = status ? STATUS_COLOR[status] : NO_ANALYSIS_COLOR;
    panMesh.setColorAt(i, color);
    backMesh.setColorAt(i, color);

    if (selected.has(seat.id)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 24), selectedRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(seat.x, 0.02, seat.z);
      root.add(ring);
    }

    // The backrest sits BEHIND the seat pan — opposite the direction the
    // occupant faces — so it goes at seat - forward*offset, not seat +
    // forward*offset. (Placing it on the forward side is exactly the bug
    // that made chairs appear to face the wrong way.)
    const forward = seatForward(seat.facing);
    const backM = new THREE.Matrix4()
      .makeRotationY(seat.facing)
      .setPosition(
        seat.x - forward.x * 0.19,
        seatY + 0.25,
        seat.z - forward.z * 0.19
      );
    backMesh.setMatrixAt(i, backM);

    legOffsets.forEach(([lx, lz], li) => {
      const rot = seat.facing;
      const wx = seat.x + lx * Math.cos(rot) - lz * Math.sin(rot);
      const wz = seat.z + lx * Math.sin(rot) + lz * Math.cos(rot);
      const legM = new THREE.Matrix4().setPosition(wx, seatY / 2, wz);
      legMeshes[li].setMatrixAt(i, legM);
    });
  });

  panMesh.instanceMatrix.needsUpdate = true;
  backMesh.instanceMatrix.needsUpdate = true;
  if (panMesh.instanceColor) panMesh.instanceColor.needsUpdate = true;
  if (backMesh.instanceColor) backMesh.instanceColor.needsUpdate = true;
  legMeshes.forEach((lm) => (lm.instanceMatrix.needsUpdate = true));

  root.add(panMesh, backMesh, ...legMeshes);
}

function renderTables(root: THREE.Group, tables: TableSpec[], furnitureStyle: FurnitureStyle = 'contemporary_office'): void {
  const palette = PALETTES[furnitureStyle] ?? defaultPalette;

  tables.forEach((t) => {
    const group = new THREE.Group();
    group.position.set(t.centerX, 0, t.centerZ);
    group.userData.pickable = 'table';
    group.userData.tableId = t.id;

    const thickness = t.thickness ?? 0.04;
    const height = t.height ?? 0.73;
    const topY = height - thickness / 2;
    const shape = t.shape ?? 'rect';

    const top =
      shape === 'ellipse'
        ? new THREE.Mesh(new THREE.CylinderGeometry(Math.min(t.sizeX, t.sizeZ) / 2, Math.min(t.sizeX, t.sizeZ) / 2, thickness, 32), palette.tableMat)
        : new THREE.Mesh(new THREE.BoxGeometry(t.sizeX, thickness, t.sizeZ), palette.tableMat);
    if (shape === 'ellipse') top.rotation.y = 0;
    top.position.y = topY;
    top.castShadow = true;
    top.receiveShadow = true;
    top.userData.pickable = 'table';
    top.userData.tableId = t.id;
    group.add(top);

    if (shape === 'rounded_rect') {
      const inset = Math.min(0.08, t.sizeX * 0.06, t.sizeZ * 0.06);
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, t.sizeX - inset), thickness * 0.35, Math.max(0.2, t.sizeZ - inset)),
        palette.tableEdgeMat
      );
      lip.position.y = topY + thickness * 0.2;
      lip.userData.pickable = 'table';
      lip.userData.tableId = t.id;
      group.add(lip);
    }

    const conference = (t.sizeX > 0.85 && t.sizeZ > 1.2) || t.hasCableWell;
    if (conference && t.sizeX >= 0.9) {
      const pedW = Math.min(0.55, t.sizeX * 0.35);
      const pedH = height - thickness - 0.02;
      const pedD = Math.min(0.9, t.sizeZ * 0.28);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(pedW, pedH, pedD), palette.pedestalMat);
      ped.position.y = pedH / 2;
      ped.castShadow = true;
      ped.userData.pickable = 'table';
      ped.userData.tableId = t.id;
      group.add(ped);

      // Add base plate for executive or modern pedestals
      const basePlate = new THREE.Mesh(new THREE.BoxGeometry(pedW * 1.15, 0.018, pedD * 1.12), palette.legMat);
      basePlate.position.y = 0.009;
      group.add(basePlate);
    } else {
      const legH = height - thickness;
      const insetX = Math.max(0.08, t.sizeX / 2 - 0.08);
      const insetZ = Math.max(0.08, t.sizeZ / 2 - 0.08);
      [
        [insetX, insetZ],
        [-insetX, insetZ],
        [insetX, -insetZ],
        [-insetX, -insetZ]
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, legH, 8), palette.legMat);
        leg.position.set(lx, legH / 2, lz);
        leg.castShadow = true;
        leg.userData.pickable = 'table';
        leg.userData.tableId = t.id;
        group.add(leg);
      });
    }

    // Integrated wire management / cable well with brushed flip lid
    if (t.hasCableWell || (conference && t.sizeZ > 1.8)) {
      const wellW = Math.min(0.32, t.sizeX * 0.22);
      const wellD = Math.min(0.18, t.sizeZ * 0.15);
      const well = new THREE.Mesh(new THREE.BoxGeometry(wellW, 0.02, wellD), palette.wellMat);
      well.position.y = height + 0.005;
      well.userData.pickable = 'table';
      well.userData.tableId = t.id;

      // Flip lid trim
      const lidTrim = new THREE.Mesh(
        new THREE.BoxGeometry(wellW * 0.88, 0.004, wellD * 0.85),
        palette.pedestalMat
      );
      lidTrim.position.y = height + 0.012;
      group.add(well, lidTrim);
    }

    root.add(group);
  });
}

export function renderSeating(
  seats: Seat[],
  tables: TableSpec[],
  statusBySeatId?: Map<string, CheckStatus>,
  selectedSeatId?: string | string[] | null,
  furnitureStyle: FurnitureStyle = 'contemporary_office'
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'seating';
  if (seats.length === 0 && tables.length === 0) return root;

  const ids = Array.isArray(selectedSeatId) ? selectedSeatId : selectedSeatId ? [selectedSeatId] : [];
  renderChairs(root, seats, statusBySeatId, ids);
  renderTables(root, tables, furnitureStyle);

  return root;
}
