import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore, type CameraPreset } from "../store";
import { DOCK_BAYS, UNIT_X } from "../sim/site";
import { LIVE_SENSOR_UNIT } from "../sim/engine";
import type { Turbine } from "../types";

// Layout follows a combined-cycle plant: gas turbine -> heat recovery steam generator (HRSG) with the
// stack on top -> steam turbine hall -> air-cooled condenser, which West Texas plants use instead of
// water cooling towers.

type V3 = [number, number, number];

const STATUS_COLOR: Record<Turbine["status"], string> = {
  running: "#8f9690",
  watch: "#e0a100",
  tripped: "#c8261e",
  offline: "#5d6360",
};
const STEEL = "#b4bac1";
const CLAD = "#eceef1";
const GRAVEL = "#e4e7ea";
const ASPHALT = "#a3a9b0";
const FLOW = "#2f5d8a";
const GAS = "#c9a227";
const PAD = { x0: -190, x1: 190, z0: -118, z1: 96 };
const ROAD: V3[] = [[270, 0.3, 102], [210, 0.3, 102], [180, 0.3, 90], [140, 0.3, 82]];
const ROAD_KM = 3;
const BUS_Z = -86;
const SWITCHYARD = { x: 152, z: -45 };

// Large assets need the camera further back, and the condenser reads best from the open south-west side.
const CAMERA_OFFSET: Record<string, V3> = {
  acc: [-70, 70, 95],
  datacenter: [60, 70, 120],
  battery: [30, 40, 60],
  switchyard: [55, 60, 85],
  gas: [30, 35, 55],
  dock: [50, 70, 110],
};

const PRESET_VIEWS: Record<CameraPreset, { target: V3; camera: V3 }> = {
  overview: { target: [0, 0, -10], camera: [190, 160, 260] },
  turbines: { target: [0, 10, -40], camera: [30, 95, 120] },
  dock: { target: [150, 0, 80], camera: [215, 75, 175] },
  top: { target: [0, 0, -5], camera: [0.1, 470, 1] },
};

// Focus easing adapted from WareTwin (MIT, github.com/WayneChou-bot/WareTwin).
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const selected = useStore((s) => s.selected);
  const goal = useRef<THREE.Vector3 | null>(null);
  const camGoal = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const p = assetPosition(selected);
    if (!p) return;
    const isTruck = !!selected && (selected.startsWith("TRL-") || selected.startsWith("TNK-"));
    const off = CAMERA_OFFSET[isTruck ? "dock" : selected ?? ""] ?? [40, 42, 64];
    goal.current = new THREE.Vector3(p[0], 6, p[2]);
    camGoal.current = new THREE.Vector3(p[0] + off[0], off[1], p[2] + off[2]);
  }, [selected]);
  const preset = useStore((s) => s.cameraPreset);
  useEffect(() => {
    if (!preset) return;
    const p = PRESET_VIEWS[preset.name];
    goal.current = new THREE.Vector3(...p.target);
    camGoal.current = new THREE.Vector3(...p.camera);
  }, [preset]);
  useFrame(({ camera }, dt) => {
    const c = controls.current;
    if (!c || !goal.current) return;
    const k = 1 - Math.pow(0.002, dt);
    c.target.lerp(goal.current, k);
    if (camGoal.current) camera.position.lerp(camGoal.current, k);
    c.update();
    const camDone = !camGoal.current || camera.position.distanceTo(camGoal.current) < 0.5;
    if (c.target.distanceTo(goal.current) < 0.1 && camDone) { goal.current = null; camGoal.current = null; }
  });
  return null;
}

// Portrait screens see a narrower slice of the site, so pull the starting camera back to keep the whole plant in view.
function FitToScreen() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const back = aspect < 1 ? 2.1 : aspect < 1.4 ? 1.35 : 1;
    camera.position.set(190 * back, 160 * back, 260 * back);
    camera.lookAt(0, 0, -10);
    // Only on first layout; after that the user owns the camera.
  }, []);
  return null;
}

function assetPosition(id: string | null): V3 | null {
  if (!id) return null;
  if (id.startsWith("GT-")) return [UNIT_X(Number(id.slice(3)) - 1), 0, -42];
  if (id === "datacenter") return [0, 0, 62];
  if (id === "acc") return [-161, 14, -55];
  if (id === "switchyard") return [SWITCHYARD.x, 0, SWITCHYARD.z];
  if (id === "gas") return [118, 0, -34];
  if (id === "battery") return [-150, 0, 32];
  if (id.startsWith("TRL-") || id.startsWith("TNK-")) {
    const plant = useStore.getState().plant;
    const d = plant.deliveries.find((x) => x.shipmentId === id);
    // Follow the crew once the parts are moving; otherwise look at the truck's bay.
    if (d && d.status !== "delivered") return [d.pos[0], 0, d.pos[1]];
    const i = Math.max(0, plant.shipments.findIndex((x) => x.id === id));
    const bay = DOCK_BAYS[i % DOCK_BAYS.length];
    return [bay[0], 0, bay[1]];
  }
  return null;
}

function Box({ p, s, c, cast = false, rough = 0.75, metal = 0.1 }: { p: V3; s: V3; c: string; cast?: boolean; rough?: number; metal?: number }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} />
    </mesh>
  );
}

