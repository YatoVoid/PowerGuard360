import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore } from "../store";
import type { Turbine } from "../types";

// Layout follows a combined-cycle plant: gas turbine -> heat recovery steam generator (HRSG) with the
// stack on top -> steam turbine hall -> air-cooled condenser, which West Texas plants use instead of
// water cooling towers.

type V3 = [number, number, number];

const UNIT_X = (i: number) => -84 + i * 24;
const STATUS_COLOR: Record<Turbine["status"], string> = {
  running: "#8f9690",
  watch: "#e0a100",
  tripped: "#c8261e",
  offline: "#5d6360",
};
const STEEL = "#9aa19c";
const CLAD = "#c9ccc6";
const GRAVEL = "#b3ada0";
const ASPHALT = "#4d4b47";
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
  useFrame(({ camera }, dt) => {
    const c = controls.current;
    if (!c || !goal.current) return;
    const k = 1 - Math.pow(0.002, dt);
    c.target.lerp(goal.current, k);
    if (camGoal.current) camera.position.lerp(camGoal.current, k);
    c.update();
    if (c.target.distanceTo(goal.current) < 0.1) { goal.current = null; camGoal.current = null; }
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
  if (id.startsWith("TRL-") || id.startsWith("TNK-")) return [140, 0, 82];
  return null;
}

function Box({ p, s, c, cast = true, rough = 0.75, metal = 0.1 }: { p: V3; s: V3; c: string; cast?: boolean; rough?: number; metal?: number }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={rough} metalness={metal} />
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
        <meshStandardMaterial color="#b98e5e" roughness={1} />
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
        {/* generator, cold end */}
        <Box p={[0, 3, -72]} s={[7, 6, 9]} c="#8b918d" />
        {/* elevated inlet filter house on legs */}
        <Box p={[0, 13, -60]} s={[10, 9, 8]} c={STEEL} />
        <Box p={[-4, 4.3, -63]} s={[0.6, 8.6, 0.6]} c="#5c625e" />
        <Box p={[4, 4.3, -63]} s={[0.6, 8.6, 0.6]} c="#5c625e" />
        <Box p={[0, 7, -56]} s={[4, 4, 3]} c={STEEL} />
        {/* gas turbine enclosure with status band */}
        <Box p={[0, 4, -48]} s={[8, 8, 14]} c="#c3c6bf" rough={0.6} metal={0.15} />
        <mesh position={[0, 8.15, -48]}>
          <boxGeometry args={[8.1, 0.35, 14.1]} />
          <meshStandardMaterial color={color} emissive={alarm ? color : "#000"} emissiveIntensity={alarm ? 1.5 : 0} toneMapped={!alarm} />
        </mesh>
        {/* exhaust diffuser into the HRSG */}
        <Box p={[0, 6, -38]} s={[7, 8, 6]} c="#9da39e" />
        {/* heat recovery steam generator */}
        <Box p={[0, 10, -23]} s={[11, 20, 24]} c={CLAD} rough={0.7} />
        <Box p={[0, 20.3, -23]} s={[11.4, 0.6, 24.4]} c="#a9aea8" />
        {/* stack on the HRSG outlet */}
        <mesh position={[0, 18, -9]} castShadow>
          <cylinderGeometry args={[2.2, 2.5, 36, 18]} />
          <meshStandardMaterial color="#7d837f" roughness={0.5} metalness={0.4} />
        </mesh>
        <Box p={[0, 33, -9]} s={[5.6, 0.5, 5.6]} c="#5c625e" cast={false} />
        <BeaconLight position={[0, 36.6, -9]} />
        <group ref={plume} position={[0, 0, -9]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[2.2, 10, 10]} />
              <meshStandardMaterial color="#ece7df" transparent opacity={0.15} depthWrite={false} />
            </mesh>
          ))}
        </group>
        {/* generator step-up transformer */}
        <Box p={[8, 2.6, -74]} s={[5, 5.2, 4.5]} c="#6f7672" rough={0.6} />
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
          </Label>
        </Html>
      </group>
    </Selectable>
  );
}

