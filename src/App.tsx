import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { CanvasManager, type WorkspaceView } from "./workspace/CanvasManager";
import { useDeviceDrag } from "./workspace/useDeviceDrag";
import { HARDWARE_CATALOG, hardwareDevice } from "./workspace/HardwareCatalog";
import { ROOM_PRESETS, type RoomPresetId } from "./workspace/RoomPresets";
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
  const devices = useStore(store.api, (s) => s.devices),
    connections = useStore(store.api, (s) => s.connections),
    settings = useStore(store.api, (s) => s.engineering),
    room = useStore(store.api, (s) => s.room),
    roomPreset = useStore(store.api, (s) => s.roomPreset);
  const audit = useMemo(
    () => engineeringAudit(store.api.getState(), room),
    [devices, connections, settings, store, room],
  );
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<CanvasManager | null>(null);
  const [view, setView] = useState<WorkspaceView>("isometric"),
    [tab, setTab] = useState<"spatial" | "schematic">("spatial");
  const [heat, setHeat] = useState<
    "off" | "spl" | "intelligibility" | "visual"
  >("off");
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    let manager: CanvasManager;
    try {
      manager = new CanvasManager(host.current, {
        room: store.api.getState().room,
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
    canvas.current?.setHeatmap(heat === "visual" ? "off" : heat, audit.field);
    canvas.current?.setVisualOverlay(heat === "visual", audit.visual);
  }, [audit, heat, ready]);
  function spawn(profileId: string, point?: XYZ) {
    const count = store
      .snapshot()
      .filter((d) => d.catalogId === profileId).length;
    const id = store.add(hardwareDevice(profileId, count, room, point));
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
          {ROOM_PRESETS[roomPreset].label}
          <span>Spatial design + signal flow</span>
        </div>
        <span className="session-badge">
          Planning estimates · local session
        </span>
      </header>
      <main className="workspace-layout">
        <aside className="panel inventory-panel" aria-label="Quick inventory">
          <p className="eyebrow">SYSTEM BUILDER</p>
          <h1>Equipment library</h1>
          <p className="muted">
            Manufacturer profiles · click or drag to place. Published
            specifications and source links in the inspector.
          </p>
          <div className="inventory-list">
            {HARDWARE_CATALOG.map((item) => (
              <button
                key={item.id}
                draggable={ready}
                disabled={!ready || !!error}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/simstage-device",
                    item.id,
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => spawn(item.id)}
                className="inventory-button"
              >
                <span className="device-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>
                  <strong>
                    {item.manufacturer} {item.model}
                  </strong>
                  <small>
                    {item.ports.length} ports · {item.surface} mount
                  </small>
                </span>
                <span aria-hidden="true">+</span>
              </button>
            ))}
          </div>
          <div className="panel-note">
            <span className="eyebrow">ROOM ENVELOPE</span>
            <label className="engineering-input">
              <span>Room preset</span>
              <select
                aria-label="Room preset"
                value={roomPreset}
                onChange={(e) =>
                  store.api
                    .getState()
                    .setRoomPreset(e.target.value as RoomPresetId)
                }
              >
                {Object.entries(ROOM_PRESETS).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <strong>
              {room.width} × {room.depth} × {room.height} m
            </strong>
            <p>{audit.seats} seats · 0.75 m table · cutaway shell</p>
          </div>
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
                <strong>
                  {ROOM_PRESETS[roomPreset].label} / {audit.seats} seats
                </strong>
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
                Coverage layer{" "}
                <select
                  aria-label="Coverage layer"
                  value={heat}
                  onChange={(e) => setHeat(e.target.value as typeof heat)}
                >
                  <option value="off">Off</option>
                  <option value="visual">Visual seat limits (planning)</option>
                  <option value="spl">Direct SPL estimate</option>
                  <option value="intelligibility">
                    Intelligibility proxy (not STI)
                  </option>
                </select>
              </label>
              {heat === "visual" && (
                <span className="heat-legend">
                  Green: within · Yellow: near limit · Red: review · Gray: no
                  display
                </span>
              )}
              {heat !== "off" && heat !== "visual" && (
                <span className="heat-legend">
                  {heat === "spl" ? "40 dB" : "0.0"} <i />{" "}
                  {heat === "spl" ? "90 dB" : "1.0"} · gray = unknown
                </span>
              )}
            </div>
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
                const item = HARDWARE_CATALOG.find((i) => i.id === kind);
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
                Drag to position · Alt-drag to change surface · Esc to cancel
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
