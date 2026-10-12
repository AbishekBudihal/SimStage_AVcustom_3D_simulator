import { describe, expect, it } from "vitest";
import { pressureAt, probeRays } from "../../src/workspace/SimulationProbe";
import { soundPaths, DEFAULT_PRESSURE, type PressureResult } from "../../src/workspace/PressureModel";
import { createWorkspace } from "../../src/workspace/createWorkspace";
import { displaySizing } from "../../src/workspace/DisplaySizing";
import { SimulationRays } from "../../src/workspace/SimulationRays";
import * as T from "three";
describe("interactive simulation inspection",()=>{
  it("interpolates valid map samples and never interpolates through unknown samples",()=>{
    const result={surfaces:[{id:"floor",x:0,z:0,width:2,depth:2,height:0,rise:0,columns:2,rows:2,levels:[60,70,80,90]}]} as PressureResult;
    expect(pressureAt(result,{x:0,y:1.2,z:0})).toBe(75);
    expect(pressureAt(result,{x:2,y:1.2,z:0})).toBeNull();
    result.surfaces[0].levels[3]=null;
    expect(pressureAt(result,{x:0,y:1.2,z:0})).toBeNull();
    expect(pressureAt(result,{x:-1,y:1.2,z:-1})).toBe(60);
  });
  it("reports actual bounce vertices whose segment lengths equal the modeled path",()=>{
    const paths=soundPaths({x:0,y:2,z:0},{x:1,y:1,z:1},{width:8,depth:6,height:3},[],true);
    expect(paths.filter(p=>p.reflected)).toHaveLength(6);
    for(const path of paths) {
      let length=0;for(let i=1;i<path.vertices.length;i++) length+=new T.Vector3().copy(path.vertices[i] as T.Vector3).distanceTo(new T.Vector3().copy(path.vertices[i-1] as T.Vector3));
      expect(length).toBeCloseTo(path.distance);
    }
  });
  it("uses pressure obstruction settings and clears GPU ray objects when disabled",()=>{
    const store=createWorkspace(),state=store.api.getState(),scene=new T.Scene(),rays=new SimulationRays(scene);
    const point={x:0,y:1.2,z:1};
    expect(probeRays(state,point,DEFAULT_PRESSURE)).toHaveLength(1);
    const underTable={x:0,y:.5,z:0};
    expect(probeRays(state,underTable,{...DEFAULT_PRESSURE,reflections:false})[0].blocked).toBe(true);
    expect(probeRays(state,underTable,{...DEFAULT_PRESSURE,reflections:false,obstruction:false})[0].blocked).toBe(false);
    rays.update(state,point,DEFAULT_PRESSURE);expect(rays.group.children.length).toBeGreaterThan(0);
    rays.update(state,null,DEFAULT_PRESSURE);expect(rays.group.children).toHaveLength(0);
    rays.dispose();expect(scene.children).toHaveLength(0);
  });
  it("calculates content-dependent image height and rejects impossible off-axis seating",()=>{
    const store=createWorkspace(),state=store.api.getState(),display=Object.values(state.devices).find(d=>d?.kind==="display")!;
    const eye={x:display.position.x,y:display.position.y,z:display.position.z+4};
    const size=displaySizing(display,eye,state.engineering);
    expect(size.minimumHeight).toBeCloseTo(size.distance/6);
    expect(size.feasible).toBe(true);
    expect(displaySizing(display,eye,state.engineering,.5).feasible).toBe(false);
    expect(displaySizing(display,{...eye,x:30},state.engineering).feasible).toBe(false);
    expect(displaySizing(display,eye,{...state.engineering,elementPercent:1}).minimumHeight).toBeCloseTo(size.distance/2);
  });
});