type BoxSpec = { p: V3; s: V3; c: string };
type BeamSpec = { a: V3; b: V3; r: number; c: string };
type BallSpec = { p: V3; r: number; c: string };

function paint(g: THREE.BufferGeometry, hex: string) {
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

// Static parts that never change are merged into one mesh, with their colors stored per vertex.
// That turns hundreds of draw calls into a handful.
function buildMerged(boxes: BoxSpec[] = [], beams: BeamSpec[] = [], balls: BallSpec[] = []) {
  const parts: THREE.BufferGeometry[] = [];
  for (const b of boxes) parts.push(paint(new THREE.BoxGeometry(...b.s).translate(...b.p), b.c));
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of beams) {
    const a = new THREE.Vector3(...b.a), e = new THREE.Vector3(...b.b);
    const dir = e.clone().sub(a);
    const g = new THREE.CylinderGeometry(b.r, b.r, dir.length(), b.r > 1 ? 18 : 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()));
    const mid = a.add(e).multiplyScalar(0.5);
    parts.push(paint(g.translate(mid.x, mid.y, mid.z), b.c));
  }
  for (const b of balls) parts.push(paint(new THREE.SphereGeometry(b.r, 16, 12).translate(...b.p), b.c));
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged ?? new THREE.BufferGeometry();
}

function Merged({ boxes, beams, balls, cast = false, rough = 0.7, metal = 0.12 }: {
  boxes?: BoxSpec[]; beams?: BeamSpec[]; balls?: BallSpec[]; cast?: boolean; rough?: number; metal?: number;
}) {
  const geo = useMemo(() => buildMerged(boxes, beams, balls), [boxes, beams, balls]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} castShadow={cast} receiveShadow>
      <meshStandardMaterial vertexColors roughness={rough} metalness={metal} />
    </mesh>
  );
}

function Site() {
  const w = PAD.x1 - PAD.x0, d = PAD.z1 - PAD.z0;
  const cx = (PAD.x0 + PAD.x1) / 2, cz = (PAD.z0 + PAD.z1) / 2;
  const fence: V3[] = [
    [PAD.x0 - 12, 1.6, PAD.z0 - 12], [PAD.x1 + 12, 1.6, PAD.z0 - 12], [PAD.x1 + 12, 1.6, PAD.z1 + 12],
    [PAD.x0 - 12, 1.6, PAD.z1 + 12], [PAD.x0 - 12, 1.6, PAD.z0 - 12],
  ];
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[1100, 900]} />
        <meshStandardMaterial color="#d3d7db" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0.05, cz]} receiveShadow>
        <planeGeometry args={[w + 22, d + 22]} />
        <meshStandardMaterial color={ASPHALT} roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0.1, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={GRAVEL} roughness={1} />
      </mesh>
      <Line points={fence} color="#6b6862" lineWidth={1.2} />
    </>
  );
}

function BeaconLight({ position }: { position: V3 }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.color.setRGB(clock.elapsedTime % 2 < 0.25 ? 1 : 0.25, 0.05, 0.03);
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.55, 8, 8]} />
      <meshBasicMaterial ref={mat} toneMapped={false} />
    </mesh>
  );
}

// A press that travels further than this is a camera drag, not a pick. Fingers wobble more than a mouse.
const pressStart = { x: 0, y: 0 };
// Labels render in their own React root, so a native capture listener is the one place that sees every press.
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => { pressStart.x = e.clientX; pressStart.y = e.clientY; }, { capture: true, passive: true });
}
function isTap(e: { clientX: number; clientY: number; pointerType?: string }) {
  const tolerance = e.pointerType === "touch" || e.pointerType === "pen" ? 14 : 6;
  return Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) <= tolerance;
}

function Selectable({ id, children }: { id: string; children: React.ReactNode }) {
  const select = useStore((s) => s.select);
  return (
    <group
      onClick={(e) => { e.stopPropagation(); if (isTap(e.nativeEvent as PointerEvent)) select(id); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = ""; }}
    >
      {children}
    </group>
  );
}

function Label({ id, className = "", children }: { id: string; className?: string; children: React.ReactNode }) {
  const select = useStore((s) => s.select);
  return (
    <button
      type="button"
      className={`tag tag-btn ${className}`}
      // The canvas listens on the same container, so keep label clicks from reading as "clicked empty ground".
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (isTap(e.nativeEvent as PointerEvent)) select(id); }}
    >
      {children}
    </button>
  );
}

const TURBINE_BOXES: BoxSpec[] = [
  { p: [0, 3, -72], s: [7, 6, 9], c: "#8b918d" },
  { p: [0, 13, -60], s: [10, 9, 8], c: STEEL },
  { p: [-4, 4.3, -63], s: [0.6, 8.6, 0.6], c: "#5c625e" },
  { p: [4, 4.3, -63], s: [0.6, 8.6, 0.6], c: "#5c625e" },
  { p: [0, 7, -56], s: [4, 4, 3], c: STEEL },
  { p: [0, 4, -48], s: [8, 8, 14], c: "#c3c6bf" },
  { p: [0, 6, -38], s: [7, 8, 6], c: "#9da39e" },
  { p: [0, 10, -23], s: [11, 20, 24], c: CLAD },
  { p: [0, 20.3, -23], s: [11.4, 0.6, 24.4], c: "#a9aea8" },
  { p: [0, 33, -9], s: [5.6, 0.5, 5.6], c: "#5c625e" },
  { p: [8, 2.6, -74], s: [5, 5.2, 4.5], c: "#6f7672" },
];
const TURBINE_BEAMS: BeamSpec[] = [{ a: [0, 0, -9], b: [0, 36, -9], r: 2.35, c: "#9aa1a9" }];

