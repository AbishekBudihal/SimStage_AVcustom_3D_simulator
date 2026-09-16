import { DeviceStore } from "./DeviceStore";
import { hardwareDevice } from "./HardwareCatalog";
export function createWorkspace() {
  const store = new DeviceStore(),
    room = store.api.getState().room;
  const display = store.add(
    hardwareDevice("samsung-qm75c", 0, room, { x: 0, y: 1.5, z: -3 }),
  );
  store.add(hardwareDevice("shure-mxa920-s", 0, room, { x: 0, y: 3, z: 0 }));
  const camera = store.add(
    hardwareDevice("sony-srg-x400", 0, room, { x: 0, y: 0.75, z: -1 }),
  );
  store.add(hardwareDevice("qsc-ad-s6t", 0, room, { x: 2, y: 2, z: -3 }));
  store.add(
    hardwareDevice("qsys-core8flex", 0, room, { x: 0.5, y: 0.75, z: 1 }),
  );
  store.api
    .getState()
    .connect(
      { deviceId: camera, portId: "HDMI out" },
      { deviceId: display, portId: "HDMI 1" },
    );
  return store;
}
