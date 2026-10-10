import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore } from "../store";
import type { Turbine } from "../types";

const UNIT_X = (i: number) => -84 + i * 24;
const STATUS_COLOR: Record<Turbine["status"], string> = {
  running: "#8f9690",
  watch: "#e0a100",
  tripped: "#c8261e",
  offline: "#5d6360",
};
const STEEL = "#9aa19c";
const CONCRETE = "#b7b1a4";
const FLOW = "#2f5d8a";
const ROAD: [number, number, number][] = [[240, 0.2, 96], [180, 0.2, 92], [150, 0.2, 84], [126, 0.2, 80]];
const ROAD_KM = 3;

// Focus easing adapted from WareTwin (MIT, github.com/WayneChou-bot/WareTwin).
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const selected = useStore((s) => s.selected);
  const goal = useRef<THREE.Vector3 | null>(null);
  const camGoal = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const p = assetPosition(selected);
    if (!p) return;
    goal.current = new THREE.Vector3(p[0], 4, p[2]);
    camGoal.current = new THREE.Vector3(p[0] + 34, 30, p[2] + 52);
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

function assetPosition(id: string | null): [number, number, number] | null {
  if (!id) return null;
  if (id.startsWith("GT-")) return [UNIT_X(Number(id.slice(3)) - 1), 0, -30];
  if (id === "datacenter") return [0, 0, 55];
  if (id === "battery") return [-132, 0, 14];
  if (id === "substation") return [0, 0, 0];
  if (id === "TRL-204") return [126, 0, 80];
  return null;
}

function Ground() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0, 0]}>
        <planeGeometry args={[900, 700]} />
        <meshStandardMaterial color="#b98e5e" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 10]} receiveShadow>
        <planeGeometry args={[310, 150]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.95} />
      </mesh>
    </>
  );
}

function Selectable({ id, children }: { id: string; children: React.ReactNode }) {
  const select = useStore((s) => s.select);
  return (
    <group
      onClick={(e) => { e.stopPropagation(); select(id); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = ""; }}
    >
      {children}
    </group>
  );
}

function BeaconLight({ position }: { position: [number, number, number] }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.color.setRGB(clock.elapsedTime % 2 < 0.25 ? 1 : 0.25, 0.05, 0.03);
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.45, 8, 8]} />
      <meshBasicMaterial ref={mat} toneMapped={false} />
    </mesh>
  );
}

function TurbineUnit({ tb, index, selected }: { tb: Turbine; index: number; selected: boolean }) {
  const x = UNIT_X(index);
  const color = STATUS_COLOR[tb.status];
  const alarm = tb.status === "watch" || tb.status === "tripped";
  const plume = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!plume.current) return;
    const on = tb.status === "running" || tb.status === "watch";
    plume.current.visible = on;
    plume.current.children.forEach((m, i) => {
      const k = (clock.elapsedTime * 0.35 + i / 3) % 1;
      m.position.y = 26 + k * 14;
      m.scale.setScalar(1 + k * 2.5);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.18 * (1 - k) * (tb.outputMw / tb.ratedMw);
    });
  });
  return (
    <Selectable id={tb.id}>
      <group position={[x, 0, -30]}>
        {/* inlet filter house */}
        <mesh position={[0, 6, -13]} castShadow receiveShadow>
          <boxGeometry args={[9, 12, 6]} />
          <meshStandardMaterial color={STEEL} roughness={0.7} metalness={0.2} />
        </mesh>
        {/* turbine enclosure */}
        <mesh position={[0, 4, 0]} castShadow receiveShadow>
          <boxGeometry args={[8, 8, 18]} />
          <meshStandardMaterial color="#c3c6bf" roughness={0.6} metalness={0.15} />
        </mesh>
        {/* status band: grey when normal, colored only when abnormal */}
        <mesh position={[0, 8.15, 0]}>
          <boxGeometry args={[8.1, 0.3, 18.1]} />
          <meshStandardMaterial color={color} emissive={alarm ? color : "#000"} emissiveIntensity={alarm ? 1.4 : 0} toneMapped={!alarm} />
        </mesh>
        {/* exhaust stack */}
        <mesh position={[0, 12, 12]} castShadow>
          <cylinderGeometry args={[1.7, 2, 24, 16]} />
          <meshStandardMaterial color="#7d837f" roughness={0.5} metalness={0.4} />
        </mesh>
        <BeaconLight position={[0, 24.6, 12]} />
        <group ref={plume} position={[0, 0, 12]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[1.8, 10, 10]} />
              <meshStandardMaterial color="#e9e4dc" transparent opacity={0.15} depthWrite={false} />
            </mesh>
          ))}
        </group>
        {/* step-up transformer */}
        <mesh position={[0, 2.2, 20]} castShadow>
          <boxGeometry args={[5, 4.4, 4]} />
          <meshStandardMaterial color="#6f7672" roughness={0.6} />
        </mesh>
        {selected && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 0]}>
            <ringGeometry args={[13, 14, 48]} />
            <meshBasicMaterial color={FLOW} />
          </mesh>
        )}
        <Html position={[0, 31, 12]} center distanceFactor={140} zIndexRange={[10, 0]} className="tag-wrap">
          <div className={`tag tag-${tb.status}`}>
            <strong>{tb.id}</strong>
            <span>{tb.status === "tripped" || tb.status === "offline" ? tb.status : `${tb.outputMw.toFixed(0)} MW`}</span>
          </div>
        </Html>
      </group>
    </Selectable>
  );
}

