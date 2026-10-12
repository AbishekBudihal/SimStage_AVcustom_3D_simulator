import { describe, expect, it } from "vitest";
import { readDxfDrawing } from "../../src/workspace/DxfDrawing";
import { extrudeCad } from "../../src/workspace/DwgImport";
import { environmentGroup, disposeEnvironment } from "../../src/workspace/EnvironmentImport";
const drawing=(entities:string)=>`0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
${entities}0
ENDSEC
0
EOF
`;
const line=`0
LINE
8
Walls
10
0
20
0
11
8000
21
0
`;
describe("ordinary DXF wall extrusion",()=>{
  it("imports LINE wall layers with millimetre units and creates real 3D wall meshes",()=>{
    const cad=readDxfDrawing(drawing(line),'walls.dxf');expect(cad.metersPerUnit).toBe(.001);
    const plan=extrudeCad(cad,['Walls'],cad.metersPerUnit!,3,.2,'walls'),group=environmentGroup(plan);
    expect(plan.outlines).toHaveLength(1);expect(plan.outlines[0].segment).toBeDefined();
    expect(group.children).toHaveLength(1); expect(group.children[0].type).toBe('Mesh');
    disposeEnvironment(group);
  });
  it("accepts open LWPOLYLINE centerlines and preserves layer filtering",()=>{
    const poly=`0
LWPOLYLINE
8
Partitions
70
0
10
0
20
0
10
0
20
6000
10
8000
20
6000
`;
    const cad=readDxfDrawing(drawing(line+poly),'open.dxf');
    expect(extrudeCad(cad,['Partitions'],.001,3,.2,'walls').outlines).toHaveLength(2);
    expect(()=>extrudeCad(cad,['Partitions'],.001,3,.2,'footprints')).toThrow('closed');
  });
  it("reports unsupported and malformed drawings instead of creating fake rooms",()=>{
    expect(()=>readDxfDrawing(drawing(`0
INSERT
8
Walls
`),'blocks.dxf')).toThrow('No supported');
    expect(()=>readDxfDrawing(`0
LINE
10`,'broken.dxf')).toThrow('Malformed');
    const cad=readDxfDrawing(drawing(line+`0
ARC
8
Door
`),'mixed.dxf');expect(cad.warnings[0]).toContain('ARC');
  });
});
