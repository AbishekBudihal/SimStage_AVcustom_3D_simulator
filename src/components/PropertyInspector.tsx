import { useStore } from 'zustand';
import { DeviceStore, type RoomSize } from '../workspace/DeviceStore';
const button = 'rounded-md border border-solid border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700';
export function PropertyInspector({ store, room }: { store: DeviceStore; room: RoomSize }) {
  const selected = useStore(store.api, state => state.selectedId ? state.devices[state.selectedId] : undefined);
  if (!selected) return <section className="mt-6 border-0 border-t border-solid border-slate-700 pt-4"><h3>Device inspector</h3><p className="text-xs leading-relaxed text-slate-400">Select a device to adjust its orientation and mounting height.</p></section>;
  const wall = selected.surface !== 'floor' && selected.surface !== 'ceiling';
  const degrees = ((selected.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
  const shift = (delta: number) => store.update(selected.id, { position: { y: Math.min(room.height, Math.max(0, Math.round((selected.position.y + delta) * 100) / 100)) } });
  return <section className="mt-6 border-0 border-t border-solid border-slate-700 pt-4" aria-label="Device inspector">
    <h3>Device inspector</h3><strong className="text-sm">{selected.metadata.label}</strong><p className="text-xs text-slate-400">{selected.surface} mount</p>
    <div className="my-4 grid grid-cols-3 gap-2">{(['x','y','z'] as const).map(axis => <div key={axis} className="rounded bg-slate-800 p-2 text-xs"><span className="block text-slate-400">{axis.toUpperCase()}</span>{selected.position[axis].toFixed(2)} m</div>)}</div>
    <p className="text-xs text-slate-400">Rotation around vertical axis</p><div className="grid grid-cols-4 gap-1">{[0,90,180,270].map(angle => <button key={angle} className={button} aria-pressed={Math.abs(degrees-angle) < 0.01} onClick={() => store.update(selected.id, { rotation: { y: angle * Math.PI / 180 } })}>{angle}°</button>)}</div>
    <p className="mt-4 text-xs text-slate-400">Height offset</p><div className="flex gap-2"><button className={button} disabled={!wall || selected.position.y <= 0} onClick={() => shift(-0.5)}>− 0.5 m</button><button className={button} disabled={!wall || selected.position.y >= room.height} onClick={() => shift(0.5)}>+ 0.5 m</button></div>
    {!wall && <p className="text-xs leading-relaxed text-slate-500">Height is fixed to the {selected.surface} mounting plane.</p>}
    <button className="mt-5 w-full rounded-md border border-solid border-rose-900 bg-transparent py-2 text-xs text-rose-300 hover:bg-rose-950" onClick={() => store.remove(selected.id)}>Delete device</button>
  </section>;
}
