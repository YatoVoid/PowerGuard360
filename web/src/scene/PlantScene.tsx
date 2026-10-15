import { createContext, Suspense, useContext, useEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bvh, Environment, Html, Line, OrbitControls, Sky, useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";
import type { GLTFLoader, OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore, type CameraPreset } from "../store";
import { UNIT_X } from "../sim/site";
import { etaText } from "../ui/parts";
import { LogoLoader } from "../ui/LogoLoader";
import { LIVE_SENSOR_UNIT, SITE_REPLAY_SPEED, WALK_M_PER_S } from "../sim/engine";
import type { Turbine } from "../types";

// Layout follows a combined-cycle plant: gas turbine -> heat recovery steam generator (HRSG) with the
// stack on top -> steam turbine hall -> air-cooled condenser, which West Texas plants use instead of
// water cooling towers. The buildings and equipment are a Blender model (blender/build_plant.py) styled
// after a Permian Basin plant built for an AI data center; this file draws the live parts on top of it.

type V3 = [number, number, number];

const STATUS_COLOR: Record<Turbine["status"], string> = {
  running: "#8f9690",
  watch: "#e0a100",
  tripped: "#c8261e",
  offline: "#5d6360",
};
const FLOW = "#2f5d8a";
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

const PLANT_URL = `${import.meta.env.BASE_URL}models/plant.glb`;
// Served from web/public so the plant loads without internet.
const DRACO_URL = `${import.meta.env.BASE_URL}draco/`;
// Chrome and Firefox decode glTF textures by fetch()ing blob: URLs, which the site's CSP (connect-src) refuses, so every
// surface came out white. Loading them as <img> goes through img-src, which allows blob:, and is what Safari does anyway.
function imageTextures(loader: GLTFLoader) {
  loader.register((parser) => {
    (parser as unknown as { textureLoader: THREE.Loader }).textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: "pg_image_textures" } as ReturnType<Parameters<GLTFLoader["register"]>[0]>;
  });
}
const SELECTABLE_NODES = new Set(["acc", "gas", "switchyard", "datacenter", "battery", "control"]);
// Ground and paint lie flat on the ground; letting them cast shadows only adds acne.
const NO_CAST = /desert|gravel|asphalt|paint/;

// Each top-level node of the model is one asset, named the way the store names it.
function PlantModel() {
  const { scene } = useGLTF(PLANT_URL, DRACO_URL, true, imageTextures);
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const nodes = useMemo(() => {
    // <primitive> moves each node out of its parent, so the cached glTF scene would be empty the next time the
    // Plant view mounts. A clone shares geometry and textures, so it is cheap.
    const root = scene.clone();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.receiveShadow = true;
      o.castShadow = !NO_CAST.test(o.name);
      // Ground textures are seen at a grazing angle from the default camera.
      const map = (o.material as THREE.MeshStandardMaterial).map;
      if (map) map.anisotropy = Math.min(8, maxAniso);
    });
    return [...root.children];
  }, [scene, maxAniso]);
  return (
    <>
      {nodes.map((n) => n.name.startsWith("GT-") || SELECTABLE_NODES.has(n.name)
        ? <Selectable key={n.name} id={n.name}><primitive object={n} /></Selectable>
        : <primitive key={n.name} object={n} />)}
    </>
  );
}
useGLTF.preload(PLANT_URL, DRACO_URL, true, imageTextures);

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
        {/* status band on the gas turbine enclosure roof */}
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

// Air-cooled condenser, after a standard A-frame design: axial fans at deck level push air up through
// inclined finned tube bundles; steam enters along the apex header and condenses on the way down.
// The structure is in the model; the fans turn here, faster as the plant makes more power.
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
  const fans = useRef<THREE.InstancedMesh>(null);
  const angle = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { streets, width, z0, z1, deck, apex, fansPerStreet } = ACC;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const fanPitch = len / fansPerStreet;
  const fanCount = streets.length * fansPerStreet;
  const xMin = streets[0] - width / 2 - 0.5, xMax = streets[streets.length - 1] + width / 2 + 0.5;

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
      <instancedMesh ref={shrouds} args={[undefined, undefined, fanCount]}>
        <cylinderGeometry args={[4.3, 4.3, 1.6, 28, 1, true]} />
        <meshStandardMaterial color="#9ca29d" metalness={0.5} roughness={0.45} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={fans} args={[undefined, undefined, fanCount]}>
        <boxGeometry args={[7.8, 0.15, 0.8]} />
        <meshStandardMaterial color="#4f5552" />
      </instancedMesh>
      <Tag position={[(xMin + xMax) / 2, apex + 8, zc]} center zIndexRange={[10, 0]}>
        <Label id="acc" className="tag-muted"><strong>Air-cooled condenser</strong></Label>
      </Tag>
    </group>
    </Selectable>
  );
}

function GasSupply() {
  const gas = useStore((s) => s.plant.gas);
  const recommended = useStore((s) => s.plant.recommendations.some((r) => r.asset === "gas" && r.status === "pending"));
  const tone = gas.connected && gas.level === "poor" ? "tag-tripped" : recommended || (gas.connected && gas.level === "reduced") ? "tag-watch" : "tag-muted";
  return (
    <Selectable id="gas">
    <group>
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

function Switchyard() {
  const { x, z } = SWITCHYARD;
  return (
    <Selectable id="switchyard">
    <group>
      <Tag position={[x, 18, z]} center zIndexRange={[10, 0]}>
        <Label id="switchyard" className="tag-muted"><strong>Switchyard</strong></Label>
      </Tag>
    </group>
    </Selectable>
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

// Late-afternoon West Texas sun from the south-west, so shadows fall long across the pad toward the camera's right.
const SUN: V3 = [-230, 150, 160];
const SKY = { sunPosition: SUN, turbidity: 7, rayleigh: 1.3, mieCoefficient: 0.006, mieDirectionalG: 0.85 } as const;

function Desert() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // Dusty haze toward the horizon; it also hides where the modelled desert ends.
    scene.fog = new THREE.Fog("#d8cdb9", 520, 1500);
    return () => { scene.fog = null; };
  }, [scene]);
  return (
    <>
      {/* The sky shader pins itself to the far plane, so a huge box never clips. */}
      <Sky {...SKY} distance={450000} />
      <Environment resolution={128} environmentIntensity={0.45}>
        <Sky {...SKY} distance={450000} />
      </Environment>
    </>
  );
}

function Scene() {
  const turbines = useStore((s) => s.plant.turbines);
  const selected = useStore((s) => s.selected);
  return (
    <>
      <Desert />
      <hemisphereLight args={["#dce8f5", "#b39a76", 0.55]} />
      <directionalLight
        position={SUN} intensity={2.0} color="#ffefd6" castShadow
        shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.04}
        shadow-camera-left={-250} shadow-camera-right={250} shadow-camera-top={210} shadow-camera-bottom={-210} shadow-camera-far={900}
      />
      <Suspense fallback={null}>
        {/* Bounding volume tree: hover and click tests on 200k triangles stay cheap. */}
        <Bvh firstHitOnly>
          <PlantModel />
        </Bvh>
      </Suspense>
      <GasSupply />
      {turbines.map((tb, i) => <TurbineUnit key={tb.id} tb={tb} index={i} selected={selected === tb.id} />)}
      <AirCooledCondenser />
      <Switchyard />
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

// The plant model is a 1.8 MB download; until it lands the site is bare desert, so say what's coming.
function ModelProgress() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return <div className="scene-progress"><LogoLoader label={`Loading plant model ${Math.round(progress)}%`} /></div>;
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
    <ModelProgress />
    </div>
  );
}
