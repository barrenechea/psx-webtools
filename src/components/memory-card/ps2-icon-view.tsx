import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { ICON_TEXTURE_SIZE, type Ps2IconModel } from "@/lib/ps2/ps2-icon";
import {
  PS2_ICON_CAMERA_FOV,
  PS2_ICON_LIGHT_INTENSITY,
  PS2_ICON_SHADOW_CENTER_ALPHA,
  PS2_ICON_SHADOW_SIZE_FACTOR,
  PS2_ICON_SPIN_RAD_PER_SEC,
  ps2IconCameraPosition,
  ps2IconShouldAnimate,
  toPs2IconDisplay,
} from "@/lib/ps2/ps2-icon-render";
import { iconSysBackgroundAlpha } from "@/lib/ps2/ps2-iconsys";
import {
  iconLightingOrBiosDefault,
  loadStockPs2Icon,
  PS2_STOCK_ICON_FILES,
  stockIconFileForSave,
} from "@/lib/ps2/ps2-stock-icon";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";
import { cn } from "@/lib/utils";

void loadStockPs2Icon(PS2_STOCK_ICON_FILES.broken);
void loadStockPs2Icon(PS2_STOCK_ICON_FILES.system);

type Rgba = [number, number, number, number];

const css = (c: Rgba, alpha: number) =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

const ICON_RENDER_SIZE = 128;
let staticRenderer: THREE.WebGLRenderer | null = null;

function getStaticRenderer(): THREE.WebGLRenderer | null {
  if (staticRenderer) return staticRenderer;
  try {
    staticRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    staticRenderer.outputColorSpace = THREE.SRGBColorSpace;
    staticRenderer.setSize(ICON_RENDER_SIZE, ICON_RENDER_SIZE, false);
    return staticRenderer;
  } catch (err) {
    console.error("[ps2-icon-view] renderer initialization failed", err);
    return null;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    staticRenderer?.forceContextLoss();
    staticRenderer?.dispose();
    staticRenderer = null;
  });
}

function createGroundShadow(size: number, y: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(0.5, 64);
  const colors = new Float32Array(geometry.attributes.position.count * 4);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const distance = Math.hypot(positions.getX(i), positions.getY(i));
    const alpha =
      Math.max(0, 1 - distance / 0.5) * PS2_ICON_SHADOW_CENTER_ALPHA;
    colors[i * 4 + 3] = alpha;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(size, size, 1);
  mesh.position.set(0, y, 0);
  return mesh;
}

function buildScene(
  model: Ps2IconModel,
  lighting: Ps2SaveInfo["iconLighting"],
): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  geometry: THREE.BufferGeometry;
  iconPivot: THREE.Group;
  center: THREE.Vector3;
  dispose: () => void;
} {
  const geometry = new THREE.BufferGeometry();
  const source = model.positions[0];
  const positions = new Float32Array(source.length);
  const normals = new Float32Array(model.normals.length);
  for (let i = 0; i < source.length; i += 3) {
    const [px, py, pz] = toPs2IconDisplay(
      source[i],
      source[i + 1],
      source[i + 2],
    );
    positions[i] = px;
    positions[i + 1] = py;
    positions[i + 2] = pz;
    const [nx, ny, nz] = toPs2IconDisplay(
      model.normals[i],
      model.normals[i + 1],
      model.normals[i + 2],
    );
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(model.uvs, 2));
  const colors = new Float32Array(model.vertexCount * 3);
  for (let i = 0; i < model.vertexCount; i++) {
    colors[i * 3] = model.colors[i * 4] / 255;
    colors[i * 3 + 1] = model.colors[i * 4 + 1] / 255;
    colors[i * 3 + 2] = model.colors[i * 4 + 2] / 255;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute("position") as THREE.BufferAttribute,
  );
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);

  const material = new THREE.MeshLambertMaterial();
  material.vertexColors = true;
  let texture: THREE.DataTexture | null = null;
  if (model.texture) {
    texture = new THREE.DataTexture(
      model.texture,
      ICON_TEXTURE_SIZE,
      ICON_TEXTURE_SIZE,
      THREE.RGBAFormat,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    material.map = texture;
  }

  const mesh = new THREE.Mesh(geometry, material);
  const iconPivot = new THREE.Group();
  iconPivot.add(mesh);

  const scene = new THREE.Scene();
  scene.add(iconPivot);

  const shadowSize =
    Math.max(size.x, size.y, size.z, 1e-4) * PS2_ICON_SHADOW_SIZE_FACTOR;
  const shadow = createGroundShadow(shadowSize, -size.y / 2 + 0.001);
  scene.add(shadow);

  const ambient = lighting?.ambient ?? [0.5, 0.5, 0.5];
  scene.add(
    new THREE.AmbientLight(
      new THREE.Color(ambient[0] ?? 0.5, ambient[1] ?? 0.5, ambient[2] ?? 0.5),
      PS2_ICON_LIGHT_INTENSITY,
    ),
  );
  const dirs = lighting?.dirs ?? [];
  const cols = lighting?.cols ?? [];
  for (let i = 0; i < 3; i++) {
    const dir = dirs[i];
    const col = cols[i];
    if (!dir || !col) continue;
    const [lx, ly, lz] = toPs2IconDisplay(dir[0], dir[1], dir[2]);
    const light = new THREE.DirectionalLight(
      new THREE.Color(col[0], col[1], col[2]),
      PS2_ICON_LIGHT_INTENSITY,
    );
    light.position.set(lx, ly, lz);
    scene.add(light);
  }

  const [cx, cy, cz] = ps2IconCameraPosition();
  const camera = new THREE.PerspectiveCamera(
    PS2_ICON_CAMERA_FOV,
    1,
    0.001,
    2000,
  );
  camera.position.set(cx, cy, cz);
  camera.lookAt(0, 0, 0);
  return {
    scene,
    camera,
    geometry,
    iconPivot,
    center,
    dispose: () => {
      texture?.dispose();
      material.dispose();
      geometry.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    },
  };
}

