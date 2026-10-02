import {
  pressureMap,
  type PressureInput,
  type PressureSettings,
} from "./PressureModel";
self.onmessage = (
  e: MessageEvent<{ state: PressureInput; settings: PressureSettings }>,
) => {
  try {
    self.postMessage({ result: pressureMap(e.data.state, e.data.settings) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
