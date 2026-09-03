/**
 * EquipmentRenderer.ts
 * Turns EquipmentInstance[] (pure data + catalog lookups) into
 * actual Three.js geometry. Before this module existed, equipment
 * was added to AppState and shown in the Inspector, but never
 * appeared in the 3D scene — a placement had no visual result,
 * which is exactly the "isolated tested module" problem this pass
 * is meant to fix.
 *
 * Each root object gets userData.instanceId so SceneManager's
 * raycaster can resolve clicks back to an EquipmentInstance.
 */

import * as THREE from 'three';
import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';

const displayBodyMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.4 });
const displayScreenMat = new THREE.MeshStandardMaterial({
  color: 0x0d3a5c,
  emissive: 0x1c6fa8,
  emissiveIntensity: 0.55,
  roughness: 0.2,
  metalness: 0.1
});
const mountMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.6, metalness: 0.5 });
const speakerMat = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.5, metalness: 0.3 });
const micMat = new THREE.MeshStandardMaterial({ color: 0xd8d5cf, roughness: 0.4, metalness: 0.2 });
const cameraMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.3, metalness: 0.6 });
const genericMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.6 });

import { isRackRendered } from '../av/RackTransform';

const selectedOutlineMat = new THREE.LineBasicMaterial({ color: 0x2f8cff });

function buildDisplay(widthM: number, heightM: number, depthM: number): THREE.Group {
  const g = new THREE.Group();
  const depth = Math.max(0.04, depthM || 0.06);
  const body = new THREE.Mesh(new THREE.BoxGeometry(widthM, heightM, depth), displayBodyMat);
  body.castShadow = true;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM * 0.94, heightM * 0.9),
    displayScreenMat
  );
  screen.position.z = depth / 2 + 0.001;
  const mount = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.32, widthM * 0.2), 0.2, 0.08), mountMat);
  mount.position.z = -depth / 2 - 0.03;
  g.add(body, screen, mount);
  return g;
}

function buildSpeaker(widthM: number, heightM: number, depthM: number, mount?: string): THREE.Group {
  const g = new THREE.Group();
  const w = widthM || 0.22;
  const h = heightM || 0.1;
  const d = depthM || 0.22;
  if (mount === 'ceiling' || mount === 'pendant') {
    const r = Math.max(0.08, Math.max(w, d) / 2);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.04, h), 24), speakerMat);
    disc.castShadow = true;
    const grille = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, Math.max(0.02, h * 0.4), 20), mountMat);
    grille.position.y = -Math.max(0.02, h * 0.35);
    g.add(disc, grille);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), speakerMat);
    box.castShadow = true;
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, h) * 0.18, Math.min(w, h) * 0.28, d * 0.35, 12), mountMat);
    horn.rotation.x = Math.PI / 2;
    horn.position.z = d / 2;
    g.add(box, horn);
  }
  return g;
}

function buildMicrophone(widthM: number, heightM: number, mount?: string): THREE.Group {
  const g = new THREE.Group();
  const r = Math.max(0.04, (widthM || 0.12) / 2);
  if (mount === 'ceiling') {
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 20), micMat);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), mountMat);
    drop.position.y = -0.07;
    canopy.castShadow = true;
    g.add(canopy, drop);
  } else {
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.02, heightM || 0.025), 20), micMat);
    puck.castShadow = true;
    g.add(puck);
  }
  return g;
}

function buildCamera(widthM: number, heightM: number, depthM: number): THREE.Group {
  const g = new THREE.Group();
  const w = widthM || 0.12;
  const h = heightM || 0.08;
  const d = depthM || 0.18;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cameraMat);
  const lensR = Math.min(w, h) * 0.28;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(lensR, lensR, Math.max(0.03, d * 0.28), 16), cameraMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = d / 2 + 0.01;
  body.castShadow = true;
  const led = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.02, w * 0.12), Math.min(0.008, h * 0.12), 0.004), displayScreenMat);
  led.position.set(0, h * 0.32, d / 2 + 0.002);
  g.add(body, lens, led);
  return g;
}

function wallYaw(wall?: 'front' | 'back' | 'left' | 'right'): number {
  switch (wall) {
    case 'front': return 0;
    case 'back': return Math.PI;
    case 'left': return Math.PI / 2;
    case 'right': return -Math.PI / 2;
    default: return 0;
  }
}

export function renderEquipment(
  instances: EquipmentInstance[],
  catalog: EquipmentCatalog,
  selectedInstanceId: string | null
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'equipment';

  instances.forEach((inst) => {
    const product = catalog.get(inst.productId);
    if (!product) return;
    // Rack-mounted equipment is rendered inside the rack by RackRenderer
    if (isRackRendered(inst)) return;

    let mesh: THREE.Group;
    switch (product.category) {
      case 'display':
        mesh = buildDisplay(product.physical.width, product.physical.height, product.physical.depth);
        break;
      case 'speaker':
        mesh = buildSpeaker(
          product.physical.width,
          product.physical.height,
          product.physical.depth,
          product.speaker?.mount
        );
        break;
      case 'microphone':
        mesh = buildMicrophone(product.physical.width, product.physical.height, product.microphone?.mount);
        break;
      case 'camera':
        mesh = buildCamera(product.physical.width, product.physical.height, product.physical.depth);
        break;
      default: {
        const g = new THREE.Group();
        const w = product.physical.width || 0.3;
        const h = product.physical.height || 0.044;
        const d = product.physical.depth || 0.1;
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), genericMat);
        box.castShadow = true;
        g.add(box);
        if (product.rackUnits != null || product.category === 'dsp' || product.category === 'amplifier' || product.category === 'switcher') {
          const face = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.55, 0.008), mountMat);
          face.position.z = d / 2 + 0.002;
          g.add(face);
        }
        mesh = g;
      }
    }

    mesh.position.set(inst.position.x, inst.position.y, inst.position.z);
    mesh.rotation.y = inst.rotationY !== undefined ? inst.rotationY : (inst.wall ? wallYaw(inst.wall) : 0);
    mesh.userData.instanceId = inst.instanceId;
    mesh.userData.pickable = 'equipment';
    // tag every child mesh too so raycaster intersections (which hit children) resolve to the instance
    mesh.traverse((obj) => {
      obj.userData.instanceId = inst.instanceId;
      obj.userData.pickable = 'equipment';
    });

    if (inst.instanceId === selectedInstanceId) {
      // Collect target meshes first, THEN add outlines — mutating an object's
      // children while `traverse` is walking that same object's child array
      // would make the freshly-added outline mesh visible to the traversal
      // too, which (since it's also a Mesh) would recursively wrap itself.
      const targets: THREE.Mesh[] = [];
      mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) targets.push(obj as THREE.Mesh);
      });
      targets.forEach((obj) => {
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(obj.geometry), selectedOutlineMat);
        outline.scale.setScalar(1.02);
        obj.add(outline);
      });
    }

    root.add(mesh);
  });

  return root;
}
