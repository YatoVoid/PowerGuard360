import { createContext, useContext, useEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore, type CameraPreset } from "../store";
import { UNIT_X } from "../sim/site";
import { etaText } from "../ui/parts";
import { LIVE_SENSOR_UNIT, SITE_REPLAY_SPEED, WALK_M_PER_S } from "../sim/engine";
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
const BUS_Z = -86;
const SWITCHYARD = { x: 152, z: -45 };

// Large assets need the camera further back, and the condenser reads best from the open south-west side.
// Focus stops far enough out that the asset's label and its surroundings stay in view.
const FOCUS_PULLBACK = 2.6;
const CAMERA_OFFSET: Record<string, V3> = {
  acc: [-70, 70, 95],
  datacenter: [60, 70, 120],
  battery: [30, 40, 60],
  switchyard: [55, 60, 85],
  gas: [30, 35, 55],
  control: [40, 50, 80],
};

const PRESET_VIEWS: Record<CameraPreset, { target: V3; camera: V3 }> = {
  overview: { target: [0, 0, -10], camera: [190, 160, 260] },
  turbines: { target: [0, 10, -40], camera: [30, 95, 120] },
  control: { target: [-120, 0, 60], camera: [-60, 80, 150] },
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
    const off = CAMERA_OFFSET[selected ?? ""] ?? [40, 42, 64];
    goal.current = new THREE.Vector3(p[0], 6, p[2]);
    camGoal.current = new THREE.Vector3(p[0] + off[0] * FOCUS_PULLBACK, off[1] * FOCUS_PULLBACK, p[2] + off[2] * FOCUS_PULLBACK);
  }, [selected]);
  // Any drag or scroll hands the camera back to the user, so the fly-in never fights a zoom.
  const el = useThree((s) => s.events.connected as HTMLElement | null);
  useEffect(() => {
    if (!el) return;
    const stop = () => { goal.current = null; camGoal.current = null; };
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onMove = (e: PointerEvent) => {
      if (down && e.buttons && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { stop(); down = null; }
    };
    const onUp = () => { down = null; };
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [el]);
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
  if (id === "control") return [-120, 0, 66];
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
  const recommended = useStore((s) => s.plant.recommendations.some((r) => r.asset === tb.id && r.status === "pending"));
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
        <Tag position={[0, 44, -9]} center distanceFactor={160} zIndexRange={[10, 0]}>
          <Label id={tb.id} className={`tag-${recommended && tb.status === "running" ? "watch" : tb.status}`}>
            <strong>{tb.id}</strong>
            <span>{tb.status === "tripped" || tb.status === "offline" ? tb.status : `${tb.outputMw.toFixed(0)} MW`}</span>
            {recommended && <em className="tag-rec">needs decision</em>}
            {tb.id === LIVE_SENSOR_UNIT && <em className={`tag-live ${tb.source === "live" ? "is-on" : ""}`}>{tb.source === "live" ? "live sensors" : "sensors offline"}</em>}
          </Label>
        </Tag>
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
      <Tag position={[(xMin + xMax) / 2, apex + 8, zc]} center zIndexRange={[10, 0]}>
        <Label id="acc" className="tag-muted"><strong>Air-cooled condenser</strong></Label>
      </Tag>
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
  const gas = useStore((s) => s.plant.gas);
  const recommended = useStore((s) => s.plant.recommendations.some((r) => r.asset === "gas" && r.status === "pending"));
  const tone = gas.connected && gas.level === "poor" ? "tag-tripped" : recommended || (gas.connected && gas.level === "reduced") ? "tag-watch" : "tag-muted";
  return (
    <Selectable id="gas">
    <group>
      <mesh position={[0, 1, -38]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.9, 0.9, 220, 12]} />
        <meshStandardMaterial color={GAS} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* metering station where the pipeline enters */}
      <Merged boxes={GAS_BOXES} />
      <Tag position={[118, 9, -34]} center zIndexRange={[10, 0]}>
        <Label id="gas" className={tone}>
          <strong>Gas metering</strong>
          {gas.connected && gas.qualityPct !== null && <em className="tag-live is-on">{gas.level === "poor" ? `air ${gas.qualityPct}%, possible leak` : `air quality ${gas.qualityPct}%`}</em>}
          {recommended && gas.level !== "poor" && <em className="tag-rec">needs decision</em>}
        </Label>
      </Tag>
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
      <Tag position={[x, 18, z]} center zIndexRange={[10, 0]}>
        <Label id="switchyard" className="tag-muted"><strong>Switchyard</strong></Label>
      </Tag>
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
        <Tag position={[0, 24, 62]} center distanceFactor={170} zIndexRange={[10, 0]}>
          <Label id="datacenter" className="tag-dc">
            <strong>AI data center</strong>
            <span>{demand.toFixed(0)} MW load</span>
          </Label>
        </Tag>
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
        <Tag position={[0, 10, 0]} center distanceFactor={150} zIndexRange={[10, 0]}>
          <Label id="battery">
            <strong>Battery</strong>
            <span>{battery.socPct.toFixed(0)}%{discharging ? `, out ${battery.powerMw.toFixed(0)} MW` : ""}</span>
          </Label>
        </Tag>
      </group>
    </Selectable>
  );
}

