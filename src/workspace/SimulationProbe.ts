import type { DeviceState, XYZ } from "./DeviceStore";
import { acousticObstacles, soundPaths, type PressureResult, type PressureSettings, type SoundPath } from "./PressureModel";
import { simulationBlocker } from "./SimulationGeometry";
/** Map interpolation is an inspection aid, not an additional acoustic solve. */
export function pressureAt(result: PressureResult | null, point: XYZ): number | null {
  const p=result?.surfaces.find(p=>Math.abs(point.x-p.x)<=p.width/2 && Math.abs(point.z-p.z)<=p.depth/2);
  if(!p) return null;
  const x=(point.x-p.x+p.width/2)/p.width*(p.columns-1), z=(point.z-p.z+p.depth/2)/p.depth*(p.rows-1);
  const a=Math.floor(x),b=Math.floor(z), fx=x-a,fz=z-b;
  const samples=[[a,b,(1-fx)*(1-fz)],[Math.min(a+1,p.columns-1),b,fx*(1-fz)],[a,Math.min(b+1,p.rows-1),(1-fx)*fz],[Math.min(a+1,p.columns-1),Math.min(b+1,p.rows-1),fx*fz]];
  let value=0; for(const [col,row,weight] of samples) { if(weight<1e-10) continue; const level=p.levels[row*p.columns+col]; if(level==null) return null; value+=level*weight; }
  return value;
}
export interface ProbeRay { deviceId: string; blocked: boolean; paths: SoundPath[] }
export function probeRays(state: Pick<DeviceState,"devices"|"room"|"environment">, receiver: XYZ, settings: PressureSettings): ProbeRay[] {
  const blocked=simulationBlocker(settings.obstruction ? state.environment : null);
  return Object.values(state.devices).filter(d=>d?.kind==="speaker").map(d=>{
    const paths=soundPaths(d!.position,receiver,state.room,settings.obstruction ? acousticObstacles(state) : [],settings.reflections,blocked);
    return {deviceId:d!.id,blocked:!paths.some(p=>!p.reflected),paths};
  });
}
