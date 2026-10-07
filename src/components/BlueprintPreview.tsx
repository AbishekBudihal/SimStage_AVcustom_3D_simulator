import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  environmentGroup,
  disposeEnvironment,
  freezeEnvironment,
  type ImportedEnvironment,
} from "../workspace/EnvironmentImport";
export function BlueprintPreview({
  plan,
  selected,
  onSelect,
}: {
  plan: ImportedEnvironment;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    live = useRef<
      | {
          scene: T.Scene;
          camera: T.PerspectiveCamera;
          renderer: T.WebGLRenderer;
          controls: OrbitControls;
          group?: T.Group;
          render: () => void;
          sizeKey: string;
        }
      | undefined
    >(undefined),
    select = useRef(onSelect),
    [error, setError] = useState("");
  select.current = onSelect;
  useEffect(() => {
    if (!host.current) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch (e) {
      setError(String(e));
      return;
    }
    const scene = new T.Scene();
    scene.background = new T.Color(0x16202d);
    const camera = new T.PerspectiveCamera(45, 1, 0.01, 2000);
    camera.position.set(10, 10, 10);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const light = new T.DirectionalLight(0xfff6e5, 3);
    light.position.set(5, 12, 8);
    light.castShadow = true;
    scene.add(light, new T.HemisphereLight(0xe2efff, 0x5e5960, 2));
    let frame = 0,
      disposed = false;
    const render = () => {
      if (!disposed && !frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          renderer.render(scene, camera);
        });
    };
    controls.addEventListener("change", render);
    const resize = new ResizeObserver(() => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(host.current);
    let down = { x: 0, y: 0 };
    const start = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit =
        live.current?.group &&
        ray
          .intersectObjects(live.current.group.children)
          .find((h) => h.object.name !== "Calibrated plan underlay");
      if (hit) select.current(hit.object.name);
    };
    renderer.domElement.addEventListener("pointerdown", start);
    renderer.domElement.addEventListener("pointerup", pick);
    live.current = { scene, camera, renderer, controls, render, sizeKey: "" };
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      if (live.current?.group) disposeEnvironment(live.current.group);
      light.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      live.current = undefined;
    };
  }, []);
  useEffect(() => {
    const api = live.current;
    if (!api) return;
    try {
      const valid = freezeEnvironment(plan);
      if (api.group) disposeEnvironment(api.group);
      api.group = environmentGroup(valid, api.render);
      api.scene.add(api.group);
      const key = `${plan.width}:${plan.height}:${plan.metersPerUnit}`;
      if (api.sizeKey !== key) {
        api.sizeKey = key;
        const size = Math.max(plan.width, plan.height) * plan.metersPerUnit;
        api.camera.position.set(
          size * 0.9,
          Math.max(5, size * 0.8),
          size * 0.9,
        );
        api.controls.target.set(0, 1, 0);
        api.controls.update();
      }
      setError("");
      api.render();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [plan]);
  useEffect(() => {
    const api = live.current;
    if (!api?.group) return;
    api.group.traverse((o) => {
      if (
        o instanceof T.Mesh &&
        (o.material as T.MeshStandardMaterial).isMeshStandardMaterial
      )
        (o.material as T.MeshStandardMaterial).emissive.setHex(
          o.name === selected ? 0x17406b : 0,
        );
    });
    api.render();
  }, [plan, selected]);
  return (
    <div>
      <div
        ref={host}
        className="blueprint-3d"
        aria-label="Interactive blueprint 3D preview"
      />
      {error && <p role="alert">{error}</p>}
      <p>
        Drag to orbit · wheel to zoom · right-drag to pan · click a mesh to
        inspect.
      </p>
    </div>
  );
}
