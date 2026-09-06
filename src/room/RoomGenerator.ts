/**
 * RoomGenerator.ts
 * ────────────────────────────────────────────────────────────
 * Converts a RoomModel (pure data) into real architectural Three.js
 * geometry: walls with door/window cutouts, floor with environmental
 * finishes, architectural ceiling grid, baseboard trims, and columns.
 *
 * Implements the visual upgrade specified in §16 & §17 while remaining
 * strictly decoupled from AV engineering engines (§19).
 * ────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import type { RoomModel, Opening } from './RoomModel';
import type { FlooringType, WallStyle, CeilingType } from './RoomTemplateTypes';

const BASE_MATERIALS = {
  wall: new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide }),
  wallAccentWood: new THREE.MeshStandardMaterial({ color: 0x6e4e37, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }),
  wallAccentAcoustic: new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide }),
  wallGlass: new THREE.MeshPhysicalMaterial({ color: 0xd8eaf2, transparent: true, opacity: 0.35, roughness: 0.1, transmission: 0.7, side: THREE.DoubleSide }),
  floorCarpetTile: new THREE.MeshStandardMaterial({ color: 0x474f5d, roughness: 0.92, metalness: 0.02 }),
  floorBroadloom: new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.95, metalness: 0.01 }),
  floorHardwood: new THREE.MeshStandardMaterial({ color: 0xab7a4e, roughness: 0.65, metalness: 0.05 }),
  floorConcrete: new THREE.MeshStandardMaterial({ color: 0xb0b5b8, roughness: 0.5, metalness: 0.15 }),
  floorVinyl: new THREE.MeshStandardMaterial({ color: 0xd2d6dc, roughness: 0.75, metalness: 0.03 }),
  ceilingAcoustic: new THREE.MeshStandardMaterial({ color: 0xf5f4f2, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
  ceilingPlenum: new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide }),
  ceilingWoodSlat: new THREE.MeshStandardMaterial({ color: 0x7c5a3f, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe3f0, transparent: true, opacity: 0.25, roughness: 0.05, transmission: 0.6 }),
  door: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.6 }),
  baseboard: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.8, metalness: 0.1 }),
  column: new THREE.MeshStandardMaterial({ color: 0xd8d5cf, roughness: 0.85 })
};

function resolveFloorMaterial(type?: FlooringType): THREE.Material {
  switch (type) {
    case 'executive_broadloom':
      return BASE_MATERIALS.floorBroadloom;
    case 'hardwood':
      return BASE_MATERIALS.floorHardwood;
    case 'polished_concrete':
      return BASE_MATERIALS.floorConcrete;
    case 'resilient_vinyl':
      return BASE_MATERIALS.floorVinyl;
    case 'corporate_carpet_tile':
    default:
      return BASE_MATERIALS.floorCarpetTile;
  }
}

function resolveWallMaterial(wallStyle?: WallStyle, isPresentationWall = false): THREE.Material {
  if (!isPresentationWall) return BASE_MATERIALS.wall;

  switch (wallStyle) {
    case 'wood_paneling':
      return BASE_MATERIALS.wallAccentWood;
    case 'acoustic_fabric_panels':
      return BASE_MATERIALS.wallAccentAcoustic;
    case 'glass_storefront':
      return BASE_MATERIALS.wallGlass;
    case 'painted_drywall':
    default:
      return BASE_MATERIALS.wall;
  }
}

function resolveCeilingMaterial(type?: CeilingType): THREE.Material {
  switch (type) {
    case 'open_plenum':
      return BASE_MATERIALS.ceilingPlenum;
    case 'wood_slat':
      return BASE_MATERIALS.ceilingWoodSlat;
    case 'acoustic_grid_2x2':
    case 'acoustic_grid_2x4':
    case 'drywall_hardlid':
    default:
      return BASE_MATERIALS.ceilingAcoustic;
  }
}

/** Builds one wall (a rectangular Shape with rectangular holes for its openings), extruded to wallThickness. */
function buildWall(
  lengthAlongWall: number,
  height: number,
  thickness: number,
  openings: Opening[],
  material: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(lengthAlongWall, 0);
  shape.lineTo(lengthAlongWall, height);
  shape.lineTo(0, height);
  shape.lineTo(0, 0);

  openings.forEach((o) => {
    const hole = new THREE.Path();
    const x0 = o.offset;
    const y0 = o.sillHeight;
    hole.moveTo(x0, y0);
    hole.lineTo(x0 + o.width, y0);
    hole.lineTo(x0 + o.width, y0 + o.height);
    hole.lineTo(x0, y0 + o.height);
    hole.lineTo(x0, y0);
    shape.holes.push(hole);
  });

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Fill openings: doors get a solid leaf, windows get glass
  openings.forEach((o) => {
    const filler = new THREE.Mesh(
      new THREE.BoxGeometry(o.width * 0.94, o.height * 0.96, thickness * 0.4),
      o.kind === 'door' ? BASE_MATERIALS.door : BASE_MATERIALS.glass
    );
    filler.position.set(o.offset + o.width / 2, o.sillHeight + o.height / 2, thickness / 2);
    group.add(filler);
  });

  return group;
}