function TurbineUnit({ tb, index, selected }: { tb: Turbine; index: number; selected: boolean }) {
  const x = UNIT_X(index);
  const color = STATUS_COLOR[tb.status];
  const alarm = tb.status === "watch" || tb.status === "tripped";
  const plume = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!plume.current) return;
    plume.current.visible = tb.status === "running" || tb.status === "watch";
    plume.current.children.forEach((m, i) => {
      const k = (clock.elapsedTime * 0.3 + i / 3) % 1;
      m.position.y = 38 + k * 16;
      m.scale.setScalar(1 + k * 2.6);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.2 * (1 - k) * (tb.outputMw / tb.ratedMw);
    });
  });
  return (
    <Selectable id={tb.id}>
      <group position={[x, 0, 0]}>
        {/* gas turbine enclosure with status band */}
        <Merged boxes={TURBINE_BOXES} beams={TURBINE_BEAMS} cast />
        <mesh position={[0, 8.15, -48]}>
          <boxGeometry args={[8.1, 0.35, 14.1]} />
          <meshStandardMaterial color={color} emissive={alarm ? color : "#000"} emissiveIntensity={alarm ? 1.5 : 0} toneMapped={!alarm} />
        </mesh>
        <BeaconLight position={[0, 36.6, -9]} />
        <group ref={plume} position={[0, 0, -9]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[2.2, 10, 10]} />
              <meshStandardMaterial color="#ece7df" transparent opacity={0.15} depthWrite={false} />
            </mesh>
          ))}
        </group>
        {selected && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.2, -42]}>
            <ringGeometry args={[19, 20.5, 56]} />
            <meshBasicMaterial color={FLOW} />
          </mesh>
        )}
        <Html position={[0, 44, -9]} center distanceFactor={160} zIndexRange={[10, 0]}>
          <Label id={tb.id} className={`tag-${tb.status}`}>
            <strong>{tb.id}</strong>
            <span>{tb.status === "tripped" || tb.status === "offline" ? tb.status : `${tb.outputMw.toFixed(0)} MW`}</span>
            {tb.id === LIVE_SENSOR_UNIT && <em className={`tag-live ${tb.sensors.source === "live" ? "is-on" : ""}`}>{tb.sensors.source === "live" ? "live sensors" : "sensors offline"}</em>}
          </Label>
        </Html>
      </group>
    </Selectable>
  );
}

// Ribbed look for finned tube bundles and the wind wall, drawn once into a small canvas.
function useStripeTexture(base: string, line: string, rx: number, ry: number) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 8;
    const g = c.getContext("2d")!;
    g.fillStyle = base; g.fillRect(0, 0, 64, 8);
    g.fillStyle = line;
    for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 2, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [base, line, rx, ry]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// Air-cooled condenser, after a standard A-frame design: axial fans at deck level push air up through
// inclined finned tube bundles; steam enters along the apex header and condenses on the way down.
const ACC = {
  streets: [-172, -161, -150],
  width: 10,
  z0: -84,
  z1: -26,
  deck: 18,
  apex: 29,
  fansPerStreet: 6,
};