function evaluateTimeline(keys: [number, number][], time: number): number {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (time <= first[0]) return first[1];
  if (time >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const previous = keys[i - 1];
    const next = keys[i];
    if (previous[0] <= time && time < next[0]) {
      const duration = next[0] - previous[0];
      if (duration === 0) return previous[1];
      const alpha = (time - previous[0]) / duration;
      return (1 - alpha) * previous[1] + alpha * next[1];
    }
  }
  return last[1];
}

function applyAnimation(
  model: Ps2IconModel,
  geometry: THREE.BufferGeometry,
  center: THREE.Vector3,
  elapsedSeconds: number,
): void {
  const duration = model.frameLength / 60;
  if (model.frames.length <= 1 || duration <= 0) return;
  const frameTime =
    (Math.floor(((elapsedSeconds * model.animSpeed) % duration) * 60) +
      model.playOffset) %
    model.frameLength;
  const weights = model.frames.map((frame) =>
    evaluateTimeline(frame.keys, frameTime),
  );
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!Number.isFinite(sum) || sum === 0) return;

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const output = position.array as Float32Array;
  output.fill(0);
  for (let frameIndex = 0; frameIndex < model.frames.length; frameIndex++) {
    const source = model.positions[model.frames[frameIndex].shapeId];
    if (!source) continue;
    const weight = weights[frameIndex] / sum;
    for (let i = 0; i < model.vertexCount; i++) {
      const [x, y, z] = toPs2IconDisplay(
        source[i * 3],
        source[i * 3 + 1],
        source[i * 3 + 2],
      );
      output[i * 3] += x * weight;
      output[i * 3 + 1] += y * weight;
      output[i * 3 + 2] += z * weight;
    }
  }
  for (let i = 0; i < model.vertexCount; i++) {
    output[i * 3] -= center.x;
    output[i * 3 + 1] -= center.y;
    output[i * 3 + 2] -= center.z;
  }
  position.needsUpdate = true;
}

interface SharedAnimation {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  model: Ps2IconModel;
  built: ReturnType<typeof buildScene>;
  startedAt: number;
}

const sharedAnimations = new Map<HTMLCanvasElement, SharedAnimation>();
let sharedAnimationRequestId = 0;

function paintIcon(
  renderer: THREE.WebGLRenderer,
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  built: ReturnType<typeof buildScene>,
): void {
  renderer.render(built.scene, built.camera);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
}

function animateSharedIcons(now: number): void {
  const renderer = getStaticRenderer();
  if (!renderer) {
    sharedAnimationRequestId = 0;
    return;
  }
  for (const animation of sharedAnimations.values()) {
    const elapsed = Math.max(0, (now - animation.startedAt) / 1000);
    applyAnimation(
      animation.model,
      animation.built.geometry,
      animation.built.center,
      elapsed,
    );
    animation.built.iconPivot.rotation.y = -elapsed * PS2_ICON_SPIN_RAD_PER_SEC;
    try {
      paintIcon(renderer, animation.context, animation.canvas, animation.built);
    } catch (err) {
      console.error("[ps2-icon-view] render failed", err);
    }
  }
  sharedAnimationRequestId =
    sharedAnimations.size > 0 ? requestAnimationFrame(animateSharedIcons) : 0;
}

