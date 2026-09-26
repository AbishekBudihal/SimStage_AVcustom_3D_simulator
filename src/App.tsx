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
  const selectedId = useStore(store.api, (s) => s.selectedId);
  const devices = useStore(store.api, (s) => s.devices),
    connections = useStore(store.api, (s) => s.connections),
    settings = useStore(store.api, (s) => s.engineering),
    room = useStore(store.api, (s) => s.room);
  const audit = useMemo(
    () => engineeringAudit(store.api.getState(), room),
    [devices, connections, settings, store, room],
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
        ? cameraCoverage(device, room)
        : displayViewing(device, store.api.getState())
      : undefined;
  }, [mode, devices, selectedId, analysisIds, room, settings, store]);
  const [audioScope, setAudioScope] = useState<"room" | "device">("room");
  const [audioLayer, setAudioLayer] = useState<"coverage" | "spl">("coverage");
  const roomMic = useMemo(
    () => analyzeAudio(store.api.getState(), "microphone"),
    [devices, room, store],
  );
  const roomSpeaker = useMemo(
    () => analyzeAudio(store.api.getState(), "speaker"),
    [devices, room, store],
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
  }, [mode, roomMic, roomSpeaker, audioScope, selectedId, analysisIds, store]);
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
    if (!host.current) return;
    let manager: CanvasManager;
    try {
      manager = new CanvasManager(host.current, {
        room: store.api.getState().room,
        onCableSelect: setSelectedCable,
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
      manager.syncDevices(state.devices, state.selectedId);
    };
    const unsubscribe = store.api.subscribe(sync),
      disposeDrag = useDeviceDrag(manager, store);
    sync();
    setReady(true);
    return () => {
      disposeDrag();
      unsubscribe();
      manager.dispose();
      canvas.current = null;
    };
  }, [store]);
  useEffect(() => {
    const manager = canvas.current;
    if (audio)
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
    manager?.setVisualOverlay(false, audit.visual);
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
          <p className="muted">
            {audit.seats} seats · {room.width * room.depth} m²
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
                <span>Cutaway view · {room.width * room.depth} m²</span>
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
                Drag empty space: orbit · Wheel: zoom · Right/middle drag: pan ·
                Drag device: move · Double-click: focus
              </span>
              <span>{Object.keys(devices).length} devices</span>
            </div>
          </div>
          {tab === "schematic" && <SchematicCanvas store={store} />}
        </section>
        <aside className="panel status-panel" aria-label="System health">
          <p className="eyebrow">LIVE ENGINEERING</p>
          <h2>Design health</h2>
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
          <PropertyInspector store={store} room={room} />
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