function accSpecs() {
  const { streets, width, z0, z1, deck, apex } = ACC;
  const len = z1 - z0, zc = (z0 + z1) / 2, half = width / 2;
  const xMin = streets[0] - half - 0.5, xMax = streets[streets.length - 1] + half + 0.5;
  const colX = [xMin, ...streets.slice(1).map((x) => x - half - 0.5), xMax];
  const colZ = [z0, z0 + len * 0.25, z0 + len * 0.5, z0 + len * 0.75, z1];
  const steel = "#7a807c", beam = "#8a908b", white = "#e6e6e1", cond = "#b8bdb8";
  const frameBoxes: BoxSpec[] = [];
  const frameBeams: BeamSpec[] = [];
  for (const x of colX) for (const z of colZ) frameBoxes.push({ p: [x, deck / 2, z], s: [0.9, deck, 0.9], c: steel });
  for (const x of colX) frameBoxes.push({ p: [x, deck - 0.3, zc], s: [0.8, 0.8, len + 1], c: beam });
  for (const z of colZ) frameBoxes.push({ p: [(xMin + xMax) / 2, deck - 0.3, z], s: [xMax - xMin, 0.8, 0.8], c: beam });
  const brace = (a: V3, b: V3) => frameBeams.push({ a, b, r: 0.18, c: steel });
  for (let i = 0; i < colZ.length - 1; i++) for (const x of [xMin, xMax]) {
    brace([x, 0.5, colZ[i]], [x, deck - 1, colZ[i + 1]]); brace([x, deck - 1, colZ[i]], [x, 0.5, colZ[i + 1]]);
  }
  for (let i = 0; i < colX.length - 1; i++) for (const z of [z0, z1]) {
    brace([colX[i], 0.5, z], [colX[i + 1], deck - 1, z]); brace([colX[i], deck - 1, z], [colX[i + 1], 0.5, z]);
  }
  const top = apex + 0.6;
  const pipeBeams: BeamSpec[] = [
    { a: [-136, 14, -58], b: [-140, 14, -58], r: 2.4, c: white },
    { a: [-140, 14, -58], b: [-140, 14, -90], r: 2.4, c: white },
    { a: [-140, 14, -90], b: [-140, top, -90], r: 2.4, c: white },
    { a: [-140, top, -90], b: [streets[0], top, -90], r: 2, c: white },
  ];
  const pipeBalls: BallSpec[] = [
    { p: [-140, 14, -58], r: 2.5, c: white }, { p: [-140, 14, -90], r: 2.5, c: white }, { p: [-140, top, -90], r: 2.5, c: white },
  ];
  for (const x of streets) {
    pipeBalls.push({ p: [x, top, -90], r: 2.08, c: white });
    pipeBeams.push(
      { a: [x, top, -90], b: [x, top, z0 - 6], r: 1.6, c: white },
      { a: [x, top, z0 - 6], b: [x, top, z1], r: 1.3, c: white },
      { a: [x - half + 0.4, deck + 0.4, z0], b: [x - half + 0.4, deck + 0.4, z1], r: 0.35, c: cond },
      { a: [x + half - 0.4, deck + 0.4, z0], b: [x + half - 0.4, deck + 0.4, z1], r: 0.35, c: cond },
    );
  }
  return { frameBoxes, frameBeams, pipeBeams, pipeBalls };
}
const ACC_SPECS = accSpecs();

function AirCooledCondenser() {
  const fans = useRef<THREE.InstancedMesh>(null);
  const angle = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const finTex = useStripeTexture("#5d6460", "#3f4542", 24, 1);
  const wallTex = useStripeTexture("#dcdcd6", "#c9cac3", 40, 1);
  const { streets, width, z0, z1, deck, apex, fansPerStreet } = ACC;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const fanPitch = len / fansPerStreet;
  const fanCount = streets.length * fansPerStreet;
  const xMin = streets[0] - width / 2 - 0.5, xMax = streets[streets.length - 1] + width / 2 + 0.5;
  const half = width / 2;
  const tilt = Math.atan2(apex - deck, half);
  const slant = Math.hypot(apex - deck, half);

  useFrame((_, dt) => {
    if (!fans.current) return;
    angle.current += dt * (0.6 + 5 * (useStore.getState().plant.outputMw / 2700));
    let i = 0;
    for (const x of streets) {
      for (let k = 0; k < fansPerStreet; k++) {
        dummy.position.set(x, deck - 0.6, z0 + fanPitch * (k + 0.5));
        dummy.rotation.set(0, angle.current + i * 0.7, 0);
        dummy.updateMatrix();
        fans.current.setMatrixAt(i++, dummy.matrix);
      }
    }
    fans.current.instanceMatrix.needsUpdate = true;
  });

  const wallH = apex + 1 - deck;
  const wallY = deck + wallH / 2;
  const shrouds = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!shrouds.current) return;
    const o = new THREE.Object3D();
    let i = 0;
    for (const x of streets) for (let k = 0; k < fansPerStreet; k++) {
      o.position.set(x, deck - 0.6, z0 + fanPitch * (k + 0.5));
      o.updateMatrix();
      shrouds.current.setMatrixAt(i++, o.matrix);
    }
    shrouds.current.instanceMatrix.needsUpdate = true;
  }, [streets, fansPerStreet, deck, z0, fanPitch]);

  return (
    <Selectable id="acc">
    <group>
      {/* support columns, deck beams and cross bracing */}
      <Merged boxes={ACC_SPECS.frameBoxes} beams={ACC_SPECS.frameBeams} cast />
      <instancedMesh ref={shrouds} args={[undefined, undefined, fanCount]}>
        <cylinderGeometry args={[4.3, 4.3, 1.6, 28, 1, true]} />
        <meshStandardMaterial color="#9ca29d" side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={fans} args={[undefined, undefined, fanCount]}>
        <boxGeometry args={[7.8, 0.15, 0.8]} />
        <meshStandardMaterial color="#4f5552" />
      </instancedMesh>
      {/* A-frame tube bundles */}
      {streets.map((x) => [-1, 1].map((side) => (
        <mesh
          key={`${x}${side}`}
          position={[x + (side * half) / 2, (deck + apex) / 2, zc]}
          rotation={[0, 0, side * (Math.PI / 2 - tilt)]}
          receiveShadow
        >
          <boxGeometry args={[0.5, slant, len]} />
          <meshStandardMaterial map={finTex} roughness={0.85} metalness={0.25} />
        </mesh>
      )))}
      {/* steam duct, manifold, apex headers and condensate headers */}
      <Merged beams={ACC_SPECS.pipeBeams} balls={ACC_SPECS.pipeBalls} cast rough={0.45} metal={0.15} />
      {/* wind wall around the bundles */}
      {[
        { p: [xMin, wallY, zc] as V3, s: [0.4, wallH, len + 0.8] as V3 },
        { p: [xMax, wallY, zc] as V3, s: [0.4, wallH, len + 0.8] as V3 },
        { p: [(xMin + xMax) / 2, wallY, z1] as V3, s: [xMax - xMin, wallH, 0.4] as V3 },
        { p: [(xMin + xMax) / 2, wallY, z0] as V3, s: [xMax - xMin, wallH, 0.4] as V3 },
      ].map((w, i) => (
        <mesh key={i} position={w.p} castShadow receiveShadow>
          <boxGeometry args={w.s} />
          <meshStandardMaterial map={wallTex} roughness={0.7} />
        </mesh>
      ))}
      <Html position={[(xMin + xMax) / 2, apex + 8, zc]} center zIndexRange={[10, 0]}>
        <Label id="acc" className="tag-muted"><strong>Air-cooled condenser</strong></Label>
      </Html>
    </group>
    </Selectable>
  );
}

