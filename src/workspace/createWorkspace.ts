import { DeviceStore } from "./DeviceStore";
import { deviceFromProfile } from "./catalog";
import { createDefaultRoom } from "../room/RoomModel";
export function createWorkspace() {
  const store = new DeviceStore();
  const source = createDefaultRoom();
  store.api.getState().setRoom({
    width: source.width,
    depth: source.depth,
    height: source.height,
    layout: "conference",
  });
  const room = store.api.getState().room;
  const add = (id: string) => {
    const profile = store.api.getState().catalog.find((p) => p.id === id);
    if (!profile) throw new Error(`Missing catalog record ${id}`);
    return store.add(deviceFromProfile(profile, 0, room));
  };
  const display = add("samsung-qm75b"),
    camera = add("yealink-uvc86");
  add("shure-mxa920");
  add("qsc-adc6t");
  add("biamp-tesiraforte-vt4");
  store.api
    .getState()
    .connect(
      { deviceId: camera, portId: "hdmi-out" },
      { deviceId: display, portId: "hdmi-1" },
    );
  return store;
}
