import type { CadDrawing, CadPath } from "./DwgImport";
/** Safe ASCII model-space LINE/straight LWPOLYLINE adapter for the common CAD extrusion flow. */
export function readDxfDrawing(text: string, name: string): CadDrawing {
  if (text.length > 10_000_000 || text.startsWith("AutoCAD Binary")) throw Error("Use ASCII DXF below 10 MB.");
  const lines = text.replace(/\r/g, "").trimEnd().split("\n");
  if (lines.length % 2) throw Error("Malformed DXF group pairs.");
  const pairs: [number, string][] = [];
  for (let i=0;i<lines.length;i+=2) {
    const code=Number(lines[i].trim()); if (!Number.isInteger(code)) throw Error("Invalid DXF group code.");
    pairs.push([code, lines[i+1].trim()]);
  }
  const paths: CadPath[] = [], warnings = new Set<string>();
  let section = "", metersPerUnit: number | undefined, vertexCount = 0;
  const units: Record<number, number> = {1:.0254,2:.3048,4:.001,5:.01,6:1};
  for (let i=0;i<pairs.length;i++) {
    const [code,type]=pairs[i];
    if(code===0 && type==="SECTION") { section=pairs[i+1]?.[1] ?? ""; continue; }
    if(code===0 && type==="ENDSEC") { section=""; continue; }
    if(section==="HEADER" && code===9 && type==="$INSUNITS") metersPerUnit=units[Number(pairs[i+1]?.[1])];
    if(section!=="ENTITIES" || code!==0) continue;
    let end=i+1; while(end<pairs.length && pairs[end][0]!==0) end++;
    const data=pairs.slice(i+1,end), num=(c:number, fallback=0)=>Number(data.find(p=>p[0]===c)?.[1] ?? fallback);
    if(num(67)!==0 || num(60)!==0) continue;
    const layer=data.find(p=>p[0]===8)?.[1] ?? "0";
    if(!["LINE","LWPOLYLINE"].includes(type)) { warnings.add(`Skipped ${type}; blocks, arcs and custom entities require conversion to straight model-space linework.`); continue; }
    if(num(210)!==0 || num(220)!==0 || num(230,1)!==1 || data.some(p=>p[0]===42 && Number(p[1])!==0)) { warnings.add("Skipped curved or tilted linework."); continue; }
    const points = type==="LINE" ? [{x:num(10,NaN),y:-num(20,NaN)},{x:num(11,NaN),y:-num(21,NaN)}] : [];
    if(type==="LINE" && Math.abs(num(30)-num(31))>1e-8) { warnings.add("Skipped non-horizontal LINE."); continue; }
    if(type==="LWPOLYLINE") for(let j=0;j<data.length;j++) if(data[j][0]===10) {
      const next=data.slice(j+1).find(p=>p[0]===20 || p[0]===10);
      if(next?.[0]!==20) throw Error("DXF vertex missing Y coordinate.");
      points.push({x:Number(data[j][1]), y:-Number(next[1])});
    }
    if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw Error("Nonfinite DXF coordinates.");
    if(points.length>2 && points[0].x===points[points.length-1].x && points[0].y===points[points.length-1].y) points.pop();
    if(points.length<2) { warnings.add("Skipped empty path."); continue; }
    vertexCount += points.length;
    if(num(30)!==0 || num(38)!==0) warnings.add("CAD elevations are flattened; extrusion height is set in the editor.");
    paths.push({id:`dxf-path-${paths.length}`,layer,points,closed:type==="LWPOLYLINE" && !!(num(70)&1)});
    if(paths.length>5000 || vertexCount>20000) throw Error("DXF exceeds 5,000 paths / 20,000 vertices; select/export architectural layers only.");
  }
  if(!paths.length) throw Error("No supported LINE or straight LWPOLYLINE model-space geometry. Export/explode architectural layers in CAD.");
  if(!metersPerUnit) warnings.add("Drawing units are unknown. Confirm real units before extrusion.");
  return {name, paths, metersPerUnit, warnings:[...warnings]};
}
