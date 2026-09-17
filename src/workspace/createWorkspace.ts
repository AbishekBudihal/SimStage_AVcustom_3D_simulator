import { DeviceStore } from "./DeviceStore";
import { deviceFromProfile } from "./catalog";
import { createDefaultRoom } from "../room/RoomModel";
export function createWorkspace() {
  const store = new DeviceStore();
  const source = createDefaultRoom();
  store.api
    .getState()
    .setRoom({
      width: source.width,
      depth: source.depth,
      height: source.height,
      layout: "conference",
    });
  const room = store.api.getState().room;
  const add = (id: string, point: { x: number; y: number; z: number }) => {
    const profile = store.api.getState().catalog.find((p) => p.id === id);
    if (!profile) throw new Error(`Missing bundled catalog record: ${id}`);
    return store.add(deviceFromProfile(profile, 0, room, point));
  };
  const display = add("samsung-qm75b", { x: 0, y: 1.5, z: -room.depth / 2 });
  const camera = add("yealink-uvc86", { x: 0, y: 1, z: -room.depth / 2 });
  add("shure-mxa920", { x: 0, y: room.height, z: 0 });
  add("qsc-adc6t", { x: 2, y: room.height, z: 0 });
  add("biamp-tesiraforte-vt4", { x: 0.5, y: 0.75, z: 1 });
  store.api
    .getState()
    .connect(
      { deviceId: camera, portId: "hdmi-out" },
      { deviceId: display, portId: "hdmi-1" },
    );
  return store;
}