function GasHeader() {
  return (
    <group>
      <mesh position={[0, 1.2, -52]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.9, 0.9, 200, 12]} />
        <meshStandardMaterial color="#c9a227" roughness={0.5} metalness={0.3} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[UNIT_X(i), 1.2, -48]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.45, 0.45, 8, 8]} />
          <meshStandardMaterial color="#c9a227" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function FlowLine({ points, mw, max }: { points: [number, number, number][]; mw: number; max: number }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * (mw / max) * 30;
  });
  const active = mw > 1;
  return (
    <Line
      ref={ref as never}
      points={points}
      color={active ? FLOW : "#7b807c"}
      lineWidth={active ? 2.6 : 1.2}
      dashed
      dashSize={3}
      gapSize={active ? 2 : 0}
    />
  );
}

function PowerFlow() {
  const turbines = useStore((s) => s.plant.turbines);
  const battery = useStore((s) => s.plant.battery);
  const demand = useStore((s) => s.plant.demandMw);
  return (
    <group>
      {turbines.map((tb, i) => (
        <FlowLine key={tb.id} points={[[UNIT_X(i), 7, -10], [UNIT_X(i), 7, 0]]} mw={tb.outputMw} max={335} />
      ))}
      <FlowLine points={[[-130, 7, 0], [130, 7, 0]]} mw={demand} max={2700} />
      <FlowLine points={[[-132, 7, 6], [-132, 7, 0]]} mw={Math.abs(battery.powerMw)} max={400} />
      <FlowLine points={[[0, 7, 0], [0, 7, 38]]} mw={demand} max={2700} />
      {[-120, -60, 0, 60, 120].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 3.5, 0]}>
            <boxGeometry args={[0.6, 7, 0.6]} />
            <meshStandardMaterial color="#5c625e" />
          </mesh>
        </group>
      ))}
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
      dummy.position.set(-70 + (i % 30) * 4.8, 4 + Math.floor(i / 30) * 5, 38.9);
      dummy.updateMatrix();
      racks.current.setMatrixAt(i, dummy.matrix);
    }
    racks.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);
  const glow = Math.min(1.8, 0.3 + (demand - 1800) / 600);
  return (
    <Selectable id="datacenter">
      <group>
        <mesh position={[0, 8, 55]} castShadow receiveShadow>
          <boxGeometry args={[150, 16, 32]} />
          <meshStandardMaterial color="#d6d8d2" roughness={0.8} />
        </mesh>
        <instancedMesh ref={racks} args={[undefined, undefined, count]}>
          <boxGeometry args={[3.6, 0.5, 0.2]} />
          <meshStandardMaterial color="#9fc3e6" emissive="#6fa8dc" emissiveIntensity={glow} toneMapped={false} />
        </instancedMesh>
        {[-50, -20, 10, 40].map((x) => (
          <mesh key={x} position={[x, 17, 60]} castShadow>
            <boxGeometry args={[10, 2, 8]} />
            <meshStandardMaterial color="#a7aba5" />
          </mesh>
        ))}
        <Html position={[0, 22, 55]} center distanceFactor={160} zIndexRange={[10, 0]}>
          <div className="tag tag-dc">
            <strong>AI data center</strong>
            <span>{demand.toFixed(0)} MW load</span>
          </div>
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
      <group position={[-132, 0, 22]}>
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
        <Html position={[0, 9, 0]} center distanceFactor={140} zIndexRange={[10, 0]}>
          <div className="tag">
            <strong>Battery</strong>
            <span>{battery.socPct.toFixed(0)}%{discharging ? `, out ${battery.powerMw.toFixed(0)} MW` : ""}</span>
          </div>
        </Html>
      </group>
    </Selectable>
  );
}

function Truck() {
  const sh = useStore((s) => s.plant.shipments[0]);
  const group = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(ROAD.map((p) => new THREE.Vector3(...p))), []);
  const onSite = sh && sh.remainingKm <= ROAD_KM;
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
      <Line points={ROAD} color="#55524c" lineWidth={6} />
      <mesh position={[126, 5, 66]} castShadow receiveShadow>
        <boxGeometry args={[22, 10, 14]} />
        <meshStandardMaterial color="#cfcac0" />
      </mesh>
      <group ref={group} visible={onSite} position={ROAD[0]}>
        <Selectable id={sh.id}>
          <mesh position={[0, 2.2, -2]} castShadow>
            <boxGeometry args={[2.6, 3, 9]} />
            <meshStandardMaterial color="#e8e6e0" />
          </mesh>
          <mesh position={[0, 1.8, 4]} castShadow>
            <boxGeometry args={[2.6, 2.6, 3]} />
            <meshStandardMaterial color={FLOW} />
          </mesh>
          <Html position={[0, 7, 0]} center distanceFactor={120} zIndexRange={[10, 0]}>
            <div className="tag">
              <strong>{sh.id}</strong>
              <span>{sh.arrived ? "on site" : `${(sh.remainingKm * 1000).toFixed(0)} m out`}</span>
            </div>
          </Html>
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
      <fog attach="fog" args={["#d9b48f", 260, 640]} />
      <hemisphereLight args={["#c7d3e8", "#8a6a48", 0.9]} />
      <directionalLight
        position={[-180, 70, -90]} intensity={2.2} color="#ffd2a1" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-200} shadow-camera-right={200} shadow-camera-top={140} shadow-camera-bottom={-140} shadow-camera-far={500}
      />
      <Ground />
      <GasHeader />
      {turbines.map((tb, i) => <TurbineUnit key={tb.id} tb={tb} index={i} selected={selected === tb.id} />)}
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
      camera={{ position: [150, 120, 210], fov: 34, near: 1, far: 1500 }}
      onPointerMissed={() => select(null)}
    >
      <Scene />
      <OrbitControls ref={controls} target={[0, 0, 5]} maxPolarAngle={Math.PI / 2.2} minDistance={30} maxDistance={520} enableDamping dampingFactor={0.08} />
      <CameraRig controls={controls} />
    </Canvas>
  );
}