function SteamCycle() {
  return (
    <group>
      {/* steam turbine hall */}
      <Box p={[-126, 11, -44]} s={[22, 22, 40]} c={CLAD} cast />
      <Box p={[-126, 22.4, -44]} s={[22.4, 0.8, 40.4]} c="#a9aea8" />
      <AirCooledCondenser />
    </group>
  );
}

const GAS_BOXES: BoxSpec[] = [
  { p: [118, 2, -34], s: [12, 4, 8], c: "#d5d1c4" },
  { p: [110, 3, -30], s: [1.2, 6, 1.2], c: GAS },
  { p: [114, 3, -30], s: [1.2, 6, 1.2], c: GAS },
];

function GasSupply() {
  return (
    <Selectable id="gas">
    <group>
      <mesh position={[0, 1, -38]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.9, 0.9, 220, 12]} />
        <meshStandardMaterial color={GAS} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* metering station where the pipeline enters */}
      <Merged boxes={GAS_BOXES} />
      <Html position={[118, 9, -34]} center zIndexRange={[10, 0]}>
        <Label id="gas" className="tag-muted"><strong>Gas metering</strong></Label>
      </Html>
    </group>
    </Selectable>
  );
}

function switchyardSpecs(): { boxes: BoxSpec[]; beams: BeamSpec[] } {
  const { x, z } = SWITCHYARD;
  const steel = "#7a807c";
  const boxes: BoxSpec[] = [];
  for (const dx of [-14, 0, 14]) for (const dz of [-22, -2, 18]) {
    const gx = x + dx, gz = z + dz;
    boxes.push(
      { p: [gx - 4, 6, gz], s: [0.5, 12, 0.5], c: steel },
      { p: [gx + 4, 6, gz], s: [0.5, 12, 0.5], c: steel },
      { p: [gx, 12, gz], s: [9, 0.6, 0.6], c: steel },
      { p: [gx, 1.6, gz + 5], s: [2, 3.2, 1.6], c: "#9aa09b" },
    );
  }
  // transmission tower leaving the site
  const tx = x + 40;
  boxes.push({ p: [tx, 26, z], s: [16, 0.6, 0.6], c: steel }, { p: [tx, 20, z], s: [12, 0.6, 0.6], c: steel });
  const beams: BeamSpec[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ({
    a: [tx + a * 2.6, 0, z + b * 2.6] as V3, b: [tx + a * 0.6, 30, z + b * 0.6] as V3, r: 0.3, c: steel,
  }));
  return { boxes, beams };
}
const SWITCHYARD_SPECS = switchyardSpecs();

function Switchyard() {
  const { x, z } = SWITCHYARD;
  const fence: V3[] = [[x - 26, 1.2, z - 34], [x + 26, 1.2, z - 34], [x + 26, 1.2, z + 34], [x - 26, 1.2, z + 34], [x - 26, 1.2, z - 34]];
  return (
    <Selectable id="switchyard">
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[x, 0.15, z]} receiveShadow>
        <planeGeometry args={[52, 68]} />
        <meshStandardMaterial color="#d8dbdf" roughness={1} />
      </mesh>
      <Line points={fence} color="#6b6862" lineWidth={1} />
      <Merged boxes={SWITCHYARD_SPECS.boxes} beams={SWITCHYARD_SPECS.beams} cast />
      <Html position={[x, 18, z]} center zIndexRange={[10, 0]}>
        <Label id="switchyard" className="tag-muted"><strong>Switchyard</strong></Label>
      </Html>
    </group>
    </Selectable>
  );
}

const UTILITY_BOXES: BoxSpec[] = [
  // lube oil fin-fan coolers
  ...Array.from({ length: 5 }, (_, i): BoxSpec[] => [
    { p: [30 + i * 9, 3, -104], s: [8, 2, 7], c: "#a3a8a3" },
    { p: [30 + i * 9 - 3.4, 1, -107], s: [0.4, 2, 0.4], c: "#5c625e" },
    { p: [30 + i * 9 + 3.4, 1, -101], s: [0.4, 2, 0.4], c: "#5c625e" },
    { p: [30 + i * 9, 4.05, -104], s: [5.2, 0.1, 5.2], c: "#5f6561" },
  ]).flat(),
  // admin and control building
  { p: [-120, 4, 72], s: [30, 8, 16], c: "#d8d5cc" },
];

