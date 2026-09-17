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
    manager?.setHeatmap(mode === "speaker" ? "spl" : "off", audit.field);
    manager?.setVisualOverlay(mode === "display", audit.visual);
    manager?.setVisualCones(mode === "display", devices, settings);
    manager?.setWorkspaceMode(
      mode,
      store.api.getState(),
      cableFilter,
      selectedCable,
    );
  }, [
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
                Catalog FOV guides, up to 6 m preview depth (not rated range).
                Missing VFOV shows horizontal angles only; missing HFOV shows no
                guide. Pan/tilt uses device rotation.
              </div>
            )}
            {mode === "microphone" && (
              <div className="mode-note">
                Catalog pickup-radius envelopes at 1.2 m; microphone polar/lobe
                shape and intelligibility are not inferred. Missing radius shows
                no guide.
              </div>
            )}
            {mode === "speaker" && (
              <div className="mode-note">
                Direct SPL estimate: blue 40 dB → red 90 dB; gray unknown.
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