// Ribbed look for finned tube bundles and the wind wall, drawn once into a small canvas.
function useStripeTexture(base: string, line: string, repeat: [number, number]) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 8;
    const g = c.getContext("2d")!;
    g.fillStyle = base; g.fillRect(0, 0, 64, 8);
    g.fillStyle = line;
    for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 2, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [base, line, repeat]);
}

function Pipe({ from, to, r, c = "#e6e6e1" }: { from: V3; to: V3; r: number; c?: string }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    return {
      pos: a.clone().add(b).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
      len: dir.length(),
    };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[r, r, len, 20]} />
      <meshStandardMaterial color={c} roughness={0.45} metalness={0.15} />
    </mesh>
  );
}

function Elbow({ at, r, c = "#e6e6e1" }: { at: V3; r: number; c?: string }) {
  return (
    <mesh position={at} castShadow>
      <sphereGeometry args={[r * 1.04, 18, 14]} />
      <meshStandardMaterial color={c} roughness={0.45} metalness={0.15} />
    </mesh>
  );
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

function AirCooledCondenser() {
  const output = useStore((s) => s.plant.outputMw);
  const fans = useRef<THREE.InstancedMesh>(null);
  const angle = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const finTex = useStripeTexture("#5d6460", "#3f4542", [24, 1]);
  const wallTex = useStripeTexture("#dcdcd6", "#c9cac3", [40, 1]);
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
    angle.current += dt * (0.6 + 5 * (output / 2700));
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

  const colX = [xMin, ...streets.slice(1).map((x) => x - width / 2 - 0.5), xMax];
  const colZ = [z0, z0 + len * 0.25, z0 + len * 0.5, z0 + len * 0.75, z1];
  const braces: { a: V3; b: V3 }[] = [];
  for (let i = 0; i < colZ.length - 1; i++) {
    for (const x of [xMin, xMax]) {
      braces.push({ a: [x, 0.5, colZ[i]], b: [x, deck - 1, colZ[i + 1]] }, { a: [x, deck - 1, colZ[i]], b: [x, 0.5, colZ[i + 1]] });
    }
  }
  for (let i = 0; i < colX.length - 1; i++) {
    for (const z of [z0, z1]) {
      braces.push({ a: [colX[i], 0.5, z], b: [colX[i + 1], deck - 1, z] }, { a: [colX[i], deck - 1, z], b: [colX[i + 1], 0.5, z] });
    }
  }
  const wallH = apex + 1 - deck;
  const wallY = deck + wallH / 2;

  return (
    <Selectable id="acc">
    <group>
      {/* support columns and cross bracing */}
      {colX.map((x) => colZ.map((z) => <Box key={`${x}${z}`} p={[x, deck / 2, z]} s={[0.9, deck, 0.9]} c="#7a807c" />))}
      {braces.map((b, i) => <Pipe key={i} from={b.a} to={b.b} r={0.18} c="#7a807c" />)}
      {/* deck beams between fan rows */}
      {colX.map((x) => <Box key={`bx${x}`} p={[x, deck - 0.3, zc]} s={[0.8, 0.8, len + 1]} c="#8a908b" />)}
      {colZ.map((z) => <Box key={`bz${z}`} p={[(xMin + xMax) / 2, deck - 0.3, z]} s={[xMax - xMin, 0.8, 0.8]} c="#8a908b" />)}
      {/* fan shrouds and blades */}
      {streets.map((x) => Array.from({ length: fansPerStreet }, (_, k) => (
        <mesh key={`${x}-${k}`} position={[x, deck - 0.6, z0 + fanPitch * (k + 0.5)]}>
          <cylinderGeometry args={[4.3, 4.3, 1.6, 28, 1, true]} />
          <meshStandardMaterial color="#9ca29d" side={THREE.DoubleSide} />
        </mesh>
      )))}
      <instancedMesh ref={fans} args={[undefined, undefined, fanCount]} castShadow>
        <boxGeometry args={[7.8, 0.15, 0.8]} />
        <meshStandardMaterial color="#4f5552" />
      </instancedMesh>
      {/* A-frame tube bundles, steam header on the apex, condensate headers along the base */}
      {streets.map((x) => (
        <group key={`a${x}`}>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[x + (side * half) / 2, (deck + apex) / 2, zc]}
              rotation={[0, 0, side * (Math.PI / 2 - tilt)]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.5, slant, len]} />
              <meshStandardMaterial map={finTex} roughness={0.85} metalness={0.25} />
            </mesh>
          ))}
          <Pipe from={[x, apex + 0.6, z0 - 6]} to={[x, apex + 0.6, z1]} r={1.3} />
          <Pipe from={[x - half + 0.4, deck + 0.4, z0]} to={[x - half + 0.4, deck + 0.4, z1]} r={0.35} c="#b8bdb8" />
          <Pipe from={[x + half - 0.4, deck + 0.4, z0]} to={[x + half - 0.4, deck + 0.4, z1]} r={0.35} c="#b8bdb8" />
        </group>
      ))}
      {/* wind wall around the bundles */}
      <mesh position={[xMin, wallY, zc]} castShadow receiveShadow>
        <boxGeometry args={[0.4, wallH, len + 0.8]} />
        <meshStandardMaterial map={wallTex} roughness={0.7} />
      </mesh>
      <mesh position={[xMax, wallY, zc]} castShadow receiveShadow>
        <boxGeometry args={[0.4, wallH, len + 0.8]} />
        <meshStandardMaterial map={wallTex} roughness={0.7} />
      </mesh>
      <mesh position={[(xMin + xMax) / 2, wallY, z1]} castShadow receiveShadow>
        <boxGeometry args={[xMax - xMin, wallH, 0.4]} />
        <meshStandardMaterial map={wallTex} roughness={0.7} />
      </mesh>
      <mesh position={[(xMin + xMax) / 2, wallY, z0]} castShadow receiveShadow>
        <boxGeometry args={[xMax - xMin, wallH, 0.4]} />
        <meshStandardMaterial map={wallTex} roughness={0.7} />
      </mesh>
      {/* steam duct: out of the turbine hall, up the riser, across the manifold, into each street header */}
      <Pipe from={[-136, 14, -58]} to={[-140, 14, -58]} r={2.4} />
      <Elbow at={[-140, 14, -58]} r={2.4} />
      <Pipe from={[-140, 14, -58]} to={[-140, 14, -90]} r={2.4} />
      <Elbow at={[-140, 14, -90]} r={2.4} />
      <Pipe from={[-140, 14, -90]} to={[-140, apex + 0.6, -90]} r={2.4} />
      <Elbow at={[-140, apex + 0.6, -90]} r={2.4} />
      <Pipe from={[-140, apex + 0.6, -90]} to={[streets[0], apex + 0.6, -90]} r={2} />
      {streets.map((x) => (
        <group key={`m${x}`}>
          <Elbow at={[x, apex + 0.6, -90]} r={2} />
          <Pipe from={[x, apex + 0.6, -90]} to={[x, apex + 0.6, z0 - 6]} r={1.6} />
        </group>
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
      <Box p={[-126, 11, -44]} s={[22, 22, 40]} c={CLAD} />
      <Box p={[-126, 22.4, -44]} s={[22.4, 0.8, 40.4]} c="#a9aea8" />
      <AirCooledCondenser />
    </group>
  );
}

function GasSupply() {
  return (
    <Selectable id="gas">
    <group>
      <mesh position={[0, 1, -38]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.9, 0.9, 220, 12]} />
        <meshStandardMaterial color={GAS} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* metering station where the pipeline enters */}
      <Box p={[118, 2, -34]} s={[12, 4, 8]} c="#d5d1c4" />
      <Box p={[110, 3, -30]} s={[1.2, 6, 1.2]} c={GAS} />
      <Box p={[114, 3, -30]} s={[1.2, 6, 1.2]} c={GAS} />
      <Html position={[118, 9, -34]} center zIndexRange={[10, 0]}>
        <Label id="gas" className="tag-muted"><strong>Gas metering</strong></Label>
      </Html>
    </group>
    </Selectable>
  );
}

