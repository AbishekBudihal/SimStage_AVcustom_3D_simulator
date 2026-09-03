/**
 * SceneManager.ts
 * Owns the Three.js scene/renderer lifecycle. Reacts to AppState
 * changes (room, seats, equipment, selection, viewer mode) by
 * rebuilding only the groups that changed.
 *
 * Phase A adds TransformControls for direct manipulation of AV
 * equipment, intelligent snapping on drag end, and focus-on-selection.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { AppState } from '../app/AppState';
import { generateRoomGeometry } from '../room/RoomGenerator';
import { renderSeating } from '../room/SeatingRenderer';
import { renderEquipment } from '../room/EquipmentRenderer';
import { renderRacks } from '../room/RackRenderer';
import { CameraController } from './CameraController';
import { loadDefaultCatalog } from '../catalog/loadCatalog';
import type { CheckStatus, DisplayPlacement } from '../av/ViewingDistanceEngine';
import { DEFAULT_EYE_HEIGHT_M, getActiveDisplay, computeSeatStatuses, projectObstacles } from '../av/DesignAnalysis';
import { computeViewerPose } from '../av/ViewerPose';
import { cachedCoverage } from '../av/coverageCache';
import { cachedMicCoverage } from '../av/micCoverageCache';
import { occupantEyeWorld } from '../av/simulation/OccupantPoint';
import { contourPolylines, fieldFromCells } from '../av/simulation/SpatialField';
import { evaluateSightlineDetailed } from '../av/SightlineEngine';
import { addFloorHeatmap } from './HeatmapMesh';
import { addPickupRegionOverlay } from './PickupRegionMesh';
import { addContourOverlay } from './ContourOverlay';
import { addSightlineRay } from './SightlineOverlay';
import { addCameraFrustumOverlay } from './FrustumOverlay';
import { addSpeakerCoverageVolume } from './CoverageVolumeOverlay';
import { addCableRouteOverlays } from './CableRouteOverlay';
import { cachedCableRoute } from '../system/CableRouter';
import { cableRouteContext } from '../system/cableContext';
import { isCableSelected, shouldDrawConnection, shouldShowCableRoutes } from '../system/cableVisibility';
import { snapEquipment } from '../interaction/SnapEngine';
import { evaluatePlacement } from '../av/PlacementFeedback';
import {
  computeSeatMicStatuses,
  resolveProjectMicrophones,
  usableMicPlacements
} from '../av/MicAnalysis';
import { cachedSpeakerCoverage } from '../av/speakerCoverageCache';
import {
  computeSeatAudioStatuses,
  resolveProjectSpeakers,
  usableSpeakerPlacements
} from '../av/SpeakerAnalysis';
import { cachedCameraCoverage } from '../av/cameraCoverageCache';
import {
  computeSeatCameraStatuses,
  resolveProjectCameras,
  summarizeCameraCoverage,
  usableCameraPlacements
} from '../av/CameraAnalysis';

const catalog = loadDefaultCatalog();

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraController: CameraController;

  private roomGroup = new THREE.Group();
  private seatingGroup = new THREE.Group();
  private equipmentGroup = new THREE.Group();
  private rackGroup = new THREE.Group();
  private analysisGroup = new THREE.Group();
  private cableGroup = new THREE.Group();
  private transformControls: TransformControls;
  private selectedMesh: THREE.Object3D | null = null;
  private heatmapMesh: THREE.Mesh | null = null;

  private lastRoomSignature = '';
  private lastSeatsSignature = '';
  private lastEquipSignature = '';
  private lastRacksSignature = '';
  private lastSelectionSignature = '';
  private lastViewerSignature = '';
  private lastTransformMode = '';
  private lastFocusRequest = 0;
  private lastCameraViewTick = 0;
  private lastFindingFocus = 0;
  private lastAnalysisSignature = '';
  private lastVizBuildSignature = '';
  private lastCableSignature = '';
  private dragging = false;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  constructor(private container: HTMLElement, private state: AppState) {
    this.scene.background = new THREE.Color(0xf2f1ee);
    this.scene.add(this.roomGroup, this.seatingGroup, this.equipmentGroup, this.rackGroup, this.analysisGroup, this.cableGroup);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.cameraController = new CameraController(container);

    this.transformControls = new TransformControls(this.cameraController.camera, this.renderer.domElement);
    this.transformControls.setSize(0.85);
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.dragging = (e as { value: boolean }).value;
      this.cameraController.controls.enabled = !this.dragging;
      if (this.dragging) this.state.prepareHistory();
    });
    this.transformControls.addEventListener('objectChange', () => this.onTransformChange());
    this.scene.add(this.transformControls);

    this.setupLighting();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));

    state.subscribe(() => this.sync());
    this.sync();
    this.animate();
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x60564a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    this.scene.add(sun);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraController.setAspect(w / h);
  }

  private activeDisplay(): DisplayPlacement | null {
    return getActiveDisplay(this.state.equipment, catalog);
  }

  private sync(): void {
    const room = this.state.room;
    if (room) {
      const sig = JSON.stringify(room);
      if (sig !== this.lastRoomSignature) {
        this.lastRoomSignature = sig;
        while (this.roomGroup.children.length) this.roomGroup.remove(this.roomGroup.children[0]);
        this.roomGroup.add(generateRoomGeometry(room));
        if (!this.state.viewerMode.active) this.cameraController.frameRoom(room.width, room.depth, room.height);
      }
    }

    const seatsSig = JSON.stringify(this.state.seats) + JSON.stringify(this.state.tables);
    const racksSig = JSON.stringify(this.state.racks);
    const equipSig = JSON.stringify(this.state.equipment);
    const selectionSig = JSON.stringify(this.state.selection) + JSON.stringify(this.state.highlightedSeatIds);
    const analysisSig =
      JSON.stringify(this.state.displayAnalysis) +
      JSON.stringify(this.state.micAnalysis) +
      JSON.stringify(this.state.audioAnalysis) +
      JSON.stringify(this.state.cameraAnalysis);
    const needsSeatRebuild =
      seatsSig !== this.lastSeatsSignature ||
      equipSig !== this.lastEquipSignature ||
      selectionSig !== this.lastSelectionSignature ||
      analysisSig !== this.lastAnalysisSignature;

    if (needsSeatRebuild) {
      const showMicStatus = this.state.micAnalysis.enabled && this.state.micAnalysis.seatStatus;
      const showAudioStatus = this.state.audioAnalysis.enabled && this.state.audioAnalysis.seatStatus;
      const showCameraStatus = this.state.cameraAnalysis.enabled && this.state.cameraAnalysis.seatStatus;
      const showDisplayStatus =
        (this.state.displayAnalysis.enabled && this.state.displayAnalysis.seatStatus) ||
        this.state.highlightedSeatIds.length > 0;
      const showStatus = showMicStatus || showAudioStatus || showCameraStatus || showDisplayStatus;
      const obstacles = projectObstacles(this.state.room, this.state.tables);
      const statuses = showMicStatus
        ? computeSeatMicStatuses(this.state.seats, this.state.equipment, catalog)
        : showAudioStatus
          ? computeSeatAudioStatuses(this.state.seats, this.state.equipment, catalog)
          : showCameraStatus
            ? computeSeatCameraStatuses(this.state.seats, this.state.equipment, catalog, this.state.room, this.state.tables)
            : showStatus
              ? computeSeatStatuses(this.state.seats, this.activeDisplay(), obstacles)
              : new Map<string, CheckStatus>();
      const selectedIds = [
        ...(this.state.selection.kind === 'seat' && this.state.selection.id ? [this.state.selection.id] : []),
        ...this.state.highlightedSeatIds
      ];
      while (this.seatingGroup.children.length) this.seatingGroup.remove(this.seatingGroup.children[0]);
      this.seatingGroup.add(renderSeating(this.state.seats, this.state.tables, showStatus ? statuses : undefined, selectedIds));
    }

    if (equipSig !== this.lastEquipSignature || selectionSig !== this.lastSelectionSignature) {
      const selectedEquipId = this.state.selection.kind === 'equipment' ? this.state.selection.id : null;
      while (this.equipmentGroup.children.length) this.equipmentGroup.remove(this.equipmentGroup.children[0]);
      this.equipmentGroup.add(
        renderEquipment(
          this.state.equipment.filter((e) => !this.state.hiddenEquipmentIds.includes(e.instanceId)),
          catalog,
          selectedEquipId
        )
      );
      this.attachTransformToSelection();
    }

    if (racksSig !== this.lastRacksSignature || selectionSig !== this.lastSelectionSignature || equipSig !== this.lastEquipSignature) {
      const selectedRackId = this.state.selection.kind === 'rack' ? this.state.selection.id : null;
      const selectedEquipForRack = this.state.selection.kind === 'equipment' ? this.state.selection.id : null;
      while (this.rackGroup.children.length) this.rackGroup.remove(this.rackGroup.children[0]);
      this.rackGroup.add(renderRacks(this.state.racks, this.state.equipment, catalog, selectedRackId ?? selectedEquipForRack));
    }

    this.lastSeatsSignature = seatsSig;
    this.lastEquipSignature = equipSig;
    this.lastRacksSignature = racksSig;
    this.lastSelectionSignature = selectionSig;
    this.lastAnalysisSignature = analysisSig;

    if (this.state.transformMode !== this.lastTransformMode) {
      this.lastTransformMode = this.state.transformMode;
      this.transformControls.setMode(this.state.transformMode);
    }

    if (this.state.focusRequest !== this.lastFocusRequest) {
      this.lastFocusRequest = this.state.focusRequest;
      this.focusSelection();
    }
    if (this.state.cameraViewTick !== this.lastCameraViewTick) {
      this.lastCameraViewTick = this.state.cameraViewTick;
      const room = this.state.room;
      if (room) {
        this.cameraController.applyViewPreset(this.state.cameraView, room.width, room.depth, room.height);
      }
    }
    if (this.state.findingFocusRequest !== this.lastFindingFocus) {
      this.lastFindingFocus = this.state.findingFocusRequest;
      this.focusFinding();
    }

    this.syncViewerMode();
    this.updateTransformVisibility();
    const vizBuildSig =
      JSON.stringify(this.state.displayAnalysis) +
      JSON.stringify(this.state.micAnalysis) +
      JSON.stringify(this.state.audioAnalysis) +
      JSON.stringify(this.state.cameraAnalysis) +
      JSON.stringify(this.state.equipment) +
      JSON.stringify(this.state.highlightedSeatIds) +
      JSON.stringify(this.state.tables) +
      JSON.stringify(this.state.room) +
      JSON.stringify(this.state.seats);
    if (vizBuildSig !== this.lastVizBuildSignature) {
      this.lastVizBuildSignature = vizBuildSig;
      this.syncAnalysisViz();
    }
    const cableSig =
      JSON.stringify(this.state.connections) +
      this.state.selectedConnectionId +
      this.state.showCableRoutes +
      this.state.systemPhysicalView +
      JSON.stringify(this.state.highlightedConnectionIds) +
      this.state.selection.kind +
      this.state.selection.id +
      JSON.stringify(this.state.equipment) +
      JSON.stringify(this.state.tables) +
      JSON.stringify(this.state.racks) +
      JSON.stringify(this.state.room);
    if (cableSig !== this.lastCableSignature) {
      this.lastCableSignature = cableSig;
      this.syncCableViz();
    }
  }

  private clearAnalysisGroup(): void {
    while (this.analysisGroup.children.length) {
      const child = this.analysisGroup.children[0];
      this.analysisGroup.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) {
        const map = (mat as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        mat.dispose();
      }
    }
    this.heatmapMesh = null;
  }

  private syncAnalysisViz(): void {
    const viz = this.state.displayAnalysis;
    const micViz = this.state.micAnalysis;
    const audioViz = this.state.audioAnalysis;
    const cameraViz = this.state.cameraAnalysis;
    const display = this.activeDisplay();
    const room = this.state.room;
    const needDisplay = viz.enabled && !!display && !!room;
    const needMic = micViz.enabled && !!room;
    const needAudio = audioViz.enabled && !!room;
    const needCamera = cameraViz.enabled && !!room;
    if (!needDisplay && !needMic && !needAudio && !needCamera) {
      this.clearAnalysisGroup();
      return;
    }

    this.clearAnalysisGroup();
    const obstacles = projectObstacles(room!, this.state.tables, this.state.racks);

    const addFieldContours = (
      grid: { cols: number; rows: number; cells: Array<{ col: number; row: number; x: number; z: number; overall: import('../av/ViewingDistanceEngine').CheckStatus; score?: number; masked?: boolean }> },
      enabled: boolean
    ) => {
      if (!enabled || !room) return;
      const field = fieldFromCells(room, grid.cols, grid.rows, grid.cells, this.state.tables, this.state.racks);
      addContourOverlay(this.analysisGroup, contourPolylines(field, [0.5, 0.85]));
    };

    if (needCamera && cameraViz.heatmap && room) {
      const cameras = usableCameraPlacements(resolveProjectCameras(this.state.equipment, catalog));
      const { grid, image } = cachedCameraCoverage(room, cameras, obstacles, cameraViz.samplingQuality);
      this.heatmapMesh = addFloorHeatmap(this.analysisGroup, room, grid, image);
      addFieldContours(grid, cameraViz.contours);
    } else if (needAudio && audioViz.heatmap && room) {
      const speakers = usableSpeakerPlacements(resolveProjectSpeakers(this.state.equipment, catalog));
      const { grid, image } = cachedSpeakerCoverage(room, speakers, audioViz.samplingQuality);
      this.heatmapMesh = addFloorHeatmap(this.analysisGroup, room, grid, image);
      addFieldContours(grid, audioViz.contours);
    } else if (needMic && micViz.heatmap && room) {
      const mics = usableMicPlacements(resolveProjectMicrophones(this.state.equipment, catalog));
      const { grid, image } = cachedMicCoverage(room, mics, micViz.samplingQuality);
      this.heatmapMesh = addFloorHeatmap(this.analysisGroup, room, grid, image);
      addFieldContours(grid, micViz.contours);
    } else if (needDisplay && viz.heatmap && display && room) {
      const { grid, image } = cachedCoverage(
        room,
        display,
        obstacles,
        viz.samplingQuality,
        viz.heatmapMetric,
        this.state.tables,
        this.state.racks
      );
      this.heatmapMesh = addFloorHeatmap(this.analysisGroup, room, grid, image);
      addFieldContours(grid, viz.contours);
    }

    if (needCamera && cameraViz.fovRegions && room) {
      resolveProjectCameras(this.state.equipment, catalog).forEach((cam) => {
        if (!cam.coverageRegion) return;
        const selected = this.state.selection.kind === 'equipment' && this.state.selection.id === cam.instanceId;
        addPickupRegionOverlay(this.analysisGroup, cam.coverageRegion, selected, 0x6b5cff);
        if (!cam.incomplete) {
          addCameraFrustumOverlay(this.analysisGroup, cam, selected);
        }
      });
    }

    if (needCamera && cameraViz.blockedSightlines && room) {
      const summary = summarizeCameraCoverage(
        this.state.seats,
        this.state.equipment,
        catalog,
        room,
        this.state.tables
      );
      const highlight = this.state.highlightedSeatIds;
      summary.seatResults
        .filter((r) => r.inFov && !r.visible)
        .filter((r) => highlight.length === 0 || highlight.includes(r.seatId))
        .forEach((r) => {
          const camId = r.blockingCameraIds[0];
          const cam = this.state.equipment.find((e) => e.instanceId === camId);
          const seat = this.state.seats.find((s) => s.id === r.seatId);
          if (!cam || !seat) return;
          const eye = occupantEyeWorld(seat);
          const detailed = evaluateSightlineDetailed(
            { seatId: seat.id, x: cam.position.x, z: cam.position.z, eyeHeightM: cam.position.y },
            { x: seat.x, z: seat.z, y: eye.y },
            obstacles
          );
          addSightlineRay(
            this.analysisGroup,
            { x: eye.x, y: eye.y, z: eye.z },
            { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            'fail',
            detailed.hit
          );
        });
    }

    if (needAudio && audioViz.coverageRegions && room) {
      resolveProjectSpeakers(this.state.equipment, catalog).forEach((sp) => {
        if (sp.incomplete) return;
        const selected = this.state.selection.kind === 'equipment' && this.state.selection.id === sp.instanceId;
        if (sp.coverageRegion) addPickupRegionOverlay(this.analysisGroup, sp.coverageRegion, selected, 0xd68c32);
        addSpeakerCoverageVolume(this.analysisGroup, sp, selected);
      });
    }

    if (needMic && micViz.pickupRegions && room) {
      const resolved = resolveProjectMicrophones(this.state.equipment, catalog);
      resolved.forEach((mic) => {
        if (!mic.pickupRegion) return;
        const selected = this.state.selection.kind === 'equipment' && this.state.selection.id === mic.instanceId;
        addPickupRegionOverlay(this.analysisGroup, mic.pickupRegion, selected);
      });
    }

    if (needDisplay && display && (viz.sightlines !== 'off' || this.state.highlightedSeatIds.length)) {
      const highlight = this.state.highlightedSeatIds;
      const seats =
        highlight.length
          ? this.state.seats.filter((s) => highlight.includes(s.id))
          : viz.sightlines === 'selected' && this.state.selection.kind === 'seat' && this.state.selection.id
            ? this.state.seats.filter((s) => s.id === this.state.selection.id)
            : viz.sightlines === 'all'
              ? this.state.seats
              : [];
      const statuses = computeSeatStatuses(this.state.seats, display, obstacles);
      seats.forEach((seat) => {
        const eye = occupantEyeWorld(seat);
        const detailed = evaluateSightlineDetailed(
          { seatId: seat.id, x: seat.x, z: seat.z, eyeHeightM: eye.y },
          { x: display.position.x, z: display.position.z, y: display.position.y },
          obstacles
        );
        addSightlineRay(
          this.analysisGroup,
          eye,
          display.position,
          statuses.get(seat.id) ?? 'fail',
          detailed.hit
        );
      });
    }
  }

  private syncCableViz(): void {
    while (this.cableGroup.children.length) {
      const child = this.cableGroup.children[0];
      this.cableGroup.remove(child);
      const line = child as THREE.Line;
      if (line.geometry) line.geometry.dispose();
      const mat = line.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    }
    const show = shouldShowCableRoutes(this.state);
    if (!show || !this.state.connections.length) return;
    const ctx = cableRouteContext(this.state, catalog);
    const items = this.state.connections.filter((c) => shouldDrawConnection(this.state, c)).map((c) => ({
      route: cachedCableRoute(c, ctx),
      signalType: c.signalType,
      selected: isCableSelected(this.state, c)
    }));
    addCableRouteOverlays(this.cableGroup, items, this.state.showCableRoutes || this.state.systemPhysicalView);
  }

  private updateTransformVisibility(): void {
    const show =
      this.state.viewMode === '3d' &&
      !this.state.viewerMode.active &&
      this.state.selection.kind === 'equipment' &&
      !!this.selectedMesh;
    this.transformControls.visible = show;
    if (!show) {
      this.transformControls.detach();
    } else if (this.selectedMesh && this.transformControls.object !== this.selectedMesh) {
      this.transformControls.attach(this.selectedMesh);
    }
  }

  private attachTransformToSelection(): void {
    this.selectedMesh = null;
    if (this.state.selection.kind !== 'equipment' || !this.state.selection.id) {
      this.transformControls.detach();
      return;
    }
    const id = this.state.selection.id;
    this.equipmentGroup.traverse((obj) => {
      if (obj.userData?.instanceId === id && !this.selectedMesh) {
        this.selectedMesh = obj;
      }
    });
    if (this.selectedMesh) {
      this.transformControls.attach(this.selectedMesh);
      this.transformControls.setMode(this.state.transformMode);
    }
  }

  private onTransformChange(): void {
    if (!this.selectedMesh || this.state.selection.kind !== 'equipment' || !this.state.selection.id || !this.state.room) return;
    const id = this.state.selection.id;
    const inst = this.state.equipment.find((e) => e.instanceId === id);
    const product = inst ? catalog.get(inst.productId) : null;
    if (!inst || !product) return;

    if (this.dragging) {
      const position = {
        x: Number(this.selectedMesh.position.x.toFixed(3)),
        y: Number(this.selectedMesh.position.y.toFixed(3)),
        z: Number(this.selectedMesh.position.z.toFixed(3))
      };
      this.state.lastSnapNote = evaluatePlacement(this.state.room, this.state.tables, product, position).note;
      this.state.updateEquipment(
        id,
        {
          position,
          rotationY: this.selectedMesh.rotation.y,
          placementMode: 'manual'
        },
        { recordHistory: false }
      );
      return;
    }

    if (this.state.transformMode === 'rotate') {
      const rotY = this.selectedMesh.rotation.y;
      this.state.updateEquipment(
        id,
        {
          rotationY: rotY,
          placementMode: 'manual'
        },
        { recordHistory: false }
      );
      this.state.setSnapNote(`Rotated to ${((rotY * 180) / Math.PI).toFixed(1)}°`);
      this.state.finishGesture();
      return;
    }

    const snapped = snapEquipment(
      this.state.room,
      product,
      {
        x: this.selectedMesh.position.x,
        y: this.selectedMesh.position.y,
        z: this.selectedMesh.position.z
      },
      this.selectedMesh.rotation.y
    );

    this.selectedMesh.position.set(snapped.position.x, snapped.position.y, snapped.position.z);
    this.selectedMesh.rotation.y = snapped.rotationY;

    this.state.updateEquipment(
      id,
      {
        position: snapped.position,
        rotationY: snapped.rotationY,
        wall: snapped.wall,
        placementMode: 'manual'
      },
      { recordHistory: false }
    );
    this.state.setSnapNote(`${snapped.note} · ${evaluatePlacement(this.state.room, this.state.tables, product, snapped.position).note}`);
    this.state.finishGesture();
  }

  private focusSelection(): void {
    const room = this.state.room;
    if (!room) return;

    if (this.state.selection.kind === 'equipment' && this.state.selection.id) {
      const inst = this.state.equipment.find((e) => e.instanceId === this.state.selection.id);
      if (inst) {
        const pos = new THREE.Vector3(inst.position.x, inst.position.y, inst.position.z);
        this.cameraController.camera.position.set(pos.x + 2, pos.y + 1.5, pos.z + 2);
        this.cameraController.controls.target.copy(pos);
        this.cameraController.controls.update();
        return;
      }
    }

    if (this.state.selection.kind === 'rack' && this.state.selection.id) {
      const rack = this.state.racks.find((r) => r.id === this.state.selection.id);
      if (rack) {
        const pos = new THREE.Vector3(rack.x, rack.y, rack.z);
        this.cameraController.camera.position.set(pos.x + 2.2, pos.y + 1.4, pos.z + 2.2);
        this.cameraController.controls.target.copy(pos);
        this.cameraController.controls.update();
        return;
      }
    }

    if (this.state.selection.kind === 'seat' && this.state.selection.id) {
      const seat = this.state.seats.find((s) => s.id === this.state.selection.id);
      if (seat) {
        this.cameraController.camera.position.set(seat.x + 1.5, 2, seat.z + 1.5);
        this.cameraController.controls.target.set(seat.x, 1, seat.z);
        this.cameraController.controls.update();
        return;
      }
    }

    this.cameraController.frameRoom(room.width, room.depth, room.height);
  }

  private focusFinding(): void {
    const ids = this.state.highlightedSeatIds;
    const seats = this.state.seats.filter((s) => ids.includes(s.id));
    if (seats.length && this.state.room) {
      const x = seats.reduce((a, s) => a + s.x, 0) / seats.length;
      const z = seats.reduce((a, s) => a + s.z, 0) / seats.length;
      this.cameraController.camera.position.set(x + 2.2, 2.4, z + 2.2);
      this.cameraController.controls.target.set(x, 1.1, z);
      this.cameraController.controls.update();
      return;
    }
    const tables = this.state.tables.filter((t) => this.state.highlightedTableIds.includes(t.id));
    if (tables.length && this.state.room) {
      const x = tables.reduce((a, t) => a + t.centerX, 0) / tables.length;
      const z = tables.reduce((a, t) => a + t.centerZ, 0) / tables.length;
      this.cameraController.camera.position.set(x + 2.4, 2.6, z + 2.4);
      this.cameraController.controls.target.set(x, 0.8, z);
      this.cameraController.controls.update();
      return;
    }
    if (this.state.selection.kind === 'equipment' && this.state.selection.id) {
      this.focusSelection();
    }
  }

  private syncViewerMode(): void {
    const vm = this.state.viewerMode;
    const sig = JSON.stringify(vm);
    if (sig === this.lastViewerSignature) return;
    this.lastViewerSignature = sig;

    if (!vm.active || !vm.seatId) {
      this.cameraController.controls.enabled = true;
      if (this.state.room) this.cameraController.frameRoom(this.state.room.width, this.state.room.depth, this.state.room.height);
      return;
    }

    const seat = this.state.seats.find((s) => s.id === vm.seatId);
    if (!seat) return;
    const display = this.activeDisplay();
    const pose = computeViewerPose(seat, display, DEFAULT_EYE_HEIGHT_M);
    this.cameraController.goToViewerPosition(
      pose.position.x,
      pose.position.z,
      pose.position.y,
      new THREE.Vector3(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z)
    );
    this.cameraController.controls.enabled = false;
  }

  private onClick(e: MouseEvent): void {
    if (this.state.viewerMode.active || this.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.cameraController.camera);

    const seatHits = this.raycaster.intersectObjects(this.seatingGroup.children, true);
    for (const hit of seatHits) {
      const obj = hit.object as THREE.InstancedMesh;
      if (obj.userData?.pickable === 'seat' && hit.instanceId != null) {
        const seatId = obj.userData.seatIds?.[hit.instanceId];
        if (seatId) {
          this.state.select('seat', seatId);
          return;
        }
      }
    }

    const rackHits = this.raycaster.intersectObjects(this.rackGroup.children, true);
    for (const hit of rackHits) {
      const rackId = hit.object.userData?.rackId;
      if (rackId) {
        this.state.select('rack', rackId);
        return;
      }
    }

    const equipHits = this.raycaster.intersectObjects(this.equipmentGroup.children, true);
    for (const hit of equipHits) {
      const instanceId = hit.object.userData?.instanceId;
      if (instanceId) {
        this.state.select('equipment', instanceId, e.shiftKey);
        return;
      }
    }

    this.state.select('none', null);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.cameraController.update();
    this.renderer.render(this.scene, this.cameraController.camera);
  };
}
