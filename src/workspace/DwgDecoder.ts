import type { CadDrawing } from "./DwgImport";
/** One isolated decoder per import. Termination releases WASM memory on every exit. */
export function decodeDwg(
  file: File,
  signal: AbortSignal,
): Promise<CadDrawing> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Import cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./dwg.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          Error("DWG decoding exceeded 60 seconds. Use a smaller drawing."),
        ),
      60000,
    );
    const abort = () =>
      finish(undefined, new DOMException("Import cancelled", "AbortError"));
    let done = false;
    function finish(drawing?: CadDrawing, error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else if (drawing) resolve(drawing);
      else reject(Error("DWG decoder returned no geometry."));
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      e: MessageEvent<{ drawing?: CadDrawing; error?: string }>,
    ) => finish(e.data.drawing, e.data.error ? Error(e.data.error) : undefined);
    worker.onerror = () =>
      finish(
        undefined,
        Error(
          "DWG decoder could not run. Check available memory and reload the application.",
        ),
      );
    worker.onmessageerror = () =>
      finish(undefined, Error("DWG geometry could not be transferred."));
    file.arrayBuffer().then(
      (data) => {
        if (!done) worker.postMessage({ data, name: file.name }, [data]);
      },
      (error) => finish(undefined, error),
    );
  });
}