function Gantry({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[-4, 6, 0]} s={[0.5, 12, 0.5]} c="#7a807c" />
      <Box p={[4, 6, 0]} s={[0.5, 12, 0.5]} c="#7a807c" />
      <Box p={[0, 12, 0]} s={[9, 0.6, 0.6]} c="#7a807c" />
      <Box p={[0, 1.6, 5]} s={[2, 3.2, 1.6]} c="#9aa09b" />
    </group>
  );
}

function Switchyard() {
  const { x, z } = SWITCHYARD;
  const fence: V3[] = [[x - 26, 1.2, z - 34], [x + 26, 1.2, z - 34], [x + 26, 1.2, z + 34], [x - 26, 1.2, z + 34], [x - 26, 1.2, z - 34]];
  return (
    <Selectable id="switchyard">
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[x, 0.15, z]} receiveShadow>
        <planeGeometry args={[52, 68]} />
        <meshStandardMaterial color="#c4c0b6" roughness={1} />
      </mesh>
      <Line points={fence} color="#6b6862" lineWidth={1} />
      {[-14, 0, 14].map((dx) => [-22, -2, 18].map((dz) => <Gantry key={`${dx}${dz}`} x={x + dx} z={z + dz} />))}
      {/* transmission tower leaving the site */}
      <group position={[x + 40, 0, z]}>
        {[[-3, -3], [3, -3], [-3, 3], [3, 3]].map(([a, b], i) => (
          <mesh key={i} position={[a * 0.55, 15, b * 0.55]} rotation={[b * 0.035, 0, -a * 0.035]}>
            <boxGeometry args={[0.5, 30, 0.5]} />
            <meshStandardMaterial color="#7a807c" />
          </mesh>
        ))}
        <Box p={[0, 26, 0]} s={[16, 0.6, 0.6]} c="#7a807c" />
        <Box p={[0, 20, 0]} s={[12, 0.6, 0.6]} c="#7a807c" />
      </group>
      <Html position={[x, 18, z]} center zIndexRange={[10, 0]}>
        <Label id="switchyard" className="tag-muted"><strong>Switchyard</strong></Label>
      </Html>
    </group>
    </Selectable>
  );
}

