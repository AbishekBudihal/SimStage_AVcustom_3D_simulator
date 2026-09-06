/**
 * LightingRenderer.ts
 * ────────────────────────────────────────────────────────────
 * Generates realistic 3D architectural lighting fixtures based on
 * room.lightingStyle (§17, §18).
 *
 * Supported styles:
 * - 'recessed_troffers': 2x2 or 2x4 ft troffer luminaire grids with frosted diffusers
 * - 'linear_pendants': Sleek suspended linear architectural LED runs with aircraft wire drops
 * - 'downlights': Architectural recessed circular LED can downlights
 * - 'perimeter_cove': Architectural perimeter indirect LED cove headers
 *
 * Environmental meshes are purely visual and tagged with fixtureType,
 * strictly decoupled from AV line-of-sight analysis and raycast engines (§19).
 * ────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import type { RoomModel } from './RoomModel';
import type { LightingStyle } from './RoomTemplateTypes';

// Material definitions for luminaires
const TROFFER_FRAME_MAT = new THREE.MeshStandardMaterial({
  color: 0xcccccc,
  roughness: 0.4,
  metalness: 0.2
});

const DIFFUSER_EMISSIVE_MAT = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfffaed,
  emissiveIntensity: 0.85,
  roughness: 0.9
});

const PENDANT_HOUSING_MAT = new THREE.MeshStandardMaterial({
  color: 0x22252a,
  roughness: 0.35,
  metalness: 0.8
});

const PENDANT_DIFFUSER_MAT = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffeedd,
  emissiveIntensity: 0.95,
  roughness: 0.8
});

const DOWNLIGHT_BEZEL_MAT = new THREE.MeshStandardMaterial({
  color: 0xdddddd,
  roughness: 0.3,
  metalness: 0.3
});

const DOWNLIGHT_LENS_MAT = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff4e6,
  emissiveIntensity: 1.0,
  roughness: 0.5
});

const SUSPENSION_WIRE_MAT = new THREE.MeshBasicMaterial({
  color: 0x888899
});

/**
 * Builds recessed troffers in an even grid matching ceiling height.
 */
function buildRecessedTroffers(w: number, d: number, h: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting-recessed-troffers';

  const tw = 0.6;
  const td = 1.2;
  const th = 0.04;

  const cols = Math.max(1, Math.floor((w - 1.2) / 2.2));
  const rows = Math.max(1, Math.floor((d - 1.2) / 2.2));

  const stepX = (w - 1.2) / (cols + 1);
  const stepZ = (d - 1.2) / (rows + 1);

  const frameGeo = new THREE.BoxGeometry(tw, th, td);
  const diffGeo = new THREE.PlaneGeometry(tw * 0.9, td * 0.9);

  for (let c = 1; c <= cols; c++) {
    for (let r = 1; r <= rows; r++) {
      const x = -w / 2 + 0.6 + c * stepX;
      const z = -d / 2 + 0.6 + r * stepZ;

      const troffer = new THREE.Group();
      troffer.position.set(x, h - th / 2, z);

      const frame = new THREE.Mesh(frameGeo, TROFFER_FRAME_MAT);
      const diffuser = new THREE.Mesh(diffGeo, DIFFUSER_EMISSIVE_MAT);
      diffuser.rotation.x = Math.PI / 2;
      diffuser.position.y = -th / 2 - 0.002;

      troffer.add(frame, diffuser);
      group.add(troffer);
    }
  }

  return group;
}

/**
 * Builds suspended linear pendant architectural LED luminaires.
 */
function buildLinearPendants(w: number, d: number, h: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting-linear-pendants';

  const drop = 0.55; // Suspended 0.55m below ceiling
  const fixtureY = h - drop;
  const pLength = Math.max(2.0, Math.min(d * 0.7, 4.8));
  const pWidth = 0.09;
  const pHeight = 0.08;

  const runs = w > 6.0 ? 2 : 1;
  const offsetsX = runs === 1 ? [0] : [-w * 0.2, w * 0.2];

  const housingGeo = new THREE.BoxGeometry(pWidth, pHeight, pLength);
  const diffuserGeo = new THREE.BoxGeometry(pWidth * 0.92, 0.015, pLength * 0.98);
  const wireGeo = new THREE.CylinderGeometry(0.002, 0.002, drop, 4);

  offsetsX.forEach((x) => {
    const pendant = new THREE.Group();
    pendant.position.set(x, fixtureY, 0);

    const housing = new THREE.Mesh(housingGeo, PENDANT_HOUSING_MAT);
    housing.castShadow = true;

    const diffuser = new THREE.Mesh(diffuserGeo, PENDANT_DIFFUSER_MAT);
    diffuser.position.y = -pHeight / 2;

    const wire1 = new THREE.Mesh(wireGeo, SUSPENSION_WIRE_MAT);
    wire1.position.set(0, pHeight / 2 + drop / 2, -pLength * 0.35);

    const wire2 = new THREE.Mesh(wireGeo, SUSPENSION_WIRE_MAT);
    wire2.position.set(0, pHeight / 2 + drop / 2, pLength * 0.35);

    pendant.add(housing, diffuser, wire1, wire2);
    group.add(pendant);
  });

  return group;
}