/**
 * Adds architectural wall embellishments (acoustic panels, wood slats, glass storefront mullions)
 * positioned cleanly along the wall without clipping through door/window openings.
 */
function buildWallTreatments(
  wallLen: number,
  wallH: number,
  wallStyle: WallStyle,
  openings: Opening[],
  isPresentationWall: boolean
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wall-treatments';

  // Function to check if a treatment element collides with an opening
  const collidesWithOpening = (startX: number, endX: number, minY: number, maxY: number): boolean => {
    return openings.some((o) => {
      const oLeft = o.offset - 0.1;
      const oRight = o.offset + o.width + 0.1;
      const oBottom = o.sillHeight - 0.05;
      const oTop = o.sillHeight + o.height + 0.05;
      return !(endX < oLeft || startX > oRight || maxY < oBottom || minY > oTop);
    });
  };

  if (wallStyle === 'acoustic_fabric_panels') {
    // Modular beveled acoustic wall panels: 0.6m wide x 1.2m high, 0.03m thick
    const pw = 0.6;
    const ph = 1.2;
    const pt = 0.03;
    const py = 1.6; // Center at ear/speaking height (1.6m AFF)
    const spacing = 0.85;
    const count = Math.floor((wallLen - 0.8) / spacing);

    const panelGeo = new THREE.BoxGeometry(pw, ph, pt);
    const panelMat = isPresentationWall ? BASE_MATERIALS.wallAccentAcoustic : BASE_MATERIALS.wallAccentAcoustic;

    for (let i = 0; i < count; i++) {
      const px = 0.6 + i * spacing + pw / 2;
      if (!collidesWithOpening(px - pw / 2, px + pw / 2, py - ph / 2, py + ph / 2)) {
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(px, py, -pt / 2 - 0.005);
        panel.castShadow = true;
        group.add(panel);
      }
    }
  } else if (wallStyle === 'wood_paneling') {
    // Vertical wood slats: 0.08m wide x full wall height, 0.025m proud of wall
    const slatW = 0.08;
    const slatH = wallH * 0.9;
    const slatT = 0.025;
    const slatSpacing = 0.14;
    const slatGeo = new THREE.BoxGeometry(slatW, slatH, slatT);
    const slatMat = BASE_MATERIALS.wallAccentWood;

    const count = Math.floor((wallLen - 0.4) / slatSpacing);
    for (let i = 0; i < count; i++) {
      const sx = 0.3 + i * slatSpacing + slatW / 2;
      if (!collidesWithOpening(sx - slatW / 2, sx + slatW / 2, 0.1, slatH)) {
        const slat = new THREE.Mesh(slatGeo, slatMat);
        slat.position.set(sx, slatH / 2, -slatT / 2 - 0.004);
        group.add(slat);
      }
    }
  } else if (wallStyle === 'glass_storefront') {
    // Aluminum mullion frames spaced every 1.5m
    const mullionW = 0.05;
    const mullionT = 0.04;
    const mullionGeo = new THREE.BoxGeometry(mullionW, wallH, mullionT);
    const mullionMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.4, metalness: 0.6 });

    const count = Math.floor(wallLen / 1.5);
    for (let i = 1; i <= count; i++) {
      const mx = i * 1.5;
      if (!collidesWithOpening(mx - mullionW / 2, mx + mullionW / 2, 0, wallH)) {
        const mullion = new THREE.Mesh(mullionGeo, mullionMat);
        mullion.position.set(mx, wallH / 2, -mullionT / 2);
        group.add(mullion);
      }
    }
  }

  return group;
}

