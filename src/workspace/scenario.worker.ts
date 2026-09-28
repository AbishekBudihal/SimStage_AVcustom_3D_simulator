import {
  runScenarios,
  type ScenarioConfig,
  type ScenarioInput,
} from "./ScenarioSimulation";
self.onmessage = (
  event: MessageEvent<{ state: ScenarioInput; config: ScenarioConfig }>,
) => {
  try {
    self.postMessage({
      report: runScenarios(event.data.state, event.data.config),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