function renderStaticIcon(
  canvas: HTMLCanvasElement,
  model: Ps2IconModel,
  lighting: Ps2SaveInfo["iconLighting"],
): void {
  const renderer = getStaticRenderer();
  const context = canvas.getContext("2d");
  if (!renderer || !context) return;
  const built = buildScene(model, lighting);
  try {
    paintIcon(renderer, context, canvas, built);
  } catch (err) {
    console.error("[ps2-icon-view] render failed", err);
  }
  built.dispose();
}

function startSharedIconAnimation(
  canvas: HTMLCanvasElement,
  model: Ps2IconModel,
  lighting: Ps2SaveInfo["iconLighting"],
): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const built = buildScene(model, lighting);
  const animation: SharedAnimation = {
    canvas,
    context,
    model,
    built,
    startedAt: performance.now(),
  };
  sharedAnimations.set(canvas, animation);
  if (sharedAnimationRequestId === 0) {
    sharedAnimationRequestId = requestAnimationFrame(animateSharedIcons);
  }
  return () => {
    if (sharedAnimations.get(canvas) === animation) {
      sharedAnimations.delete(canvas);
    }
    built.dispose();
    if (sharedAnimations.size === 0 && sharedAnimationRequestId !== 0) {
      cancelAnimationFrame(sharedAnimationRequestId);
      sharedAnimationRequestId = 0;
    }
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (sharedAnimationRequestId !== 0) {
      cancelAnimationFrame(sharedAnimationRequestId);
      sharedAnimationRequestId = 0;
    }
    for (const animation of sharedAnimations.values()) {
      animation.built.dispose();
    }
    sharedAnimations.clear();
  });
}

interface Ps2IconViewProps {
  save: Pick<
    Ps2SaveInfo,
    | "name"
    | "viewIcon"
    | "background"
    | "backgroundTransparency"
    | "iconModel"
    | "iconLighting"
  >;
  className?: string;
  animate?: boolean;
}

// The save's 3D icon with its icon.sys lighting and four-corner background.
// On-card icon files win. `_SCE8` / B[IEA]DATA-SYSTEM use ICOBYSYS (PS2
// wordmark). Other missing icons use ICOBFBRK (untextured cube).
export const Ps2IconView: React.FC<Ps2IconViewProps> = ({
  save,
  className,
  animate = false,
}) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const corners: Rgba[] = [0, 1, 2, 3].map(
    (i) => save.background[i] ?? [0, 0, 0, 0],
  );
  const center = [0, 1, 2, 3].map((ch) =>
    Math.round(corners.reduce((sum, c) => sum + c[ch], 0) / 4),
  ) as Rgba;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { iconModel, iconLighting } = save;
  const stockFile = stockIconFileForSave(save);
  const [stockModel, setStockModel] = useState<Ps2IconModel | null>(null);

  useEffect(() => {
    if (iconModel) return;
    let cancelled = false;
    loadStockPs2Icon(stockFile).then((model) => {
      if (!cancelled) setStockModel(model);
    });
    return () => {
      cancelled = true;
    };
  }, [iconModel, stockFile]);

  const model = iconModel ?? stockModel;
  const lighting = iconLightingOrBiosDefault(iconLighting);
  const shouldAnimate =
    !prefersReducedMotion && ps2IconShouldAnimate(animate, model);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = ICON_RENDER_SIZE;
      canvas.height = ICON_RENDER_SIZE;
    }
    if (!canvas || !model) {
      return;
    }
    if (shouldAnimate) {
      return startSharedIconAnimation(canvas, model, lighting);
    }
    renderStaticIcon(canvas, model, lighting);
  }, [model, lighting, shouldAnimate]);

  const backgroundAlpha = iconSysBackgroundAlpha(save.backgroundTransparency);
  const background = `linear-gradient(to top left, ${css(
    corners[3],
    backgroundAlpha,
  )}, transparent, ${css(
    corners[0],
    backgroundAlpha,
  )}), linear-gradient(to top right, ${css(
    corners[2],
    backgroundAlpha,
  )}, transparent, ${css(corners[1], backgroundAlpha)}) ${css(
    center,
    backgroundAlpha,
  )}`;
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ background }}
    >
      <canvas
        key={shouldAnimate ? "animated" : "static"}
        ref={canvasRef}
        className="absolute inset-0 size-full object-contain"
      />
    </div>
  );
};
