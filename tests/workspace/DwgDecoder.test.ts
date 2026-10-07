import { afterEach, describe, it, expect, vi } from "vitest";
import { decodeDwg } from "../../src/workspace/DwgDecoder";
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
const file = {
  name: "room.dwg",
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(6)),
} as File;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("DWG worker lifecycle", () => {
  it("terminates and unregisters after success", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController(),
      promise = decodeDwg(file, controller.signal);
    await Promise.resolve();
    expect(FakeWorker.latest.postMessage).toHaveBeenCalledOnce();
    const drawing = { name: "test", paths: [], warnings: [] };
    FakeWorker.latest.onmessage!({ data: { drawing } });
    expect(await promise).toEqual(drawing);
    controller.abort();
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("cancels an in-flight import and releases its worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController(),
      promise = decodeDwg(file, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("bounds unresponsive decoding and reports failures", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const promise = decodeDwg(file, new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow("60 seconds");
    await vi.advanceTimersByTimeAsync(60000);
    await rejection;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it("rejects decoder errors rather than resolving partial geometry", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const promise = decodeDwg(file, new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow("corrupt");
    FakeWorker.latest.onmessage!({ data: { error: "corrupt DWG" } });
    await rejection;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