/**
 * Builds architectural recessed downlights (can lights).
 */
function buildDownlights(w: number, d: number, h: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting-downlights';

  const radius = 0.08;
  const bezelGeo = new THREE.RingGeometry(radius * 0.7, radius, 16);
  const lensGeo = new THREE.CircleGeometry(radius * 0.7, 16);

  const cols = Math.max(2, Math.floor((w - 1.0) / 1.8));
  const rows = Math.max(2, Math.floor((d - 1.0) / 1.8));

  const stepX = (w - 1.0) / (cols + 1);
  const stepZ = (d - 1.0) / (rows + 1);

  for (let c = 1; c <= cols; c++) {
    for (let r = 1; r <= rows; r++) {
      const x = -w / 2 + 0.5 + c * stepX;
      const z = -d / 2 + 0.5 + r * stepZ;

      const downlight = new THREE.Group();
      downlight.position.set(x, h - 0.005, z);
      downlight.rotation.x = Math.PI / 2;

      const bezel = new THREE.Mesh(bezelGeo, DOWNLIGHT_BEZEL_MAT);
      const lens = new THREE.Mesh(lensGeo, DOWNLIGHT_LENS_MAT);

      downlight.add(bezel, lens);
      group.add(downlight);
    }
  }

  return group;
}

/**
 * Builds architectural perimeter indirect LED cove headers.
 */
function buildPerimeterCove(w: number, d: number, h: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting-perimeter-cove';

  const coveDepth = 0.18;
  const coveHeight = 0.08;
  const coveY = h - coveHeight / 2 - 0.05;
  const hw = w / 2;
  const hd = d / 2;

  const coveMat = new THREE.MeshStandardMaterial({
    color: 0xfffcf0,
    emissive: 0xfff5dd,
    emissiveIntensity: 0.6,
    roughness: 0.7
  });

  const margin = 0.28;
  const effW = w - margin * 2;
  const effD = d - margin * 2;

  const fbGeo = new THREE.BoxGeometry(effW, coveHeight, coveDepth);
  const front = new THREE.Mesh(fbGeo, coveMat);
  front.position.set(0, coveY, -hd + margin);

  const back = new THREE.Mesh(fbGeo, coveMat);
  back.position.set(0, coveY, hd - margin);

  const lrGeo = new THREE.BoxGeometry(coveDepth, coveHeight, effD);
  const left = new THREE.Mesh(lrGeo, coveMat);
  left.position.set(-hw + margin, coveY, 0);

  const right = new THREE.Mesh(lrGeo, coveMat);
  right.position.set(hw - margin, coveY, 0);

  group.add(front, back, left, right);
  return group;
}

/**
 * Main ceiling lighting renderer.
 * Produces realistic Three.js fixtures according to room.lightingStyle.
 */
export function renderCeilingFixtures(room: RoomModel): THREE.Group {
  const root = new THREE.Group();
  root.name = 'room-lighting-fixtures';
  root.userData.nonObstructive = true;

  const { width: w, depth: d, height: h } = room;
  const style: LightingStyle = room.lightingStyle ?? 'recessed_troffers';

  switch (style) {
    case 'recessed_troffers':
      root.add(buildRecessedTroffers(w, d, h));
      break;
    case 'linear_pendants':
      root.add(buildLinearPendants(w, d, h));
      break;
    case 'downlights':
      root.add(buildDownlights(w, d, h));
      break;
    case 'perimeter_cove':
      root.add(buildPerimeterCove(w, d, h));
      break;
    default:
      root.add(buildRecessedTroffers(w, d, h));
      break;
  }

  return root;
}