const VEST = "#ff7a1a";
const PHONE_VEST = "#2f6fde";
const PRIORITY_COLOR = { P1: "#d0312d", P2: "#d99a00", P3: "#2f6fde" } as const;

function Person({ vest, walking, phase }: { vest: string; walking: boolean; phase: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = walking ? Math.abs(Math.sin(clock.elapsedTime * 6 + phase)) * 0.25 : 0;
  });
  return (
    <group ref={g}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <capsuleGeometry args={[0.45, 1.2, 4, 8]} />
        <meshStandardMaterial color={vest} />
      </mesh>
      <mesh position={[0, 2.35, 0]}>
        <sphereGeometry args={[0.38, 10, 8]} />
        <meshStandardMaterial color="#e9d3bf" />
      </mesh>
      {/* hard hat */}
      <mesh position={[0, 2.6, 0]}>
        <sphereGeometry args={[0.44, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f6f6f2" />
      </mesh>
    </group>
  );
}

// An engineer on site. Position comes from the plant state; the phone engineer's moves come from their GPS.
function EngineerFigure({ id }: { id: string }) {
  const e = useStore((s) => s.plant.engineers.find((x) => x.id === id));
  const r = useStore((s) => s.plant.requests.find((x) => x.engineerId === id && x.status !== "resolved" && x.status !== "cancelled"));
  const group = useRef<THREE.Group>(null);
  // The server moves people once a second; walking at a steady pace between updates hides the steps.
  useFrame((_, dt) => {
    const cur = useStore.getState().plant.engineers.find((x) => x.id === id);
    const g = group.current;
    if (!g || !cur) return;
    const dx = cur.pos[0] - g.position.x, dz = cur.pos[1] - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;
    // Teleports (a new job, a reset) snap; otherwise keep pace, catching up if a tick was missed.
    if (dist > WALK_M_PER_S * SITE_REPLAY_SPEED * 6) { g.position.set(cur.pos[0], 0.2, cur.pos[1]); return; }
    const step = Math.min(dist, Math.max(WALK_M_PER_S * SITE_REPLAY_SPEED, dist * 1.5) * Math.min(dt, 0.1));
    g.position.x += (dx / dist) * step;
    g.position.z += (dz / dist) * step;
    const heading = Math.atan2(dx, dz);
    let turn = heading - g.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    g.rotation.y += turn * Math.min(1, dt * 8);
  });
  const path = r?.path;
  const walking = r?.status === "en-route";
  const line = useMemo<V3[] | null>(() => (path && path.length > 1 ? path.map(([x, z]) => [x, 0.6, z] as V3) : null), [path]);
  if (!e) return null;
  const vest = e.kind === "phone" ? PHONE_VEST : VEST;
  const doing = !r ? "available"
    : r.status === "dispatched" ? `sent to ${r.asset}, not accepted yet`
    : r.status === "en-route" ? `to ${r.asset}, ${etaText(r.etaMin)}`
    : r.status === "on-site" ? `at ${r.asset}`
    : `repairing ${r.asset}, ${r.repairLeftS} s`;
  return (
    <>
      {line && (r?.status === "en-route" || r?.status === "dispatched") && (
        <Line points={line} color={vest} lineWidth={1.5} dashed dashSize={2} gapSize={2} />
      )}
      <group ref={group} position={[e.pos[0], 0.2, e.pos[1]]}>
        {/* Drawn larger than life so a person is readable from the default camera. */}
        <group scale={1.9}>
          <Selectable id={r?.asset ?? "control"}>
            <Person vest={vest} walking={!!walking} phase={id.length} />
          </Selectable>
        </group>
        <Tag position={[0, 8, 0]} center distanceFactor={110} zIndexRange={[10, 0]}>
          <Label id={r?.asset ?? "control"} className={`tag-crew ${e.kind === "phone" ? "tag-phone" : ""}`}>
            <strong>{e.name}</strong>
            <span>{doing}</span>
          </Label>
        </Tag>
      </group>
    </>
  );
}

function Engineers() {
  const ids = useStore((s) => s.plant.engineers.map((e) => e.id).join(","));
  return <>{ids.split(",").filter(Boolean).map((id) => <EngineerFigure key={id} id={id} />)}</>;
}

// A pulsing ring on the ground under any asset with an open request, coloured by priority.
function RequestMarker({ id }: { id: string }) {
  const r = useStore((s) => s.plant.requests.find((x) => x.id === id));
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const k = (clock.elapsedTime % 1.6) / 1.6;
    ring.current.scale.setScalar(1 + k * 0.35);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
  });
  if (!r) return null;
  const p = assetPosition(r.asset);
  if (!p) return null;
  const big = r.asset === "acc" || r.asset === "switchyard" || r.asset === "datacenter";
  return (
    <group position={[p[0], 0.4, p[2]]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[big ? 30 : 17, big ? 32 : 18.5, 64]} />
        <meshBasicMaterial color={PRIORITY_COLOR[r.priority]} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function RequestMarkers() {
  const ids = useStore((s) => s.plant.requests.filter((r) => r.status !== "resolved" && r.status !== "cancelled").map((r) => r.id).join(","));
  return <>{ids ? ids.split(",").map((id) => <RequestMarker key={id} id={id} />) : null}</>;
}

function ControlRoom() {
  return (
    <Tag position={[-120, 13, 72]} center zIndexRange={[10, 0]}>
      <Label id="control" className="tag-muted"><strong>Control room</strong></Label>
    </Tag>
  );
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
      <ControlRoom />
      <RequestMarkers />
      <Engineers />
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

// Labels mount into the same element the canvas takes events from. Left to drei's default, a label that
// mounts before the canvas connects its events switches container afterwards, and React then throws on unmount.
const LabelRoot = createContext<RefObject<HTMLDivElement>>({ current: null! });
function Tag(props: ComponentProps<typeof Html>) {
  return <Html portal={useContext(LabelRoot)} {...props} />;
}

export function PlantScene() {
  const root = useRef<HTMLDivElement>(null!);
  const controls = useRef<OrbitControlsImpl>(null);
  const select = useStore((s) => s.select);
  // Fixed for the session: changing resolution mid-run reallocates every buffer and stalls for about a second.
  const dpr = Math.min(window.devicePixelRatio, 1.5);
  return (
    <div ref={root} className="scene-root">
    <LabelRoot.Provider value={root}>
    <Canvas
      eventSource={root}
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
    </LabelRoot.Provider>
    </div>
  );
}
