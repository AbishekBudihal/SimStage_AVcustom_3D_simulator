import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import { roomLayout } from "../workspace/RoomLayout";
import { pressureAt, probeRays } from "../workspace/SimulationProbe";
import type { PressureResult } from "../workspace/PressureModel";
export function SimulationProbePanel({store,result,seatId,onSeat,showRays,onRays}:{store:DeviceStore;result:PressureResult|null;seatId:string|null;onSeat:(id:string|null)=>void;showRays:boolean;onRays:(v:boolean)=>void}){
  const state=useStore(store.api),seats=roomLayout(state.room).seats,seat=seats.find(s=>s.id===seatId), rays=seat?probeRays(state,seat.position,state.pressure):[];
  const point=seat?{...seat.position,y:state.pressure.audienceHeight}:null, level=point?pressureAt(result,point):null;
  return <section className="panel-note" aria-label="Simulation seat probe"><h3>Seat probe & ray paths</h3>
    <select aria-label="Simulation probe seat" value={seat?.id??""} onChange={e=>onSeat(e.target.value||null)}><option value="">Choose a seat</option>{seats.map(s=><option key={s.id}>{s.id}</option>)}</select>
    <label><input type="checkbox" checked={showRays} onChange={e=>onRays(e.target.checked)} /> Show acoustic ray paths</label>
    {seat && <p>Map at seat plan coordinates: {level===null?"Unknown / outside map":`${level.toFixed(1)} dB SPL`}. {rays.filter(r=>!r.blocked).length}/{rays.length} speakers have a clear direct path.</p>}
    <p className="fine-print">Green: direct · Amber: first reflection · Red dashed: blocked direct path. Map values are interpolated on the configured surface; rays terminate at seated ear height. Rays use the configured pressure-map obstruction model. Reflections assume the rectangular room; diffraction is not simulated.</p>
    {rays.map(r=><p key={r.deviceId}>{state.devices[r.deviceId]?.metadata.label}: {r.paths.length} paths, shortest {r.paths.length?Math.min(...r.paths.map(p=>p.distance)).toFixed(2):"—"} m.</p>)}
  </section>;
}
