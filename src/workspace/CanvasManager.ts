import * as THREE from 'three';
import { snapToSurface, type PlacedDevice, type RoomSize, type DeviceState } from './DeviceStore';

export type WorkspaceView = 'plan' | 'isometric' | 'seat';
export interface CanvasManagerOptions {
  readonly onSelect: (id: string | null) => void;
  readonly room?: RoomSize;
}

/** Owns GPU resources and DOM listeners. No perpetual animation loop. */
export class CanvasManager {
  readonly scene = new THREE.Scene();
  private readonly overviewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  private readonly seatCamera = new THREE.PerspectiveCamera(65, 1, 0.01, 1000);
  private activeCamera: THREE.OrthographicCamera | THREE.PerspectiveCamera = this.overviewCamera;
  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera { return this.activeCamera; }
  readonly renderer: THREE.WebGLRenderer;
  readonly pickTargets: THREE.Object3D[] = [];
  readonly room: RoomSize;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly geometries = new Map<string, THREE.BoxGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly grid: THREE.GridHelper;
  private readonly observer: ResizeObserver;
  private readonly records = new Map<string, PlacedDevice>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private selectedId: string | null = null;
  private frame = 0;
  private disposed = false;
  private transition: { start: number; from: THREE.Vector3; to: THREE.Vector3 } | undefined;
  private readonly target = new THREE.Vector3();
  private readonly distance: number;

  constructor(readonly host: HTMLElement, private readonly options: CanvasManagerOptions) {
    const room = options.room ?? { width: 8, depth: 6, height: 3 };
    snapToSurface({ x: 0, y: 0, z: 0 }, 'floor', room);
    this.room = Object.freeze({ ...room });
    this.distance = Math.max(room.width, room.depth, room.height) * 2;
    this.camera.far = Math.max(1000, this.distance * 10);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.scene.background = new THREE.Color('#0f1115');
    this.renderer.setClearColor(0x0f1115);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(4, 10, 6);
    this.scene.add(light);
    // Even division count keeps the centre and every line on the 0.5 m lattice.
    const size = Math.ceil(Math.max(room.width, room.depth));
    this.grid = new THREE.GridHelper(size, size * 2, 0x526075, 0x29313e);
    this.scene.add(this.grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.select);
    this.setView('isometric', false);
    this.resize();
  }

  /** Updates only changed meshes; multiple changes share one scheduled GPU frame. */
  syncDevices(devices: readonly PlacedDevice[] | DeviceState['devices'], selectedId: string | null): void {
    if (this.disposed) return;
    const incoming = new Map<string, PlacedDevice>();
    for (const device of Object.values(devices)) {
      if (!device) continue;
      if (incoming.has(device.id)) throw new Error(`Duplicate device ID: ${device.id}`);
      incoming.set(device.id, device);
    }
    for (const id of this.records.keys()) {
      if (!incoming.has(id)) { this.sync(id, undefined); this.records.delete(id); }
    }
    for (const [id, device] of incoming) {
      if (this.records.get(id) !== device) {
        this.sync(id, device);
        this.records.set(id, device);
      }
    }
    const nextSelected = selectedId !== null && incoming.has(selectedId) ? selectedId : null;
    const previousSelected = this.selectedId;
    this.selectedId = nextSelected;
    for (const id of [previousSelected, nextSelected]) {
      if (id === null) continue;
      const mesh = this.meshes.get(id);
      const device = this.records.get(id);
      if (mesh && device) {
        const material = this.material(device.kind, id === nextSelected);
        if (mesh.material !== material) { mesh.material = material; this.invalidate(); }
      }
    }
  }