function Utilities() {
  return (
    <group>
      {[[100, 18], [116, 18]].map(([x, z], i) => (
        <mesh key={i} position={[x, 7, z]} castShadow receiveShadow>
          <cylinderGeometry args={[6.5, 6.5, 14, 28]} />
          <meshStandardMaterial color="#eeeee9" roughness={0.6} />
        </mesh>
      ))}
      <Merged boxes={UTILITY_BOXES} />
    </group>
  );
}

function FlowLine({ points, mw, max }: { points: V3[]; mw: number; max: number }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * (mw / max) * 30;
  });
  const active = mw > 1;
  return (
    <Line ref={ref as never} points={points} color={active ? FLOW : "#7b807c"} lineWidth={active ? 2.6 : 1.2} dashed dashSize={3} gapSize={active ? 2 : 0} />
  );
}

// Line geometry is rebuilt whenever its points array changes identity, so these stay module constants.
const UNIT_LINES: V3[][] = Array.from({ length: 8 }, (_, i) => [[UNIT_X(i) + 8, 7, -76], [UNIT_X(i) + 8, 9, BUS_Z]]);
const BUS_LINE: V3[] = [[UNIT_X(0) + 8, 9, BUS_Z], [SWITCHYARD.x - 14, 9, BUS_Z], [SWITCHYARD.x - 14, 9, SWITCHYARD.z - 34]];
const DC_LINE: V3[] = [[SWITCHYARD.x - 20, 9, SWITCHYARD.z + 34], [SWITCHYARD.x - 20, 9, 60], [76, 9, 60]];
const BATTERY_LINE: V3[] = [[-150, 7, 40], [-150, 9, 60], [-76, 9, 60]];
const PYLONS: BoxSpec[] = [-90, -30, 30, 90].map((x) => ({ p: [x + 8, 4.5, BUS_Z], s: [0.6, 9, 0.6], c: "#5c625e" }));

function PowerFlow() {
  const turbines = useStore((s) => s.plant.turbines);
  const battery = useStore((s) => s.plant.battery);
  const demand = useStore((s) => s.plant.demandMw);
  const output = useStore((s) => s.plant.outputMw);
  return (
    <group>
      {turbines.map((tb, i) => (
        <FlowLine key={tb.id} points={UNIT_LINES[i]} mw={tb.outputMw} max={335} />
      ))}
      <FlowLine points={BUS_LINE} mw={output} max={2700} />
      <FlowLine points={DC_LINE} mw={demand} max={2700} />
      <FlowLine points={BATTERY_LINE} mw={Math.abs(battery.powerMw)} max={400} />
      <Merged boxes={PYLONS} />
    </group>
  );
}

const DC_BOXES: BoxSpec[] = [
  { p: [0, 8, 62], s: [150, 16, 32], c: "#f1f2f4" },
  ...[-50, -20, 10, 40].map((x): BoxSpec => ({ p: [x, 17, 66], s: [10, 2, 8], c: "#a7aba5" })),
];

function DataCenter() {
  const demand = useStore((s) => s.plant.demandMw);
  const racks = useRef<THREE.InstancedMesh>(null);
  const count = 60;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!racks.current) return;
    for (let i = 0; i < count; i++) {
      dummy.position.set(-70 + (i % 30) * 4.8, 4 + Math.floor(i / 30) * 5, 45.9);
      dummy.updateMatrix();
      racks.current.setMatrixAt(i, dummy.matrix);
    }
    racks.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);
  const glow = Math.min(1.8, 0.3 + (demand - 1800) / 600);
  return (
    <Selectable id="datacenter">
      <group>
        <Merged boxes={DC_BOXES} cast rough={0.8} />
        <instancedMesh ref={racks} args={[undefined, undefined, count]}>
          <boxGeometry args={[3.6, 0.5, 0.2]} />
          <meshStandardMaterial color="#9fc3e6" emissive="#6fa8dc" emissiveIntensity={glow} toneMapped={false} />
        </instancedMesh>
        <Html position={[0, 24, 62]} center distanceFactor={170} zIndexRange={[10, 0]}>
          <Label id="datacenter" className="tag-dc">
            <strong>AI data center</strong>
            <span>{demand.toFixed(0)} MW load</span>
          </Label>
        </Html>
      </group>
    </Selectable>
  );
}

function BatteryYard() {
  const battery = useStore((s) => s.plant.battery);
  const discharging = battery.powerMw > 5;
  return (
    <Selectable id="battery">
      <group position={[-150, 0, 26]}>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[(i % 4) * 7.5 - 11, 1.6, Math.floor(i / 4) * 5 - 5]}>
            <boxGeometry args={[6, 3.2, 2.6]} />
            <meshStandardMaterial
              color={i / 12 < battery.socPct / 100 ? "#dfe1dc" : "#8d928e"}
              emissive={discharging ? FLOW : "#000"}
              emissiveIntensity={discharging ? 0.35 : 0}
            />
          </mesh>
        ))}
        <Html position={[0, 10, 0]} center distanceFactor={150} zIndexRange={[10, 0]}>
          <Label id="battery">
            <strong>Battery</strong>
            <span>{battery.socPct.toFixed(0)}%{discharging ? `, out ${battery.powerMw.toFixed(0)} MW` : ""}</span>
          </Label>
        </Html>
      </group>
    </Selectable>
  );
}

