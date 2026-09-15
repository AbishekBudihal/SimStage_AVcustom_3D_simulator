import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { CanvasManager, type WorkspaceView } from './workspace/CanvasManager';
import { DeviceStore, snapToSurface, type DeviceKind, type MountSurface } from './workspace/DeviceStore';
import { useDeviceDrag } from './workspace/useDeviceDrag';
import './workspace.css';
import { PropertyInspector } from './components/PropertyInspector';
import { ViewportHUD } from './components/ViewportHUD';
import { BOMDrawer } from './components/BOMDrawer';

const room = { width: 8, depth: 6, height: 3 };
const inventory: { kind: DeviceKind; label: string; surface: MountSurface; description: string; icon: string }[] = [
  { kind: 'display', label: 'Display', surface: 'north', description: 'Wall mounted · 1.4 m', icon: '▣' },
  { kind: 'ptz_camera', label: 'PTZ camera', surface: 'north', description: 'Wall mounted · pan / tilt', icon: '◉' },
  { kind: 'ceiling_mic', label: 'Ceiling microphone', surface: 'ceiling', description: 'Ceiling mounted · array', icon: '⊙' },
  { kind: 'speaker', label: 'Speaker', surface: 'north', description: 'Wall mounted · audio', icon: '◖' },
  { kind: 'rack', label: 'Equipment rack', surface: 'floor', description: 'Floor standing · equipment', icon: '▤' },
];

export default function App() {
  const [store] = useState(() => new DeviceStore());
  const devices = useStore(store.api, state => state.devices);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<CanvasManager | null>(null);
  const [view, setView] = useState<WorkspaceView>('isometric');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = Object.values(devices).filter(device => device !== undefined);
  const incomplete = all.filter(device => device.metadata.powerWatts === null || device.metadata.heatBtuPerHour === null).length;
  const power = all.reduce((total, device) => total + (device.metadata.powerWatts ?? 0), 0);

  useEffect(() => {
    if (!host.current) return;
    let manager: CanvasManager;
    try {
      manager = new CanvasManager(host.current, { room, onSelect: id => store.api.getState().selectDevice(id) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to initialize WebGL');
      return;
    }
    canvas.current = manager;
    const sync = () => {
      const state = store.api.getState();
      manager.syncDevices(state.devices, state.selectedId);
    };
    const unsubscribe = store.api.subscribe(sync);
    const disposeDrag = useDeviceDrag(manager, store);
    sync(); setReady(true);
    return () => { disposeDrag(); unsubscribe(); manager.dispose(); canvas.current = null; };
  }, [store]);

  function spawn(item: typeof inventory[number]) {
    // Distribute new anchors across the room instead of stacking them at the origin.
    const count = all.filter(device => device.surface === item.surface).length;
    const id = store.add({
      catalogId: `generic-${item.kind}`, kind: item.kind, surface: item.surface,
      position: snapToSurface({ x: -3 + count % 7, y: item.kind === 'ptz_camera' ? 2 : 1.5,
        z: -2 + Math.floor(count / 7) % 5 }, item.surface, room),
      rotation: { x: 0, y: 0, z: 0 }, ports: [],
      metadata: { label: `${item.label} ${all.filter(device => device.kind === item.kind).length + 1}`,
        powerWatts: null, heatBtuPerHour: null, rackUnits: null },
    });
    store.api.getState().selectDevice(id);
  }
  function changeView(next: WorkspaceView) { canvas.current?.setView(next, false); setView(next); }

  return <div className="workspace-app">
    <header className="app-header">
      <div className="brand-mark">S</div><div><strong>SimStage <span>AV</span></strong><small>ONLINE INSTRUMENTS</small></div>
      <div className="project-heading">Untitled workspace <span>Concept design</span></div>
      <span className="session-badge">Local session</span>
    </header>
    <main className="workspace-layout">
      <aside className="panel inventory-panel" aria-label="Quick inventory">
        <p className="eyebrow">BUILD YOUR SPACE</p><h1>Quick inventory</h1>
        <p className="muted">Choose equipment to add it to your room.</p>
        <div className="inventory-list">{inventory.map(item => <button key={item.kind} disabled={!ready || !!error} onClick={() => spawn(item)} className="inventory-button">
          <span className="device-icon" aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><span aria-hidden="true">+</span>
        </button>)}</div>
        <div className="panel-note"><span className="eyebrow">ROOM ENVELOPE</span><strong>8 × 6 × 3 m</strong><p>Generic equipment proxies. Product specifications can be added later.</p></div>
      </aside>
      <section className="canvas-panel" aria-label="Design workspace">
        <div className="canvas-toolbar"><div><strong>Room workspace</strong><span>48 m² · 0.5 m grid</span></div>
          <ViewportHUD view={view} onChange={changeView} disabled={!ready || !!error} />
        </div>
        <div ref={host} className="canvas-host" />
        {!all.length && !error && <div className="canvas-empty"><strong>Your room starts here</strong><span>Add equipment from Quick inventory</span></div>}
        {error && <div className="canvas-error" role="alert"><strong>Unable to start the 3D workspace</strong><p>Enable browser hardware acceleration and reload.</p><small>{error}</small></div>}
        <div className="canvas-footer"><span>Drag to position · Esc to cancel</span><span>{all.length} devices</span></div>
      </section>
      <aside className="panel status-panel" aria-label="System health">
        <p className="eyebrow">DESIGN OVERVIEW</p><h2>System health</h2>
        <div className={`health-card ${error ? 'warning' : ''}`}><span className="status-dot" /><div><strong>{error ? 'Renderer unavailable' : ready ? 'Workspace ready' : 'Starting workspace'}</strong><small>{all.length ? `${all.length} devices in this room` : 'Add your first device to begin'}</small></div></div>
        <h3>Validation</h3><div className="validation-row"><span>Grid snapping</span><b>0.5 m</b></div>
        <div className="validation-row"><span>Equipment metadata</span><b>{incomplete ? `${incomplete} incomplete` : all.length ? 'Complete' : 'No devices'}</b></div>
        <div className="validation-row"><span>Known power load</span><b>{power} W</b></div>
        <p className="muted fine-print">Unknown power and heat values are excluded. Coverage, connectivity and collision validation are not yet available.</p>
        <PropertyInspector store={store} room={room} />
        <p className="session-note">Changes are kept for this session. Reloading clears the workspace.</p>
      </aside>
    </main>
    <BOMDrawer store={store} />
  </div>;
}


