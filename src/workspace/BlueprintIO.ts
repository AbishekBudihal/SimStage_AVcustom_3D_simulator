/// <reference types="vite/client" />
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  freezeEnvironment,
  environmentGroup,
  disposeEnvironment,
  type ImportedEnvironment,
} from "./EnvironmentImport";
export function serializeBlueprint(plan: ImportedEnvironment) {
  return JSON.stringify(
    {
      format: "simstage-blueprint",
      version: 1,
      environment: freezeEnvironment(plan),
    },
    null,
    2,
  );
}
export function parseBlueprint(text: string): ImportedEnvironment {
  if (text.length > 40_000_000) throw Error("Blueprint JSON exceeds 40 MB.");
  const value = JSON.parse(text);
  if (
    value?.format !== "simstage-blueprint" ||
    value.version !== 1 ||
    !value.environment ||
    !Array.isArray(value.environment.outlines)
  )
    throw Error("Unsupported blueprint schema/version.");
  return freezeEnvironment(value.environment);
}
export function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportBlueprint(
  plan: ImportedEnvironment,
  format: "glb" | "obj",
) {
  const group = environmentGroup({
    ...freezeEnvironment(plan),
    image: undefined,
  });
  try {
    group.updateMatrixWorld(true);
    if (format === "obj") {
      const { OBJExporter } =
        await import("three/examples/jsm/exporters/OBJExporter.js");
      return new Blob([new OBJExporter().parse(group)], { type: "text/plain" });
    }
    const { GLTFExporter } =
      await import("three/examples/jsm/exporters/GLTFExporter.js");
    const data = await new GLTFExporter().parseAsync(group, { binary: true });
    return new Blob([data as ArrayBuffer], { type: "model/gltf-binary" });
  } finally {
    disposeEnvironment(group);
  }
}
export async function pdfBlueprint(file: File, pageNumber: number) {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdf.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const doc = await task.promise;
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > doc.numPages
    )
      throw Error(`Choose a PDF page from 1 to ${doc.numPages}.`);
    const page = await doc.getPage(pageNumber),
      base = page.getViewport({ scale: 1 }),
      scale = Math.min(2, 4096 / Math.max(base.width, base.height)),
      viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("PDF canvas unavailable.");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return {
      name: `${file.name} · page ${pageNumber}/${doc.numPages}`,
      image: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      metersPerUnit: 1,
      outlines: [],
    } satisfies ImportedEnvironment;
  } finally {
    await task.destroy();
  }
}