function TruckModel({ tanker }: { tanker: boolean }) {
  return (
    <>
      {tanker ? (
        <mesh position={[0, 2.4, -2]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[1.5, 1.5, 9, 14]} />
          <meshStandardMaterial color="#d9dcd6" metalness={0.4} roughness={0.4} />
        </mesh>
      ) : (
        <Box p={[0, 2.2, -2]} s={[2.6, 3, 9]} c="#e8e6e0" cast />
      )}
      <Box p={[0, 1.8, 4]} s={[2.6, 2.6, 3]} c={FLOW} cast />
    </>
  );
}

// One truck per shipment: on the approach road in its last few kilometres, then parked in its own bay.
function TruckOnSite({ id, index }: { id: string; index: number }) {
  const sh = useStore((s) => s.plant.shipments.find((x) => x.id === id));
  const group = useRef<THREE.Group>(null);
  const curve = useMemo(() => {
    const bay = DOCK_BAYS[index % DOCK_BAYS.length];
    return new THREE.CatmullRomCurve3([...ROAD, [bay[0], 0.3, bay[1] + 10] as V3, [bay[0], 0.3, bay[1]] as V3].map((p) => new THREE.Vector3(...p)));
  }, [index]);
  const onSite = !!sh && sh.remainingKm <= ROAD_KM;
  useFrame(() => {
    const s = useStore.getState().plant.shipments.find((x) => x.id === id);
    if (!group.current || !s) return;
    const u = s.arrived ? 1 : Math.min(1, Math.max(0, 1 - s.remainingKm / ROAD_KM));
    const p = curve.getPointAt(u);
    group.current.position.lerp(p, 0.2);
    if (u < 0.995) {
      const ahead = curve.getPointAt(Math.min(1, u + 0.01));
      group.current.lookAt(ahead.x, p.y, ahead.z);
    }
  });
  if (!sh) return null;
  return (
    <group ref={group} visible={onSite} position={ROAD[0]}>
      <Selectable id={sh.id}>
        <TruckModel tanker={sh.id.startsWith("TNK-")} />
      </Selectable>
    </group>
  );
}

function Dock() {
  const shipments = useStore((s) => s.plant.shipments);
  const onSite = shipments.filter((x) => x.arrived).length;
  const next = shipments.filter((x) => !x.arrived).sort((a, b) => a.remainingKm - b.remainingKm)[0];
  return (
    <>
      <Line points={ROAD} color={ASPHALT} lineWidth={7} />
      <mesh rotation-x={-Math.PI / 2} position={[150, 0.12, 88]} receiveShadow>
        <planeGeometry args={[52, 22]} />
        <meshStandardMaterial color="#c9cdd2" roughness={1} />
      </mesh>
      <Merged boxes={DOCK_BOXES} cast />
      <Html position={[150, 15, 68]} center distanceFactor={110} zIndexRange={[10, 0]}>
        <Label id={next?.id ?? shipments[0].id}>
          <strong>Delivery dock</strong>
          <span>
            {next
              ? next.remainingKm <= ROAD_KM
                ? `${next.id} arriving, ${(next.remainingKm * 1000).toFixed(0)} m out`
                : `${onSite} on site. Next: ${next.id}, ${next.remainingKm.toFixed(0)} km`
              : `${onSite} trucks on site`}
          </span>
        </Label>
      </Html>
      {shipments.map((sh, i) => <TruckOnSite key={sh.id} id={sh.id} index={i} />)}
    </>
  );
}

const DOCK_BOXES: BoxSpec[] = [
  { p: [150, 5, 68], s: [24, 10, 14], c: "#cfcac0" },
  // bay markers
  ...DOCK_BAYS.map(([x, z]): BoxSpec => ({ p: [x, 0.2, z - 6], s: [4, 0.1, 0.5], c: "#e0a100" })),
];

const VEST = "#ff7a1a";

function Worker({ offset, phase }: { offset: [number, number]; phase: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 6 + phase)) * 0.25;
  });
  return (
    <group ref={g} position={[offset[0], 0, offset[1]]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <capsuleGeometry args={[0.45, 1.2, 4, 8]} />
        <meshStandardMaterial color={VEST} />
      </mesh>
      <mesh position={[0, 2.35, 0]}>
        <sphereGeometry args={[0.38, 10, 8]} />
        <meshStandardMaterial color="#f2f2ee" />
      </mesh>
    </group>
  );
}

