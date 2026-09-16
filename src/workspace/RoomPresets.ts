import type { RoomSize } from "./DeviceStore";
export type RoomPresetId = "huddle" | "boardroom" | "training";
export const ROOM_PRESETS: Readonly<
  Record<RoomPresetId, { label: string; room: RoomSize }>
> = Object.freeze({
  huddle: {
    label: "Huddle Room",
    room: Object.freeze({ width: 4, depth: 3, height: 2.7, layout: "huddle" }),
  },
  boardroom: {
    label: "Standard Boardroom",
    room: Object.freeze({
      width: 8,
      depth: 6,
      height: 3,
      layout: "conference",
    }),
  },
  training: {
    label: "Large Training Facility",
    room: Object.freeze({
      width: 14,
      depth: 8,
      height: 3.5,
      layout: "training",
    }),
  },
});