/** Adds architectural baseboard trims along the wall-floor perimeter. */
function buildBaseboards(w: number, d: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-baseboards';
  const bh = 0.09; // 90mm height
  const bt = 0.015; // 15mm thickness
  const hw = w / 2;
  const hd = d / 2;

  // Front & Back baseboards
  const fbGeo = new THREE.BoxGeometry(w, bh, bt);
  const frontBb = new THREE.Mesh(fbGeo, BASE_MATERIALS.baseboard);
  frontBb.position.set(0, bh / 2, -hd + bt / 2);
  const backBb = new THREE.Mesh(fbGeo, BASE_MATERIALS.baseboard);
  backBb.position.set(0, bh / 2, hd - bt / 2);

  // Left & Right baseboards
  const lrGeo = new THREE.BoxGeometry(bt, bh, d);
  const leftBb = new THREE.Mesh(lrGeo, BASE_MATERIALS.baseboard);
  leftBb.position.set(-hw + bt / 2, bh / 2, 0);
  const rightBb = new THREE.Mesh(lrGeo, BASE_MATERIALS.baseboard);
  rightBb.position.set(hw - bt / 2, bh / 2, 0);

  group.add(frontBb, backBb, leftBb, rightBb);
  return group;
}

export function generateRoomGeometry(room: RoomModel): THREE.Group {
  const root = new THREE.Group();
  root.name = 'room-architecture';
  const { width: w, depth: d, height: h, wallThickness: t } = room;
  const hw = w / 2;
  const hd = d / 2;
  const presWall = room.presentationWall ?? 'front';

  // Floor with environment finish
  const floorMat = resolveFloorMaterial(room.flooringType);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);

  // Ceiling with environment finish
  const ceilMat = resolveCeilingMaterial(room.ceilingType);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  ceiling.name = 'ceiling';
  root.add(ceiling);

  // Baseboard trims (§16 office realism)
  root.add(buildBaseboards(w, d));

  // Walls — front (-z), back (+z), left (-x), right (+x)
  const wallDefs: { key: Opening['wall']; length: number; pos: THREE.Vector3; rotY: number }[] = [
    { key: 'front', length: w, pos: new THREE.Vector3(-hw, 0, -hd), rotY: 0 },
    { key: 'back', length: w, pos: new THREE.Vector3(hw, 0, hd), rotY: Math.PI },
    { key: 'left', length: d, pos: new THREE.Vector3(-hw, 0, hd), rotY: Math.PI / 2 },
    { key: 'right', length: d, pos: new THREE.Vector3(hw, 0, -hd), rotY: -Math.PI / 2 }
  ];

  wallDefs.forEach((def) => {
    const isPresentation = def.key === presWall;
    const wallMat = resolveWallMaterial(room.wallStyle, isPresentation);
    const openings = room.openings.filter((o) => o.wall === def.key);
    const wall = buildWall(def.length, h, t, openings, wallMat);
    wall.position.copy(def.pos);
    wall.rotation.y = def.rotY;
    wall.name = `wall-${def.key}`;

    // Add architectural wall treatments if specified
    if (room.wallStyle && room.wallStyle !== 'painted_drywall') {
      const treatments = buildWallTreatments(def.length, h, room.wallStyle, openings, isPresentation);
      wall.add(treatments);
    }

    root.add(wall);
  });

  // Columns
  room.columns.forEach((c, i) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(c.width, h, c.depth), BASE_MATERIALS.column);
    col.position.set(c.x, h / 2, c.z);
    col.name = `column-${i}`;
    col.castShadow = true;
    root.add(col);
  });

  return root;
}
