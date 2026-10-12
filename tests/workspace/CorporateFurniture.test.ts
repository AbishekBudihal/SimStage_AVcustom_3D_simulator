import { describe, expect, it } from "vitest";
import { createDeviceStore } from "../../src/workspace/DeviceStore";
import { roomLayout } from "../../src/workspace/RoomLayout";
import { SpatialAssets } from "../../src/workspace/SpatialAssets";
describe("corporate furniture",()=>{
  it("generates U-shaped workshop furniture with bounded listener positions",()=>{
    const api=createDeviceStore(); api.getState().setRoom({width:10,depth:8,height:3,capacity:18,furnitureLayout:"u_shape",chairStyle:"task"});
    const room=api.getState().room, layout=roomLayout(room);
    expect(layout.tables).toHaveLength(3); expect(layout.seats.length).toBeGreaterThan(0);
    for(const s of layout.seats) { expect(Math.abs(s.position.x)).toBeLessThan(room.width/2); expect(Math.abs(s.position.z)).toBeLessThan(room.depth/2); }
    const assets=new SpatialAssets(),group=assets.room(room),f=group.getObjectByName("Furniture")!;
    expect(f.children.filter(c=>c.userData.furnitureId?.startsWith("table:"))).toHaveLength(3);
    expect(f.children.filter(c=>c.userData.furnitureId?.startsWith("seat:"))).toHaveLength(layout.seats.length);
    assets.dispose();
  });
  it("presentation seating has no tables and supports manual seat edits",()=>{
    const api=createDeviceStore(); api.getState().setRoom({width:10,depth:8,height:3,capacity:24,furnitureLayout:"theater"});
    const first=roomLayout(api.getState().room);
    expect(first.tables).toHaveLength(0); expect(first.seats).toHaveLength(24);
    api.getState().setRoom({furniture:{['seat:'+first.seats[0].id]:{x:1,z:1}}});
    expect(roomLayout(api.getState().room).seats[0].position).toMatchObject({x:1,z:1});
  });
  it("does not overlap U-shaped tables in undersized rooms and rejects invalid options",()=>{
    const api=createDeviceStore();api.getState().setRoom({width:3,depth:3,height:3,furnitureLayout:"u_shape"});
    expect(roomLayout(api.getState().room).tables).toHaveLength(0);
    expect(()=>api.getState().setRoom({chairStyle:"bad" as never})).toThrow();
  });
});
