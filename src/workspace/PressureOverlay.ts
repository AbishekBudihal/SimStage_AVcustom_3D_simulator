import * as T from "three";
import type {
  PressureResult,
  PressureSettings,
  PressureSurface,
} from "./PressureModel";
/** 16-bit dB payload + validity mask. Display smoothing never creates acoustic samples. */
export function encodePressure(levels: readonly (number | null)[]) {
  const bytes = new Uint8Array(levels.length * 4);
  levels.forEach((db, i) => {
    const valid = db !== null && Number.isFinite(db);
    const value = valid
      ? Math.round(T.MathUtils.clamp((db! + 120) / 300, 0, 1) * 65535)
      : 0;
    bytes[i * 4] = value >> 8;
    bytes[i * 4 + 1] = value & 255;
    bytes[i * 4 + 2] = valid ? 255 : 0;
    bytes[i * 4 + 3] = 255;
  });
  return bytes;
}
const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `
precision highp float;
uniform sampler2D field; uniform vec2 size; uniform float low; uniform float high;
varying vec2 vUv;
vec4 sampleAt(vec2 p){return texture2D(field,(clamp(p,vec2(0.0),size-1.0)+0.5)/size);}
float db(vec4 p){return ((p.r*255.0*256.0+p.g*255.0)/65535.0)*300.0-120.0;}
void main(){
  vec2 p=clamp(vUv,0.0,1.0)*(size-1.0),base=floor(p),f=fract(p);
  vec4 a=sampleAt(base),b=sampleAt(base+vec2(1,0)),c=sampleAt(base+vec2(0,1)),d=sampleAt(base+vec2(1,1));
  if(min(min(a.b,b.b),min(c.b,d.b))<0.5){gl_FragColor=vec4(0.32,0.38,0.45,0.8);return;}
  float level=mix(mix(db(a),db(b),f.x),mix(db(c),db(d),f.x),f.y); float t=clamp((level-low)/(high-low),0.0,1.0);
  vec3 color=t<0.25?mix(vec3(0.08,0.12,0.60),vec3(0.0,0.80,0.90),t*4.0):t<0.5?mix(vec3(0.0,0.80,0.90),vec3(0.18,0.85,0.30),(t-0.25)*4.0):t<0.75?mix(vec3(0.18,0.85,0.30),vec3(1.0,0.85,0.05),(t-0.5)*4.0):mix(vec3(1.0,0.85,0.05),vec3(0.95,0.08,0.12),(t-0.75)*4.0);
  gl_FragColor=vec4(color,0.78);
}`;
interface Patch {
  mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  texture: T.DataTexture;
  columns: number;
  rows: number;
}
export class PressureOverlay {
  readonly group = new T.Group();
  private patches = new Map<string, Patch>();
  constructor(scene: T.Scene) {
    this.group.name = "Calculated pressure surfaces";
    this.group.visible = false;
    scene.add(this.group);
  }
  update(result: PressureResult | null, settings: PressureSettings) {
    this.group.visible = !!result;
    if (!result) return;
    const ids = new Set(result.surfaces.map((p) => p.id));
    for (const [id, patch] of this.patches)
      if (!ids.has(id)) {
        this.release(patch);
        this.patches.delete(id);
      }
    for (const surface of result.surfaces) {
      let patch = this.patches.get(surface.id);
      if (
        patch &&
        (patch.columns !== surface.columns || patch.rows !== surface.rows)
      ) {
        this.release(patch);
        this.patches.delete(surface.id);
        patch = undefined;
      }
      const data = encodePressure(surface.levels);
      if (!patch) {
        const texture = new T.DataTexture(
          data,
          surface.columns,
          surface.rows,
          T.RGBAFormat,
          T.UnsignedByteType,
        );
        texture.magFilter = T.NearestFilter;
        texture.minFilter = T.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        const geometry = new T.BufferGeometry();
        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(new Float32Array(12), 3),
        );
        geometry.setAttribute(
          "uv",
          new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
        );
        geometry.setIndex([0, 2, 1, 1, 2, 3]);
        const material = new T.ShaderMaterial({
          uniforms: {
            field: { value: texture },
            size: { value: new T.Vector2(surface.columns, surface.rows) },
            low: { value: settings.minimumDb },
            high: { value: settings.maximumDb },
          },
          vertexShader,
          fragmentShader,
          side: T.DoubleSide,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        });
        const mesh = new T.Mesh(geometry, material);
        mesh.name = `Pressure: ${surface.id}`;
        mesh.renderOrder = 3;
        this.group.add(mesh);
        patch = { mesh, texture, columns: surface.columns, rows: surface.rows };
        this.patches.set(surface.id, patch);
      } else {
        (patch.texture.image.data as Uint8Array).set(data);
        patch.texture.needsUpdate = true;
      }
      this.position(patch, surface);
      patch.mesh.material.uniforms.low.value = settings.minimumDb;
      patch.mesh.material.uniforms.high.value = settings.maximumDb;
    }
  }
  private position(patch: Patch, p: PressureSurface) {
    const x = p.x - p.width / 2,
      z = p.z - p.depth / 2,
      y = p.height + 0.025;
    const position = patch.mesh.geometry.getAttribute(
      "position",
    ) as T.BufferAttribute;
    position.setXYZ(0, x, y, z);
    position.setXYZ(1, x + p.width, y, z);
    position.setXYZ(2, x, y + p.rise, z + p.depth);
    position.setXYZ(3, x + p.width, y + p.rise, z + p.depth);
    position.needsUpdate = true;
    patch.mesh.geometry.computeBoundingSphere();
  }
  private release(p: Patch) {
    this.group.remove(p.mesh);
    p.texture.dispose();
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }
  dispose() {
    this.patches.forEach((p) => this.release(p));
    this.patches.clear();
    this.group.removeFromParent();
  }
}
