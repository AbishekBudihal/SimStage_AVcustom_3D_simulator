import * as T from "three";
import type { DeviceState, XYZ } from "./DeviceStore";
import type { PressureSettings } from "./PressureModel";
import { probeRays } from "./SimulationProbe";
export class SimulationRays {
  readonly group=new T.Group();
  constructor(scene:T.Scene){this.group.name="Simulation ray paths";scene.add(this.group);}
  update(state:DeviceState, point:XYZ|null, settings:PressureSettings){
    this.clear(); if(!point) return;
    for(const ray of probeRays(state,point,settings)) {
      for(const path of ray.paths) this.line(path.vertices,path.reflected?0xffc857:0x26d99a);
      if(ray.blocked) this.line([state.devices[ray.deviceId]!.position,point],0xff667d,true);
    }
    const marker=new T.Mesh(new T.SphereGeometry(.07,12,8),new T.MeshBasicMaterial({color:0xffffff}));
    marker.position.set(point.x,point.y,point.z);this.group.add(marker);
  }
  private line(points:XYZ[],color:number,dashed=false){
    const geometry=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(p.x,p.y,p.z)));
    const material=dashed?new T.LineDashedMaterial({color,dashSize:.15,gapSize:.1,depthTest:false}):new T.LineBasicMaterial({color,depthTest:false});
    const line=new T.Line(geometry,material);line.computeLineDistances();line.renderOrder=5;this.group.add(line);
  }
  private clear(){this.group.traverse(o=>{if(o instanceof T.Mesh || o instanceof T.Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});this.group.clear();}
  dispose(){this.clear();this.group.removeFromParent();}
}
