/**
 * RackRenderer.ts
 * Renders AV racks as Three.js geometry with rack-assigned equipment
 * physically inside the rack body. Equipment position is derived from
 * the rack's transform + RU position using RackTransform.
 */

import * as THREE from 'three';
import type { AVRack } from '../av/AVRack';
import { RU_HEIGHT_M } from '../av/AVRack';
import type { EquipmentInstance, EquipmentCatalog } from '../catalog/EquipmentCatalog';
import { equipmentWorldPosition, isRackRendered } from '../av/RackTransform';

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.25 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.4 });
const rackDeviceMat = new THREE.MeshStandardMaterial({ color: 0x5a5d64, roughness: 0.5, metalness: 0.3 });
const rackFaceMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.4, metalness: 0.5 });
const selectedMat = new THREE.MeshBasicMaterial({ color: 0x2f8cff, wireframe: true });

const doorMat = new THREE.MeshStandardMaterial({ color: 0x181a20, roughness: 0.2, metalness: 0.8, transparent: true, opacity: 0.3 });

export function renderRacks(
  racks: AVRack[],
  equipment: EquipmentInstance[],
  catalog: EquipmentCatalog,
  selectedId: string | null
): THREE.Group {
  const root = new THREE.Group();
  racks.forEach((rack) => {
    const g = new THREE.Group();

    // Top and bottom plates
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(rack.width, 0.04, rack.depth), bodyMat);
    topPlate.position.y = rack.height / 2 - 0.02;
    topPlate.castShadow = true;
    const bottomPlate = new THREE.Mesh(new THREE.BoxGeometry(rack.width, 0.04, rack.depth), bodyMat);
    bottomPlate.position.y = -rack.height / 2 + 0.02;
    bottomPlate.castShadow = true;

    // Side panels
    const panelH = rack.height - 0.08;
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.02, panelH, rack.depth), bodyMat);
    sideL.position.x = -rack.width / 2 + 0.01;
    sideL.castShadow = true;
    const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.02, panelH, rack.depth), bodyMat);
    sideR.position.x = rack.width / 2 - 0.01;
    sideR.castShadow = true;

    // Rear panel
    const rearPanel = new THREE.Mesh(new THREE.BoxGeometry(rack.width - 0.04, panelH, 0.02), bodyMat);
    rearPanel.position.z = -rack.depth / 2 + 0.01;
    rearPanel.castShadow = true;

    // Front vertical equipment mounting rails
    const railL = new THREE.Mesh(new THREE.BoxGeometry(0.025, panelH, 0.02), railMat);
    railL.position.set(-rack.width / 2 + 0.04, 0, rack.depth / 2 - 0.03);
    const railR = railL.clone();
    railR.position.x = rack.width / 2 - 0.04;

    // Front tinted door (gives enclosure look while letting inside equipment be visible)
    const door = new THREE.Mesh(new THREE.BoxGeometry(rack.width - 0.03, panelH, 0.005), doorMat);
    door.position.z = rack.depth / 2 - 0.003;

    g.add(topPlate, bottomPlate, sideL, sideR, rearPanel, railL, railR, door);

    // Render rack-assigned equipment inside the rack body
    const rackEquipment = equipment.filter(
      (e) => e.rackId === rack.id && isRackRendered(e)
    );
    rackEquipment.forEach((inst) => {
      const product = catalog.get(inst.productId);
      if (!product) return;

      const ru = inst.rackUnits ?? product.rackUnits ?? 1;
      const eqWidth = Math.min(product.physical.width, rack.width - 0.08); // fit inside rails
      const eqHeight = ru * RU_HEIGHT_M;
      const eqDepth = Math.min(product.physical.depth, rack.depth - 0.04);

      // Create equipment mesh as rack child
      const eqGroup = new THREE.Group();
      const eqBody = new THREE.Mesh(
        new THREE.BoxGeometry(eqWidth, eqHeight, eqDepth),
        rackDeviceMat
      );
      eqBody.castShadow = true;
      eqGroup.add(eqBody);

      // Front faceplate (lighter accent)
      const faceW = eqWidth * 0.92;
      const faceH = eqHeight * 0.6;
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(faceW, faceH, 0.006),
        rackFaceMat
      );
      face.position.z = eqDepth / 2 + 0.002;
      eqGroup.add(face);

      // Position relative to rack center
      const rackBottom = -rack.height / 2 + 0.04;
      const centerY = rackBottom + ((inst.rackPositionRU! - 1) * RU_HEIGHT_M) + (eqHeight / 2);
      const centerZ = rack.depth / 2 - eqDepth / 2 - 0.02;
      eqGroup.position.set(0, centerY, centerZ);

      // Tag for raycaster picking
      eqGroup.userData.instanceId = inst.instanceId;
      eqGroup.userData.pickable = 'equipment';
      eqGroup.traverse((obj) => {
        obj.userData.instanceId = inst.instanceId;
        obj.userData.pickable = 'equipment';
      });

      // Selection outline
      if (selectedId === inst.instanceId) {
        const outline = new THREE.Mesh(
          new THREE.BoxGeometry(eqWidth + 0.01, eqHeight + 0.01, eqDepth + 0.01),
          selectedMat
        );
        eqGroup.add(outline);
      }

      g.add(eqGroup);
    });

    g.position.set(rack.x, rack.y, rack.z);
    g.rotation.y = rack.rotationY;
    g.userData.rackId = rack.id;
    g.userData.pickable = 'rack';
    g.traverse((o) => {
      // Only set rackId on rack body parts, not on equipment children
      if (!o.userData.instanceId) {
        o.userData.rackId = rack.id;
        o.userData.pickable = 'rack';
      }
    });
    if (selectedId === rack.id) {
      const outline = new THREE.Mesh(new THREE.BoxGeometry(rack.width + 0.02, rack.height + 0.02, rack.depth + 0.02), selectedMat);
      g.add(outline);
    }
    root.add(g);
  });
  return root;
}