function Utilities() {
  return (
    <group>
      {[[100, 18], [116, 18]].map(([x, z], i) => (
        <mesh key={i} position={[x, 7, z]} castShadow receiveShadow>
          <cylinderGeometry args={[6.5, 6.5, 14, 28]} />
          <meshStandardMaterial color="#eeeee9" roughness={0.6} />
        </mesh>
      ))}
      {/* lube oil fin-fan coolers */}
      {Array.from({ length: 5 }, (_, i) => (
        <group key={i} position={[30 + i * 9, 0, -104]}>
          <Box p={[0, 3, 0]} s={[8, 2, 7]} c="#a3a8a3" />
          <Box p={[-3.4, 1, -3]} s={[0.4, 2, 0.4]} c="#5c625e" />
          <Box p={[3.4, 1, 3]} s={[0.4, 2, 0.4]} c="#5c625e" />
          <mesh position={[0, 4.05, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[2.8, 18]} />
            <meshStandardMaterial color="#5f6561" />
          </mesh>
        </group>
      ))}
      {/* admin and control building */}
      <Box p={[-120, 4, 72]} s={[30, 8, 16]} c="#d8d5cc" />
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

function PowerFlow() {
  const turbines = useStore((s) => s.plant.turbines);
  const battery = useStore((s) => s.plant.battery);
  const demand = useStore((s) => s.plant.demandMw);
  const output = useStore((s) => s.plant.outputMw);
  const sy = SWITCHYARD;
  return (
    <group>
      {turbines.map((tb, i) => (
        <FlowLine key={tb.id} points={[[UNIT_X(i) + 8, 7, -76], [UNIT_X(i) + 8, 9, BUS_Z]]} mw={tb.outputMw} max={335} />
      ))}
      <FlowLine points={[[UNIT_X(0) + 8, 9, BUS_Z], [sy.x - 14, 9, BUS_Z], [sy.x - 14, 9, sy.z - 34]]} mw={output} max={2700} />
      <FlowLine points={[[sy.x - 20, 9, sy.z + 34], [sy.x - 20, 9, 60], [76, 9, 60]]} mw={demand} max={2700} />
      <FlowLine points={[[-150, 7, 40], [-150, 9, 60], [-76, 9, 60]]} mw={Math.abs(battery.powerMw)} max={400} />
      {[-90, -30, 30, 90].map((x) => <Box key={x} p={[x + 8, 4.5, BUS_Z]} s={[0.6, 9, 0.6]} c="#5c625e" />)}
    </group>
  );
}

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
        <Box p={[0, 8, 62]} s={[150, 16, 32]} c="#d6d8d2" rough={0.8} />
        <instancedMesh ref={racks} args={[undefined, undefined, count]}>
          <boxGeometry args={[3.6, 0.5, 0.2]} />
          <meshStandardMaterial color="#9fc3e6" emissive="#6fa8dc" emissiveIntensity={glow} toneMapped={false} />
        </instancedMesh>
        {[-50, -20, 10, 40].map((x) => <Box key={x} p={[x, 17, 66]} s={[10, 2, 8]} c="#a7aba5" />)}
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
          <mesh key={i} position={[(i % 4) * 7.5 - 11, 1.6, Math.floor(i / 4) * 5 - 5]} castShadow>
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

function Truck() {
  // Only one truck is drawn on site: whichever is closest to the gate.
  const sh = useStore((s) => s.plant.shipments.reduce((a, b) => (b.remainingKm < a.remainingKm ? b : a)));
  const group = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(ROAD.map((p) => new THREE.Vector3(...p))), []);
  const onSite = !!sh && sh.remainingKm <= ROAD_KM;
  useFrame(() => {
    if (!group.current || !sh) return;
    const u = Math.min(1, Math.max(0, 1 - sh.remainingKm / ROAD_KM));
    const p = curve.getPointAt(u);
    const ahead = curve.getPointAt(Math.min(1, u + 0.01));
    group.current.position.lerp(p, 0.15);
    if (u < 0.99) group.current.lookAt(ahead.x, p.y, ahead.z);
  });
  if (!sh) return null;
  return (
    <>
      <Line points={ROAD} color={ASPHALT} lineWidth={7} />
      <Selectable id={sh.id}>
        <Box p={[150, 5, 68]} s={[24, 10, 14]} c="#cfcac0" />
      </Selectable>
      {/* The delivery dock carries the arrival readout so it stays put while the truck moves. */}
      <Html position={[150, 15, 68]} center distanceFactor={110} zIndexRange={[10, 0]}>
        <Label id={sh.id}>
          <strong>Delivery dock</strong>
          <span>
            {sh.arrived
              ? `${sh.id} on site`
              : onSite
                ? `${sh.id} arriving, ${(sh.remainingKm * 1000).toFixed(0)} m out`
                : `Next: ${sh.id}, ${sh.remainingKm.toFixed(0)} km out`}
          </span>
        </Label>
      </Html>
      <group ref={group} visible={onSite} position={ROAD[0]}>
        <Selectable id={sh.id}>
          <Box p={[0, 2.2, -2]} s={[2.6, 3, 9]} c="#e8e6e0" />
          <Box p={[0, 1.8, 4]} s={[2.6, 2.6, 3]} c={FLOW} />
        </Selectable>
      </group>
    </>
  );
}

function Scene() {
  const turbines = useStore((s) => s.plant.turbines);
  const selected = useStore((s) => s.selected);
  return (
    <>
      <Sky sunPosition={[-1, 0.06, -0.35]} turbidity={9} rayleigh={2.4} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#d9b48f", 320, 760]} />
      <hemisphereLight args={["#c7d3e8", "#8a6a48", 0.9]} />
      <directionalLight
        position={[-200, 80, -110]} intensity={2.2} color="#ffd2a1" castShadow
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
      <Truck />
    </>
  );
}

export function PlantScene() {
  const controls = useRef<OrbitControlsImpl>(null);
  const select = useStore((s) => s.select);
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
      camera={{ position: [190, 160, 260], fov: 34, near: 1, far: 1800 }}
      onPointerMissed={(e) => {
        if ((e.target as Element | null)?.closest?.(".tag-btn")) return;
        if (isTap(e as PointerEvent)) select(null);
      }}
    >
      <Scene />
      <FitToScreen />
      <OrbitControls ref={controls} target={[0, 0, -10]} maxPolarAngle={Math.PI / 2.2} minDistance={30} maxDistance={620} enableDamping dampingFactor={0.08} />
      <CameraRig controls={controls} />
    </Canvas>
  );
}
