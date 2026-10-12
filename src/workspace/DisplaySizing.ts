import type { EngineeringSettings, PlacedDevice, XYZ } from "./DeviceStore";
import { orientation, screenOrigin, vector } from "./OpticalTransform";
/** Required image height and allowable height interval under configured planning criteria. */
export function displaySizing(display: PlacedDevice, eye: XYZ, settings: EngineeringSettings, roomHeight?: number) {
  const relative=vector(eye).sub(screenOrigin(display)).applyQuaternion(orientation(display).invert());
  const distance=Math.hypot(relative.x,relative.z);
  const minimumHeight=Math.max(distance/settings.viewingRatio,distance/(2*settings.elementPercent));
  const angleHeight=2*(distance*Math.tan(settings.verticalLimit*Math.PI/180)-Math.abs(relative.y));
  const origin=screenOrigin(display);
  const maximumHeight=Math.min(angleHeight,roomHeight === undefined ? Infinity : 2*Math.min(origin.y,roomHeight-origin.y));
  const horizontal=Math.abs(Math.atan2(relative.x,relative.z)*180/Math.PI);
  return {distance, minimumHeight, maximumHeight:Math.max(0,maximumHeight), feasible: relative.z>0 && horizontal<=settings.horizontalLimit && maximumHeight>=minimumHeight,
    reason: relative.z<=0 ? "Viewer is behind the screen" : horizontal>settings.horizontalLimit ? "Move/rotate the display or seating to reduce horizontal off-axis angle" : maximumHeight<minimumHeight ? "Adjust mounting height or seating; the required image cannot fit the vertical-angle or floor/ceiling limit" : "Size interval meets configured geometric limits; verify content and obstructions separately"};
}
