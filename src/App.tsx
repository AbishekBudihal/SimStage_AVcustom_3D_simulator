import { EnvironmentImporter } from "./components/EnvironmentImporter";
import { PressureMapPanel } from "./components/PressureMapPanel";
import type { PressureResult } from "./workspace/PressureModel";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { viewingField } from "./workspace/ViewingField";
import { FurnitureInspector } from "./components/FurnitureInspector";
import { useFurnitureDrag } from "./workspace/useFurnitureDrag";
import { AudioAnalysisPanel } from "./components/AudioAnalysisPanel";
import { analyzeAudio } from "./workspace/AudioEngineering";
import { OpticalAnalysisPanel } from "./components/OpticalAnalysisPanel";
import { cameraCoverage, displayViewing } from "./workspace/OpticalEngineering";
import { cableRoutes, type WorkspaceMode } from "./workspace/SpatialOverlays";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { CanvasManager, type WorkspaceView } from "./workspace/CanvasManager";
import { useDeviceDrag } from "./workspace/useDeviceDrag";
import { deviceFromProfile } from "./workspace/catalog";
import { CatalogLibrary } from "./components/CatalogLibrary";
import { RoomController } from "./components/RoomController";

import { createWorkspace } from "./workspace/createWorkspace";
import { engineeringAudit } from "./workspace/Engineering";
import type { XYZ } from "./workspace/DeviceStore";
import { PropertyInspector } from "./components/PropertyInspector";
import { ViewportHUD } from "./components/ViewportHUD";
import { BOMDrawer } from "./components/BOMDrawer";
import { SchematicCanvas } from "./components/SchematicCanvas";
import { EngineeringPanel } from "./components/EngineeringPanel";
import "./workspace.css";
export default function App() {
  const [store] = useState(createWorkspace);
  const [floorLayer, setFloorLayer] = useState<
    "auto" | "off" | "spl" | "viewing" | "microphone" | "pressure"
  >("auto");
  const [cameraLayer, setCameraLayer] = useState(false);
  const [furnitureEditing, setFurnitureEditing] = useState(false);
  const [selectedFurniture, setSelectedFurniture] = useState<string | null>(
    null,
  );
  const environment = useStore(store.api, (s) => s.environment);
  const selectedId = useStore(store.api, (s) => s.selectedId);
  const devices = useStore(store.api, (s) => s.devices),
    connections = useStore(store.api, (s) => s.connections),
    settings = useStore(store.api, (s) => s.engineering),
    room = useStore(store.api, (s) => s.room);
  const audit = useMemo(
    () => engineeringAudit(store.api.getState(), room),
    [devices, connections, settings, store, room, environment],
  );
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<CanvasManager | null>(null);
  const [view, setView] = useState<WorkspaceView>("isometric"),
    [tab, setTab] = useState<"spatial" | "schematic">("spatial");
  const [mode, setMode] = useState<WorkspaceMode>("overview"),
    [cableFilter, setCableFilter] = useState("All"),
    [selectedCable, setSelectedCable] = useState<string | null>(null);
  const [analysisIds, setAnalysisIds] = useState<{
    camera?: string;
    display?: string;
    microphone?: string;
    speaker?: string;
  }>({});
  useEffect(() => {
    const d = selectedId ? devices[selectedId] : undefined;
    const kind =
      d?.kind === "ptz_camera"
        ? "camera"
        : d?.kind === "display"
          ? "display"
          : d?.kind === "ceiling_mic"
            ? "microphone"
            : d?.kind === "speaker"
              ? "speaker"
              : null;
    if (kind && d)
      setAnalysisIds((ids) =>
        ids[kind] === d.id ? ids : { ...ids, [kind]: d.id },
      );
  }, [selectedId, devices]);
  const pressureSettings = useStore(store.api, (s) => s.pressure);
  const [pressureData, setPressureData] = useState<{
    result: PressureResult;
    devices: typeof devices;
    room: typeof room;
    settings: typeof pressureSettings;
    environment: typeof environment;
  } | null>(null);
  const [pressureError, setPressureError] = useState("");
  const pressureResult =
    pressureData?.devices === devices &&
    pressureData.room === room &&
    pressureData.settings === pressureSettings &&
    pressureData.environment === environment
      ? pressureData.result
      : null;
  useEffect(() => {
    setPressureError("");
    if (floorLayer !== "pressure") return;
    let worker: Worker | undefined,
      cancelled = false;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./workspace/pressure.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (
          e: MessageEvent<{ result?: PressureResult; error?: string }>,
        ) => {
          if (cancelled) return;
          if (e.data.result)
            setPressureData({
              result: e.data.result,
              environment,
              devices,
              room,
              settings: pressureSettings,
            });
          setPressureError(e.data.error ?? "");
          worker?.terminate();
        };
        worker.onerror = () => {
          if (!cancelled)
            setPressureError(
              "Pressure calculation failed; adjust inputs to retry.",
            );
          worker?.terminate();
        };
        worker.postMessage({
          state: {
            devices,
            room,
            environment: environment
              ? { ...environment, image: undefined }
              : null,
          },
          settings: pressureSettings,
        });
      } catch (e) {
        setPressureError(e instanceof Error ? e.message : String(e));
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [floorLayer, devices, room, pressureSettings, environment]);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const optical = useMemo(() => {
    if (mode !== "camera" && mode !== "display") return undefined;
    const candidates = Object.values(devices).filter(
      (d) => d?.kind === (mode === "camera" ? "ptz_camera" : "display"),
    );
    const device =
      candidates.find((d) => d?.id === selectedId) ??
      candidates.find((d) => d?.id === analysisIds[mode]) ??
      candidates[0];
    return device
      ? mode === "camera"
        ? cameraCoverage(device, room, environment)
        : displayViewing(device, store.api.getState())
      : undefined;
  }, [mode, devices, selectedId, analysisIds, room, settings, store, environment]);
  const [audioScope, setAudioScope] = useState<"room" | "device">("room");
  const [audioLayer, setAudioLayer] = useState<"coverage" | "spl">("coverage");
  const roomMic = useMemo(
    () => analyzeAudio(store.api.getState(), "microphone"),
    [devices, room, store, environment],
  );
  const roomSpeaker = useMemo(
    () => analyzeAudio(store.api.getState(), "speaker"),
    [devices, room, store, environment],
  );
  const audio = useMemo(() => {
    if (mode !== "microphone" && mode !== "speaker") return undefined;
    const all = mode === "microphone" ? roomMic : roomSpeaker;
    if (audioScope === "room") return all;
    const id =
      all.devices.find((d) => d.deviceId === selectedId)?.deviceId ??
      all.devices.find((d) => d.deviceId === analysisIds[mode])?.deviceId ??
      all.devices[0]?.deviceId;
    return id ? analyzeAudio(store.api.getState(), mode, id) : all;
  }, [mode, roomMic, roomSpeaker, audioScope, selectedId, analysisIds, store, environment]);
  const routes = useMemo(
    () => cableRoutes(store.api.getState()),
    [devices, connections, room, store],
  );
  useEffect(() => {
    if (
      cableFilter !== "All" &&
      !routes.some((route) => route.category === cableFilter)
    )
      setCableFilter("All");
  }, [routes, cableFilter]);
  const cable = routes.find((c) => c.id === selectedCable);
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    canvas.current?.setFurnitureEditing(furnitureEditing);
  }, [furnitureEditing, ready]);
  useEffect(() => {
    if (!host.current) return;
    let manager: CanvasManager;
    try {
      manager = new CanvasManager(host.current, {
        room: store.api.getState().room,
        onCableSelect: setSelectedCable,
        onFurnitureSelect: setSelectedFurniture,
        onSelect: (id) => store.api.getState().selectDevice(id),
      });
    } catch (cause) {
      setError(String(cause));
      return;
    }
    canvas.current = manager;
    const sync = () => {
      const state = store.api.getState();
      manager.setRoom(state.room);
      manager.setEnvironment(state.environment);
      manager.syncDevices(state.devices, state.selectedId);
    };
    const unsubscribe = store.api.subscribe(sync),
      disposeDrag = useDeviceDrag(manager, store),
      disposeFurnitureDrag = useFurnitureDrag(manager, store);
    sync();
    setReady(true);
    return () => {
      disposeFurnitureDrag();
      disposeDrag();
      unsubscribe();
      manager.dispose();
      canvas.current = null;
    };
  }, [store]);
  useEffect(() => {
    const manager = canvas.current;
    if (floorLayer === "viewing")
      manager?.setHeatmap("coverage", viewingField(store.api.getState()));
    else if (floorLayer === "spl" || floorLayer === "microphone") {
      const field = floorLayer === "spl" ? roomSpeaker.field : roomMic.field;
      manager?.setHeatmap(
        floorLayer === "spl" ? "spl" : "coverage",
        field.map((p) => ({
          x: p.x,
          z: p.z,
          spl:
            floorLayer === "spl"
              ? p.spl
              : p.status === "unknown"
                ? null
                : p.status === "covered"
                  ? 1
                  : p.status === "edge"
                    ? 0.5
                    : 0,
          intelligibility: null,
        })),
      );
    } else if (floorLayer === "auto" && audio)
      manager?.setHeatmap(
        mode === "speaker" && audioLayer === "spl" ? "spl" : "coverage",
        audio.field.map((p) => ({
          x: p.x,
          z: p.z,
          spl:
            mode === "speaker" && audioLayer === "spl"
              ? p.spl
              : p.status === "unknown"
                ? null
                : p.status === "covered"
                  ? 1
                  : p.status === "edge"
                    ? 0.5
                    : 0,
          intelligibility: null,
        })),
      );
    else manager?.setHeatmap("off");
    manager?.setPressureMap(
      floorLayer === "pressure" ? pressureResult : null,
      pressureSettings,
    );
    manager?.setCameraLayers(cameraLayer, store.api.getState());
    manager?.setVisualOverlay(floorLayer === "viewing", audit.visual);
    manager?.setVisualCones(false, devices, settings);
    manager?.setWorkspaceMode(
      mode,
      store.api.getState(),
      cableFilter,
      selectedCable,
      optical,
      selectedSeat,
      audio,
    );
  }, [
    environment,
    pressureResult,
    pressureSettings,
    floorLayer,
    cameraLayer,
    roomMic,
    roomSpeaker,
    audio,
    audioLayer,
    optical,
    selectedSeat,
    audit,
    mode,
    ready,
    devices,
    settings,
    connections,
    room,
    cableFilter,
    selectedCable,
    store,
  ]);
  function spawn(profileId: string, point?: XYZ) {
    const count = store
      .snapshot()
      .filter((d) => d.catalogId === profileId).length;
    const profile = store.api
      .getState()
      .catalog.find((p) => p.id === profileId);
    if (!profile) return;
    const id = store.add(deviceFromProfile(profile, count, room, point));
    store.api.getState().selectDevice(id);
  }
  return (
    <div className="workspace-app">
      <header className="app-header">
        <div className="brand-mark">S</div>
        <div>
          <strong>
            SimStage <span>AV</span>
          </strong>
          <small>ONLINE INSTRUMENTS</small>
        </div>
        <div className="project-heading">
          Parametric room
          <span>Spatial design + signal flow</span>
        </div>
        <span className="session-badge">
          Planning estimates · local session
        </span>
      </header>
      <main className="workspace-layout">
        <aside className="panel inventory-panel" aria-label="Quick inventory">
          <p className="eyebrow">SYSTEM BUILDER</p>
          <RoomController store={store} />
          <EnvironmentImporter store={store} />
          <p className="muted">
            {audit.seats} seats · {(room.width * room.depth).toFixed(1)} m²
          </p>
          <CatalogLibrary store={store} ready={ready && !error} spawn={spawn} />
        </aside>
        <section className="canvas-panel" aria-label="Design workspace">
          <div className="design-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "spatial"}
              onClick={() => setTab("spatial")}
            >
              Spatial workspace
            </button>
            <button
              role="tab"
              aria-selected={tab === "schematic"}
              onClick={() => setTab("schematic")}
            >
              Signal schematic <span>{connections.length}</span>
            </button>
          </div>
          <div
            className="spatial-pane"
            style={{ display: tab === "spatial" ? "flex" : "none" }}
          >
            <div className="canvas-toolbar">
              <div>
                <strong>Parametric room / {audit.seats} seats</strong>
                <span>
                  Cutaway view · {(room.width * room.depth).toFixed(1)} m²
                </span>
              </div>
              <ViewportHUD
                view={view}
                onChange={(next) => {
                  canvas.current?.setView(next, false);
                  setView(next);
                }}
                disabled={!ready || !!error}
              />
            </div>
            <div className="analysis-toolbar">
              <label>
                Floor analysis{" "}
                <select
                  aria-label="Floor analysis layer"
                  value={floorLayer}
                  onChange={(e) =>
                    setFloorLayer(e.target.value as typeof floorLayer)
                  }
                >
                  <option value="auto">Follow workspace mode</option>
                  <option value="off">Off</option>
                  <option value="spl">Acoustic SPL (quick estimate)</option>
                  <option value="pressure">Speaker pressure map</option>
                  <option value="microphone">Microphone coverage</option>
                  <option value="viewing">Viewing / DISCAS planning</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={cameraLayer}
                  onChange={(e) => setCameraLayer(e.target.checked)}
                />
                Camera FOV layer
              </label>
            </div>
            {floorLayer === "pressure" && (
              <div
                className="flex items-center gap-3 px-4 py-1 text-xs text-slate-300"
                role="status"
              >
                <span>Estimated SPL {pressureSettings.minimumDb} dB</span>
                <span
                  className="h-2 w-32 rounded"
                  style={{
                    background:
                      "linear-gradient(to right,#141f99,#00cce6,#2ed94d,#ffd90d,#f2141f)",
                  }}
                />
                <span>{pressureSettings.maximumDb} dB · Grey: unknown</span>
              </div>
            )}
            {cameraLayer && (
              <div className="px-4 py-1 text-xs text-slate-300">
                Camera volumes use declared horizontal and vertical FOV. Missing
                angles remain unknown; walls clip the volume but furniture
                occlusion is not modeled.
              </div>
            )}
            {floorLayer !== "auto" &&
              floorLayer !== "off" &&
              floorLayer !== "pressure" && (
                <div className="px-4 py-1 text-xs text-slate-300" role="status">
                  {floorLayer === "spl"
                    ? "SPL estimate: blue 40 → green 65 → red 90 dB; grey = unknown. Free field; listener-height samples projected to floor."
                    : "Green: within planning limits · Amber: edge · Red: outside · Grey: unknown. Listener-height samples projected to floor."}
                  {floorLayer === "viewing" &&
                    " Public BDM + 4/6/8 and project off-axis limits; full DISCAS compliance unverified."}
                </div>
              )}
            <div className="analysis-toolbar">
              <button
                aria-pressed={furnitureEditing}
                onClick={() => setFurnitureEditing((v) => !v)}
              >
                {furnitureEditing ? "Furniture editing on" : "Edit furniture"}
              </button>
              <label>
                Workspace mode{" "}
                <select
                  aria-label="Workspace mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as WorkspaceMode)}
                >
                  {Object.entries({
                    overview: "Overview",
                    measurements: "Measurements",
                    cables: "Cable Map",
                    camera: "Camera Coverage",
                    microphone: "Microphone Coverage",
                    speaker: "Speaker Coverage",
                    display: "Display / Viewing",
                  }).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  setView("isometric");
                  canvas.current?.setView("isometric", false);
                }}
              >
                Home
              </button>
              <button
                onClick={() => {
                  if (view === "seat") setView("isometric");
                  canvas.current?.fitRoom();
                }}
              >
                Fit room
              </button>
              <button
                disabled={!selectedId}
                onClick={() => canvas.current?.focusSelected()}
              >
                Focus selected
              </button>
              {mode === "cables" && (
                <label>
                  Cable type{" "}
                  <select
                    aria-label="Cable type"
                    value={cableFilter}
                    onChange={(e) => setCableFilter(e.target.value)}
                  >
                    {["All", ...new Set(routes.map((c) => c.category))].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
            </div>
            {mode === "cables" && (
              <div className="mode-note">
                {routes.length} actual connections · overhead orthogonal routes
                are planning estimates, not installation paths. Click a cable to
                inspect.
              </div>
            )}
            {mode === "camera" && (
              <div className="mode-note">
                Room-clipped geometric FOV, not rated imaging range. Missing
                VFOV gives Unknown full coverage; missing HFOV shows no guide.
                Pan/tilt uses device rotation.
              </div>
            )}
            {mode === "microphone" && (
              <div className="mode-note">
                Geometric pickup coverage at configured seated mouth/ear height.
                Green covered · amber outer 10% · red outside · gray Unknown. No
                measured lobe or intelligibility prediction.
              </div>
            )}
            {mode === "speaker" && (
              <div className="mode-note">
                Geometric coverage or free-field SPL estimate (40–90 dB color
                scale). Gray means Unknown. Assumed polar response; not measured
                room SPL.
              </div>
            )}
            {mode === "display" && (
              <div className="mode-note">
                Planning limits: green within · yellow near limit · red outside
                · gray unknown.
              </div>
            )}
            {cable && mode === "cables" && (
              <div className="cable-inspector" aria-label="Cable inspector">
                <strong>Cable {cable.id}</strong>
                <span>
                  {cable.source} / {cable.from.portId} → {cable.destination} /{" "}
                  {cable.to.portId}
                </span>
                <span>
                  {cable.signal} · {cable.length.toFixed(2)} m estimated route
                  between device anchors
                </span>
              </div>
            )}
            <div
              ref={host}
              className="canvas-host"
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes("application/simstage-device")
                )
                  e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const kind = e.dataTransfer.getData(
                  "application/simstage-device",
                );
                const item = store.api
                  .getState()
                  .catalog.find((i) => i.id === kind);
                if (item) {
                  const point = canvas.current?.placementPoint(
                    e.clientX,
                    e.clientY,
                    item.surface,
                  );
                  if (point) spawn(kind, point);
                  else
                    setError(
                      "That mounting surface is edge-on. Switch to 3D view to place the device.",
                    );
                }
              }}
            />
            {error && (
              <div className="canvas-error" role="alert">
                <strong>{error}</strong>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}
            <div className="canvas-footer">
              <span>
                {furnitureEditing
                  ? "Drag table/chair: move · 0.25 m snap · Shift: 0.05 m · Escape: cancel · Empty space: orbit"
                  : "Drag empty space: orbit · Wheel: zoom · Right/middle drag: pan · Drag device: move · Double-click: focus"}
              </span>
              <span>{Object.keys(devices).length} devices</span>
            </div>
          </div>
          {tab === "schematic" && <SchematicCanvas store={store} />}
        </section>
        <aside className="panel status-panel" aria-label="System health">
          {furnitureEditing && (
            <FurnitureInspector store={store} selected={selectedFurniture} />
          )}
          <p className="eyebrow">LIVE ENGINEERING</p>
          <h2>Design health</h2>
          {floorLayer === "pressure" && (
            <PressureMapPanel
              store={store}
              result={pressureResult}
              error={pressureError}
            />
          )}
          <ScenarioPanel store={store} />
          {(mode === "camera" || mode === "display") && (
            <OpticalAnalysisPanel
              store={store}
              mode={mode}
              result={optical}
              selectedSeat={selectedSeat}
              selectSeat={setSelectedSeat}
            />
          )}
          <AudioAnalysisPanel
            store={store}
            mode={mode}
            analysis={audio}
            microphones={roomMic}
            speakers={roomSpeaker}
            scope={audioScope}
            setScope={setAudioScope}
            layer={audioLayer}
            setLayer={setAudioLayer}
            selectedSeat={selectedSeat}
            selectSeat={setSelectedSeat}
          />
          <EngineeringPanel store={store} audit={audit} />
          {!furnitureEditing && <PropertyInspector store={store} room={room} />}
          <p className="session-note">
            Concept layout only. Reloading clears changes. Spatial routes are
            straight-line estimates, not installation cable schedules.
          </p>
        </aside>
      </main>
      <BOMDrawer store={store} />
    </div>
  );
}