// A delivery crew walking the service road with the parts; the label carries the live ETA.
function Crew({ shipmentId }: { shipmentId: string }) {
  const d = useStore((s) => s.plant.deliveries.find((x) => x.shipmentId === shipmentId));
  const t = useStore((s) => s.plant.t);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const cur = useStore.getState().plant.deliveries.find((x) => x.shipmentId === shipmentId);
    if (!group.current || !cur) return;
    group.current.position.lerp(new THREE.Vector3(cur.pos[0], 0.2, cur.pos[1]), 0.12);
  });
  // The path array keeps its identity between ticks, so the line is built once per delivery.
  const path = d?.path;
  const done = d?.status === "delivered";
  const remaining = useMemo<V3[] | null>(() => (path && !done ? path.map(([x, z]) => [x, 0.6, z] as V3) : null), [path, done]);
  // Crews stay visible for a minute after delivery so the drop-off is easy to spot.
  if (!d || (d.deliveredT !== null && t - d.deliveredT > 60)) return null;
  const offsets: [number, number][] = [[0, 0], [1.6, 0.9], [-1.4, 1.1], [0.4, -1.5]].slice(0, d.workers) as [number, number][];
  const walking = d.status === "carrying";
  return (
    <>
      {remaining && <Line points={remaining} color={VEST} lineWidth={1.5} dashed dashSize={2} gapSize={2} />}
      <group ref={group} position={[d.pos[0], 0.2, d.pos[1]]}>
        {/* Drawn larger than life so a crew is readable from the default camera. */}
        <group scale={1.8}>
        <Selectable id={d.shipmentId}>
          {offsets.map((o, i) => (walking ? <Worker key={i} offset={o} phase={i * 1.3} /> : (
            <group key={i} position={[o[0], 0, o[1]]}>
              <mesh position={[0, 1.1, 0]}><capsuleGeometry args={[0.45, 1.2, 4, 8]} /><meshStandardMaterial color={VEST} /></mesh>
              <mesh position={[0, 2.35, 0]}><sphereGeometry args={[0.38, 10, 8]} /><meshStandardMaterial color="#f2f2ee" /></mesh>
            </group>
          )))}
          {d.status !== "delivered" && <Box p={[0.2, 1.6, 0.4]} s={[1.6, 1, 1.2]} c="#8a6a3c" />}
        </Selectable>
        </group>
        <Html position={[0, 8, 0]} center distanceFactor={110} zIndexRange={[10, 0]}>
          <Label id={d.shipmentId} className="tag-crew">
            <strong>{d.crew}</strong>
            <span>
              {d.status === "unloading" && `unloading ${d.shipmentId}, ${Math.ceil(d.unloadLeftS)} s`}
              {d.status === "carrying" && `to ${d.toLabel}, ${d.etaMin < 1 ? `${Math.max(1, Math.round(d.etaMin * 60))} s` : `${d.etaMin.toFixed(1)} min`}`}
              {d.status === "delivered" && `delivered to ${d.toLabel}`}
            </span>
          </Label>
        </Html>
      </group>
    </>
  );
}

function Crews() {
  const ids = useStore((s) => s.plant.deliveries.map((d) => d.shipmentId).join(","));
  return <>{ids ? ids.split(",").map((id) => <Crew key={id} shipmentId={id} />) : null}</>;
}

// Neutral engineering backdrop: flat grey, soft room reflections, no sky.
function Studio() {
  const { scene, gl } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color("#dde1e5");
    scene.fog = new THREE.Fog("#dde1e5", 420, 900);
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    return () => { scene.environment = null; scene.fog = null; env.dispose(); pmrem.dispose(); };
  }, [scene, gl]);
  return null;
}

function Scene() {
  const turbines = useStore((s) => s.plant.turbines);
  const selected = useStore((s) => s.selected);
  return (
    <>
      <Studio />
      <hemisphereLight args={["#ffffff", "#c4c9cf", 0.7]} />
      <directionalLight
        position={[-160, 220, -90]} intensity={1.6} color="#ffffff" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-240} shadow-camera-right={240} shadow-camera-top={170} shadow-camera-bottom={-170} shadow-camera-far={600}
      />
      <Site />
      <GasSupply />
      {turbines.map((tb, i) => <TurbineUnit key={tb.id} tb={tb} index={i} selected={selected === tb.id} />)}
      <SteamCycle />
      <Switchyard />
      <Utilities />
      <PowerFlow />
      <DataCenter />
      <BatteryYard />
      <Dock />
      <Crews />
    </>
  );
}

// The scene's motion is slow (fans, plumes, power flow), so 30 fps looks the same and costs half.
// Camera drags still render immediately: the controls request their own frames.
function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [invalidate, fps]);
  return null;
}

export function PlantScene() {
  const controls = useRef<OrbitControlsImpl>(null);
  const select = useStore((s) => s.select);
  // Fixed for the session: changing resolution mid-run reallocates every buffer and stalls for about a second.
  const dpr = Math.min(window.devicePixelRatio, 1.5);
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={dpr}
      frameloop="demand"
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
      camera={{ position: [190, 160, 260], fov: 34, near: 1, far: 1800 }}
      onPointerMissed={(e) => {
        if ((e.target as Element | null)?.closest?.(".tag-btn")) return;
        if (isTap(e as PointerEvent)) select(null);
      }}
    >
      <FrameCap fps={30} />
      <Scene />
      <FitToScreen />
      <OrbitControls ref={controls} target={[0, 0, -10]} maxPolarAngle={Math.PI / 2.2} minDistance={30} maxDistance={620} enableDamping dampingFactor={0.08} />
      <CameraRig controls={controls} />
    </Canvas>
  );
}
