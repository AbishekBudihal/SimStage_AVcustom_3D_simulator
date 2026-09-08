import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraViewPreset } from '../app/AppState';

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(6, 5, 8);
    this.controls = new OrbitControls(this.camera, container);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1, 0);
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  applyViewPreset(view: CameraViewPreset, width: number, depth: number, height: number): void {
    const diag = Math.hypot(width, depth);
    this.controls.maxPolarAngle = view === 'top' ? Math.PI : Math.PI * 0.49;
    this.controls.target.set(0, height * 0.35, 0);
    if (view === 'top') {
      this.camera.position.set(0, Math.max(diag * 1.15, height * 2.2), 0.01);
    } else if (view === 'front') {
      this.camera.position.set(0, height * 0.9, Math.max(depth * 1.4, 6));
    } else if (view === 'left') {
      this.camera.position.set(-Math.max(width * 1.4, 6), height * 0.9, 0);
    } else if (view === 'right') {
      this.camera.position.set(Math.max(width * 1.4, 6), height * 0.9, 0);
    } else {
      this.camera.position.set(diag * 0.55, Math.max(height * 1.6, 3), diag * 0.55);
    }
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  frameRoom(width: number, depth: number, height: number): void {
    const diag = Math.hypot(width, depth);
    this.camera.position.set(diag * 0.55, Math.max(height * 1.6, 3), diag * 0.55);
    this.controls.target.set(0, height * 0.35, 0);
    this.controls.update();
  }

  /** Moves the camera to a specific seat's eye point, looking at a target — used by Viewer Mode (§13). */
  goToViewerPosition(seatX: number, seatZ: number, eyeHeight: number, lookAt: THREE.Vector3): void {
    this.camera.position.set(seatX, eyeHeight, seatZ);
    this.controls.target.copy(lookAt);
    this.controls.update();
  }

  private animationId: number | null = null;

  /** Smoothly interpolates camera position and controls target to desired vectors. */
  animateTo(targetPos: THREE.Vector3, targetLookAt: THREE.Vector3, durationMs = 800): Promise<void> {
    return new Promise((resolve) => {
      this.cancelAnimation();
      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();
      const startTime = performance.now();

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        // Smooth cubic ease in-out
        const ease = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        this.camera.position.lerpVectors(startPos, targetPos, ease);
        this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
        this.controls.update();

        if (progress < 1) {
          this.animationId = requestAnimationFrame(step);
        } else {
          this.animationId = null;
          resolve();
        }
      };

      this.animationId = requestAnimationFrame(step);
    });
  }

  cancelAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  update(): void {
    this.controls.update();
  }
}
