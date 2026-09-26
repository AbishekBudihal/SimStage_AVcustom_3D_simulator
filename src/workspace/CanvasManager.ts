import type { AudioAnalysis } from "./AudioEngineering";
import { eyeHeight } from "./RoomLayout";
import type { OpticalResult } from "./OpticalEngineering";
import { SpatialOverlays, type WorkspaceMode } from "./SpatialOverlays";
import { ViewportNavigation, orthographicFit } from "./ViewportNavigation";
import * as THREE from "three";
import { SpatialAssets } from "./SpatialAssets";
import {
  visualRegionBoundary,
  type FieldPoint,
  type Audit,
} from "./Engineering";
import {
  snapToSurface,
  type PlacedDevice,
  type RoomSize,
  type DeviceState,
  type MountSurface,
  type XYZ,
  type EngineeringSettings,
} from "./DeviceStore";

export type WorkspaceView = "plan" | "isometric" | "seat" | "front";
export interface CanvasManagerOptions {
  readonly onSelect: (id: string | null) => void;
  readonly room?: RoomSize;
  readonly onCableSelect?: (id: string | null) => void;
}

/** Owns GPU resources and DOM listeners. No perpetual animation loop. */
export class CanvasManager {
  readonly scene = new THREE.Scene();
  private readonly overviewCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0.01,
    1000,
  );
  private readonly seatCamera = new THREE.PerspectiveCamera(65, 1, 0.01, 1000);
  private activeCamera: THREE.OrthographicCamera | THREE.PerspectiveCamera =
    this.overviewCamera;
  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    return this.activeCamera;
  }
  readonly renderer: THREE.WebGLRenderer;
  readonly pickTargets: THREE.Object3D[] = [];
  private currentRoom: RoomSize;
  get room(): RoomSize {
    return this.currentRoom;
  }
  private keyLight = new THREE.DirectionalLight(0xfff4e2, 3);
  private roomAssets = new SpatialAssets();
  private roomGroup: THREE.Group;
  private view: WorkspaceView = "isometric";
  private visualBoundary: THREE.LineSegments | undefined;
  private visualOverlay: THREE.InstancedMesh | undefined;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly assets = new SpatialAssets();
  private heatmap: THREE.InstancedMesh | undefined;
  private heatMode: "off" | "spl" | "intelligibility" | "coverage" = "off";
  private field: readonly FieldPoint[] = [];

  private grid: THREE.GridHelper;
  private readonly observer: ResizeObserver;
  private readonly records = new Map<string, PlacedDevice>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private selectedId: string | null = null;
  private frame = 0;
  private disposed = false;
  private readonly target = new THREE.Vector3();
  private distance: number;
  private navigation: ViewportNavigation | undefined;
  private fittedSpan = 1;
  private fitBounds: THREE.Box3 | undefined;
  private overlays: SpatialOverlays | undefined;
  private onWindowResize = () => this.resize();
  private doubleClick = () => this.focusSelected();

  constructor(
    readonly host: HTMLElement,
    private readonly options: CanvasManagerOptions,
  ) {
    const room = options.room ?? { width: 8, depth: 6, height: 3 };
    snapToSurface({ x: 0, y: 0, z: 0 }, "floor", room);
    this.currentRoom = room;
    this.distance = Math.max(room.width, room.depth, room.height) * 2;
    this.camera.far = Math.max(1000, this.distance * 10);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.scene.background = new THREE.Color("#202b35");
    this.renderer.setClearColor(0x202b35);
    this.renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none";
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xe3f1ff, 0x494136, 1.15));
    const light = this.keyLight;
    light.position.set(4, 10, 6);
    if (this.renderer.shadowMap) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
      far: 80,
    });
    light.shadow.normalBias = 0.012;
    light.shadow.bias = -0.0002;
    light.shadow.radius = 3;
    this.scene.add(light);
    // Even division count keeps the centre and every line on the 0.5 m lattice.
    const size = Math.ceil(Math.max(room.width, room.depth));
    this.grid = new THREE.GridHelper(size, size * 2, 0x526075, 0x29313e);
    this.grid.position.y = 0.033;
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.roomGroup = this.roomAssets.room(room);
    this.scene.add(this.roomGroup);
    this.fitLighting();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener("pointerdown", this.select);
    this.overlays = new SpatialOverlays(this.scene);
    this.navigation = new ViewportNavigation(
      this.renderer.domElement,
      () => this.camera,
      this.invalidate,
      (e) => !!this.pickDevice(e),
      () => Math.max(this.room.width, this.room.depth),
    );
    this.renderer.domElement.addEventListener("dblclick", this.doubleClick);
    window.addEventListener?.("resize", this.onWindowResize);
    this.setView("isometric", false);
    this.resize();
  }

  private fitLighting() {
    const { width, depth, height } = this.room,
      r = Math.max(width, depth, height);
    this.keyLight.position.set(
      width * 0.35,
      height + depth * 0.7,
      depth * 0.45,
    );
    Object.assign(this.keyLight.shadow.camera, {
      left: -r * 0.8,
      right: r * 0.8,
      top: r * 0.8,
      bottom: -r * 0.8,
      near: 0.1,
      far: r * 4,
    });
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }
  /** Rebuild only room resources; preserve renderer, cameras and device identities. */
  setRoom(room: RoomSize): void {
    if (this.disposed || this.currentRoom === room) return;
    snapToSurface({ x: 0, y: 0, z: 0 }, "floor", room);
    this.scene.remove(this.roomGroup, this.grid);
    this.roomAssets.dispose();
    this.grid.geometry.dispose();
    (Array.isArray(this.grid.material)
      ? this.grid.material
      : [this.grid.material]
    ).forEach((m) => m.dispose());
    this.currentRoom = room;
    this.roomAssets = new SpatialAssets();
    this.roomGroup = this.roomAssets.room(room);
    const size = Math.ceil(Math.max(room.width, room.depth));
    this.grid = new THREE.GridHelper(size, size * 2, 0x526075, 0x29313e);
    this.grid.position.y = 0.033;
    this.scene.add(this.roomGroup, this.grid);
    this.fitLighting();
    this.distance = Math.max(room.width, room.depth, room.height) * 2;
    this.setView(this.view, false);
    this.resize();
  }

  setVisualOverlay(visible: boolean, seats: Audit["visual"]): void {
    if (this.disposed) return;
    if (this.visualOverlay && this.visualOverlay.count !== seats.length) {
      this.scene.remove(this.visualOverlay);
      this.visualOverlay.geometry.dispose();
      (this.visualOverlay.material as THREE.Material).dispose();
      this.visualOverlay = undefined;
    }
    if (!visible) {
      if (this.visualOverlay) this.visualOverlay.visible = false;
      this.invalidate();
      return;
    }
    if (!this.visualOverlay) {
      this.visualOverlay = new THREE.InstancedMesh(
        new THREE.RingGeometry(0.29, 0.42, 32),
        new THREE.MeshBasicMaterial({
          side: THREE.DoubleSide,
          depthWrite: false,
          transparent: true,
          opacity: 0.95,
        }),
        seats.length,
      );
      this.visualOverlay.name = "Visual planning seat markers";
      this.scene.add(this.visualOverlay);
    }
    this.visualOverlay.visible = true;
    const object = new THREE.Object3D(),
      color = new THREE.Color();
    seats.forEach((seat, i) => {
      const status = seat.results.some((r) => r.status === "green")
        ? "green"
        : seat.results.some((r) => r.pass)
          ? "yellow"
          : seat.results.some((r) => r.status !== "unknown")
            ? "red"
            : "unknown";
      color.setHex(
        { green: 0x26d99a, yellow: 0xffc857, red: 0xf45363, unknown: 0x718096 }[
          status
        ],
      );
      object.position.set(seat.position.x, 0.06, seat.position.z);
      object.rotation.x = -Math.PI / 2;
      object.updateMatrix();
      this.visualOverlay!.setMatrixAt(i, object.matrix);
      this.visualOverlay!.setColorAt(i, color);
    });
    this.visualOverlay.instanceMatrix.needsUpdate = true;
    if (this.visualOverlay.instanceColor)
      this.visualOverlay.instanceColor.needsUpdate = true;
    this.visualOverlay.computeBoundingSphere();
    this.invalidate();
  }

  setVisualCones(
    visible: boolean,
    devices: DeviceState["devices"],
    settings: EngineeringSettings,
  ): void {
    if (this.disposed) return;
    if (!visible) {
      if (this.visualBoundary?.visible) {
        this.visualBoundary.visible = false;
        this.invalidate();
      }
      return;
    }
    const vertices = Object.values(devices)
      .filter((d): d is PlacedDevice => !!d && d.kind === "display")
      .flatMap((d) => visualRegionBoundary(d, settings, this.room));
    if (!this.visualBoundary) {
      this.visualBoundary = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: 0x42c6f5,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      );
      this.visualBoundary.name = "Calculated visual region boundaries";
      this.scene.add(this.visualBoundary);
    }
    const geometry = this.visualBoundary.geometry;
    const existing = geometry.getAttribute("position");
    if (existing?.count === vertices.length / 3) {
      (existing.array as Float32Array).set(vertices);
      existing.needsUpdate = true;
    } else {
      geometry.dispose();
      this.visualBoundary.geometry = new THREE.BufferGeometry();
      this.visualBoundary.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
    }
    this.visualBoundary.geometry.computeBoundingSphere();
    this.visualBoundary.visible = true;
    this.invalidate();
  }

  /** Updates only changed meshes; multiple changes share one scheduled GPU frame. */
  syncDevices(
    devices: readonly PlacedDevice[] | DeviceState["devices"],
    selectedId: string | null,
  ): void {
    if (this.disposed) return;
    const incoming = new Map<string, PlacedDevice>();
    for (const device of Object.values(devices)) {
      if (!device) continue;
      if (incoming.has(device.id))
        throw new Error(`Duplicate device ID: ${device.id}`);
      incoming.set(device.id, device);
    }
    for (const id of this.records.keys()) {
      if (!incoming.has(id)) {
        this.sync(id, undefined);
        this.records.delete(id);
      }
    }
    for (const [id, device] of incoming) {
      if (this.records.get(id) !== device) {
        this.sync(id, device);
        this.records.set(id, device);
      }
    }
    const nextSelected =
      selectedId !== null && incoming.has(selectedId) ? selectedId : null;
    const previousSelected = this.selectedId;
    this.selectedId = nextSelected;
    for (const id of [previousSelected, nextSelected]) {
      if (id === null) continue;
      const mesh = this.meshes.get(id);
      const device = this.records.get(id);
      if (mesh && device) {
        const material = this.material(device.kind, id === nextSelected);
        if (mesh.material !== material) {
          mesh.material = material;
          this.invalidate();
        }
      }
    }
  }

  private select = (event: PointerEvent): void => {
    if (this.disposed || !event.isPrimary || event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const deviceId = this.pickDevice(event);
    if (!deviceId && this.overlays?.cables.length) {
      this.raycaster.params.Line = { threshold: 0.13 };
      const hit = this.raycaster.intersectObjects(
        this.overlays.cables,
        false,
      )[0];
      this.options.onCableSelect?.(hit?.object.userData.cableId ?? null);
      if (hit) return;
    }
    this.options.onCableSelect?.(null);
    this.options.onSelect(deviceId);
  };
  private pickDevice(event: {
    clientX: number;
    clientY: number;
  }): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, true)[0];
    return hit?.object.userData.deviceId ?? null;
  }

  placementPoint(
    clientX: number,
    clientY: number,
    surface: MountSurface,
  ): XYZ | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height || this.disposed) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const anchor = snapToSurface({ x: 0, y: 0, z: 0 }, surface, this.room);
    const normal = new THREE.Vector3(
      surface === "east" || surface === "west" ? 1 : 0,
      ["floor", "ceiling", "table"].includes(surface) ? 1 : 0,
      surface === "north" || surface === "south" ? 1 : 0,
    );
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(anchor.x, anchor.y, anchor.z),
    );
    const hit = new THREE.Vector3();
    if (
      Math.abs(this.raycaster.ray.direction.dot(normal)) < 1e-5 ||
      !this.raycaster.ray.intersectPlane(plane, hit)
    )
      return null;
    return snapToSurface(hit, surface, this.room);
  }

  private material(_kind: PlacedDevice["kind"], selected: boolean) {
    return this.assets.material(0x263343, selected);
  }

  setHeatmap(
    mode: "off" | "spl" | "intelligibility" | "coverage",
    field: readonly FieldPoint[] = this.field,
  ): void {
    if (this.disposed) return;
    this.heatMode = mode;
    this.field = field;
    if (mode === "off") {
      if (this.heatmap?.visible) {
        this.heatmap.visible = false;
        this.invalidate();
      }
      return;
    }
    if (this.heatmap && this.heatmap.count !== field.length) {
      this.scene.remove(this.heatmap);
      this.heatmap.geometry.dispose();
      (this.heatmap.material as THREE.Material).dispose();
      this.heatmap = undefined;
    }
    if (!this.heatmap && field.length) {
      this.heatmap = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.48, 0.48),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        field.length,
      );
      this.heatmap.name = "Seat-plane acoustic field projected onto floor";
      this.scene.add(this.heatmap);
    }
    if (this.heatmap) {
      this.heatmap.visible = true;
      const object = new THREE.Object3D(),
        color = new THREE.Color();
      field.forEach((point, index) => {
        const value =
          mode === "intelligibility" ? point.intelligibility : point.spl;
        object.position.set(point.x, 0.045, point.z);
        object.rotation.x = -Math.PI / 2;
        object.updateMatrix();
        this.heatmap!.setMatrixAt(index, object.matrix);
        if (value === null) color.setHex(0x526172);
        else if (mode === "coverage")
          color.setHex(
            value === 1 ? 0x26d99a : value === 0.5 ? 0xffc857 : 0xf45363,
          );
        else
          color.setHSL(
            (1 -
              Math.max(
                0,
                Math.min(1, mode === "spl" ? (value - 40) / 50 : value),
              )) *
              0.65,
            0.8,
            0.5,
          );
        this.heatmap!.setColorAt(index, color);
      });
      this.heatmap.computeBoundingSphere();
      this.heatmap.instanceMatrix.needsUpdate = true;
      if (this.heatmap.instanceColor)
        this.heatmap.instanceColor.needsUpdate = true;
    }
    this.invalidate();
  }
  setWorkspaceMode(
    mode: WorkspaceMode,
    state: DeviceState,
    filter = "All",
    selectedCable: string | null = null,
    optical?: OpticalResult,
    selectedSeat?: string | null,
    audio?: AudioAnalysis,
  ): void {
    if (this.disposed) return;
    this.overlays?.update(
      mode,
      state,
      filter,
      selectedCable,
      optical,
      selectedSeat,
      audio,
    );
    this.invalidate();
  }
  setView(view: WorkspaceView, _animate = true): void {
    if (this.disposed) return;
    this.navigation?.stop();
    this.view = view;
    this.grid.visible = view === "plan";
    const centre = new THREE.Vector3(0, this.room.height / 2, 0);
    if (view === "seat") {
      this.activeCamera = this.seatCamera;
      const eye = eyeHeight(this.room);
      this.camera.position.set(0, eye, this.room.depth * 0.3);
      this.target.set(0, eye, -this.room.depth / 2);
    } else {
      this.activeCamera = this.overviewCamera;
      this.overviewCamera.zoom = 1;
      this.target.copy(centre);
      const direction =
        view === "plan"
          ? new THREE.Vector3(0, 1, 0.00001)
          : view === "front"
            ? new THREE.Vector3(0, 0, 1)
            : new THREE.Vector3(1, 1, 1).normalize();
      this.camera.position
        .copy(centre)
        .addScaledVector(direction, this.distance);
    }
    this.camera.lookAt(this.target);
    this.navigation?.target.copy(this.target);
    this.fitProjection();
    this.resize();
  }
  private roomBounds() {
    return new THREE.Box3(
      new THREE.Vector3(-this.room.width / 2, 0, -this.room.depth / 2),
      new THREE.Vector3(
        this.room.width / 2,
        this.room.height,
        this.room.depth / 2,
      ),
    );
  }
  private fitProjection(bounds = this.roomBounds()) {
    this.fitBounds = bounds;
    const rect = this.host.getBoundingClientRect();
    this.fittedSpan = orthographicFit(
      this.overviewCamera,
      bounds,
      rect.width / Math.max(1, rect.height),
    );
  }
  fitRoom(): void {
    this.setView(this.view === "seat" ? "isometric" : this.view, false);
  }
  focusSelected(): void {
    const mesh = this.selectedId ? this.meshes.get(this.selectedId) : undefined;
    if (!mesh || this.disposed) return;
    this.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh),
      centre = bounds.getCenter(new THREE.Vector3());
    const oldTarget = this.navigation?.target ?? this.target;
    const direction = this.camera.position.clone().sub(oldTarget).normalize();
    this.navigation?.stop();
    this.target.copy(centre);
    this.navigation?.target.copy(centre);
    this.camera.position
      .copy(centre)
      .addScaledVector(
        direction,
        Math.max(bounds.getSize(new THREE.Vector3()).length() * 2, 0.8),
      );
    this.camera.lookAt(centre);
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.zoom = 1;
      this.fitBounds = bounds;
      this.fittedSpan = Math.max(
        0.35,
        orthographicFit(
          this.camera,
          bounds,
          this.host.getBoundingClientRect().width /
            Math.max(1, this.host.getBoundingClientRect().height),
        ),
      );
    }
    this.resize();
  }

  invalidate = (): void => {
    if (!this.disposed && !this.frame)
      this.frame = requestAnimationFrame(this.render);
  };

  private render = (): void => {
    this.frame = 0;
    if (this.disposed) return;
    if (this.navigation?.update()) this.invalidate();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    if (this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    if (this.fitBounds)
      this.fittedSpan = Math.max(
        0.35,
        orthographicFit(this.overviewCamera, this.fitBounds, aspect),
      );
    const span = this.fittedSpan;
    this.overviewCamera.left = -span * aspect;
    this.overviewCamera.right = span * aspect;
    this.overviewCamera.top = span;
    this.overviewCamera.bottom = -span;
    this.overviewCamera.updateProjectionMatrix();
    this.seatCamera.aspect = aspect;
    this.seatCamera.updateProjectionMatrix();
    this.invalidate();
  }

  private sync(id: string, device: PlacedDevice | undefined): void {
    let mesh = this.meshes.get(id);
    if (
      mesh &&
      device &&
      mesh.userData.shapeKey !==
        `${device.kind}:${device.surface}:${device.catalogId}`
    ) {
      this.scene.remove(mesh);
      this.pickTargets.splice(this.pickTargets.indexOf(mesh), 1);
      this.meshes.delete(id);
      mesh = undefined;
    }
    if (!device) {
      if (mesh) {
        this.scene.remove(mesh);
        this.pickTargets.splice(this.pickTargets.indexOf(mesh), 1);
        this.meshes.delete(id);
      }
    } else {
      if (!mesh) {
        const key = `${device.kind}:${device.surface}:${device.catalogId}`;
        mesh = this.assets.device(device);
        mesh.material = this.material(device.kind, id === this.selectedId);
        mesh.userData.deviceId = id;
        mesh.userData.shapeKey = key;
        this.meshes.set(id, mesh);
        this.pickTargets.push(mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(
        device.position.x,
        device.position.y,
        device.position.z,
      );
      mesh.rotation.set(
        device.rotation.x,
        device.rotation.y,
        device.rotation.z,
        "XYZ",
      );
      const size =
        device.kind === "display" && !device.dimensions
          ? (device.metadata.imageHeightM ?? 0.8) / 0.8
          : 1;
      mesh.scale.setScalar(size);
    }
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renderer.domElement.removeEventListener("pointerdown", this.select);
    this.observer.disconnect();
    this.navigation?.dispose();
    this.overlays?.dispose();
    this.renderer.domElement.removeEventListener("dblclick", this.doubleClick);
    window.removeEventListener?.("resize", this.onWindowResize);
    this.keyLight.shadow.dispose();
    this.assets.dispose();
    this.roomAssets.dispose();
    if (this.visualBoundary) {
      this.visualBoundary.geometry.dispose();
      (this.visualBoundary.material as THREE.Material).dispose();
    }
    if (this.visualOverlay) {
      this.visualOverlay.geometry.dispose();
      (this.visualOverlay.material as THREE.Material).dispose();
    }
    if (this.heatmap) {
      this.heatmap.geometry.dispose();
      (this.heatmap.material as THREE.Material).dispose();
      this.heatmap = undefined;
    }
    this.records.clear();
    this.grid.geometry.dispose();
    const materials = Array.isArray(this.grid.material)
      ? this.grid.material
      : [this.grid.material];
    materials.forEach((material) => material.dispose());
    this.scene.clear();
    this.meshes.clear();
    this.pickTargets.length = 0;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