  private select = (event: PointerEvent): void => {
    if (this.disposed || !event.isPrimary || event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    this.options.onSelect(hit ? hit.object.userData.deviceId as string : null);
  };

  private material(kind: PlacedDevice['kind'], selected: boolean): THREE.MeshStandardMaterial {
    const key = `${kind}:${selected}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: selected ? 0x60a5fa : kind === 'display' ? 0x38516e : 0x8295ab,
        emissive: selected ? 0x123864 : 0x000000, roughness: 0.75,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  setView(view: WorkspaceView, animate = true): void {
    if (this.disposed) return;
    this.transition = undefined;
    if (view === 'seat') {
      this.activeCamera = this.seatCamera;
      const eyeHeight = Math.min(1.2, this.room.height * 0.8);
      this.camera.position.set(0, eyeHeight, this.room.depth * 0.3);
      this.camera.lookAt(0, eyeHeight, -this.room.depth / 2);
      this.resize();
      return;
    }
    this.activeCamera = this.overviewCamera;
    const to = view === 'plan'
      ? new THREE.Vector3(0, this.distance, 0.0001)
      : new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(this.distance);
    this.transition = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? { start: performance.now(), from: this.camera.position.clone(), to } : undefined;
    if (!this.transition) { this.camera.position.copy(to); this.camera.lookAt(this.target); }
    this.invalidate();
  }

  invalidate = (): void => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.render);
  };

  private render = (now: number): void => {
    this.frame = 0;
    if (this.disposed) return;
    if (this.transition) {
      const t = Math.min(1, (now - this.transition.start) / 180);
      this.camera.position.lerpVectors(this.transition.from, this.transition.to, t * t * (3 - 2 * t));
      this.camera.lookAt(this.target);
      if (t === 1) this.transition = undefined;
      else this.invalidate();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    if (this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max(this.room.width, this.room.depth, this.room.height) * 0.95;
    this.overviewCamera.left = -span * Math.max(1, aspect);
    this.overviewCamera.right = -this.overviewCamera.left;
    this.overviewCamera.top = span * Math.max(1, 1 / aspect);
    this.overviewCamera.bottom = -this.overviewCamera.top;
    this.overviewCamera.updateProjectionMatrix();
    this.seatCamera.aspect = aspect;
    this.seatCamera.updateProjectionMatrix();
    this.invalidate();
  }

  private sync(id: string, device: PlacedDevice | undefined): void {
    let mesh = this.meshes.get(id);
    if (mesh && device && mesh.userData.shapeKey !== `${device.kind}:${device.surface}`) {
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
        const key = `${device.kind}:${device.surface}`;
        let geometry = this.geometries.get(key);
        if (!geometry) {
          const dimensions: Record<PlacedDevice['kind'], [number, number, number]> = {
            display: [1.4, 0.8, 0.08], 'ptz_camera': [0.22, 0.25, 0.22],
            'ceiling_mic': [0.35, 0.06, 0.35], speaker: [0.25, 0.4, 0.25], rack: [0.6, 1.8, 0.8],
          };
          const [w, h, d] = dimensions[device.kind];
          geometry = new THREE.BoxGeometry(w, h, d);
          if (device.surface === 'floor') geometry.translate(0, h / 2, 0);
          else if (device.surface === 'ceiling') geometry.translate(0, -h / 2, 0);
          else {
            geometry.translate(0, 0, d / 2);
            geometry.rotateY(({ north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 })[device.surface]);
          }
          this.geometries.set(key, geometry);
        }
        const material = this.material(device.kind, id === this.selectedId);
        mesh = new THREE.Mesh(geometry, material);
        mesh.userData.deviceId = id;
        mesh.userData.shapeKey = key;
        this.meshes.set(id, mesh);
        this.pickTargets.push(mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(device.position.x, device.position.y, device.position.z);
      mesh.rotation.set(device.rotation.x, device.rotation.y, device.rotation.z, 'XYZ');
    }
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.transition = undefined;
    this.renderer.domElement.removeEventListener('pointerdown', this.select);
    this.observer.disconnect();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.records.clear();
    this.grid.geometry.dispose();
    const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    materials.forEach(material => material.dispose());
    this.scene.clear();
    this.meshes.clear();
    this.pickTargets.length = 0;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

