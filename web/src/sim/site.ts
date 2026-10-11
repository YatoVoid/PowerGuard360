// Plant site layout in metres, shared by the engine (walking distances) and the 3D scene (positions).
// x runs west to east, z runs north to south. Engineers start at the control building in the south-west.

export type XZ = [number, number];

export const UNIT_X = (i: number) => -84 + i * 24;
export const CONTROL_ROOM: XZ = [-120, 60];
export const SWITCHYARD_XZ: XZ = [152, -45];

// Engineers stay on the service road (z = 38) between the turbine row and the data center,
// then turn up the gap between units to reach a turbine.
const ROAD_Z = 38;

function viaRoad(...tail: XZ[]): XZ[] {
  return [CONTROL_ROOM, [CONTROL_ROOM[0], ROAD_Z], ...tail];
}

export function assetPath(asset: string): XZ[] {
  if (asset.startsWith("GT-")) {
    const x = UNIT_X(Number(asset.slice(3)) - 1);
    return viaRoad([x + 12, ROAD_Z], [x + 12, -48], [x + 5, -48]);
  }
  if (asset === "battery") return viaRoad([-132, ROAD_Z], [-132, 34]);
  if (asset === "acc") return viaRoad([-140, ROAD_Z], [-140, -20]);
  if (asset === "switchyard") return viaRoad([126, ROAD_Z], [126, -45]);
  if (asset === "gas") return viaRoad([104, ROAD_Z], [104, -34], [112, -34]);
  if (asset === "datacenter") return viaRoad([0, ROAD_Z]);
  return viaRoad([0, ROAD_Z]);
}

export const ASSET_LABEL: Record<string, string> = {
  battery: "battery yard",
  acc: "air-cooled condenser",
  switchyard: "switchyard",
  gas: "gas metering",
  datacenter: "data center",
};
export const assetLabel = (asset: string) => ASSET_LABEL[asset] ?? asset;

export function pathLength(path: XZ[]) {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return m;
}

export function pointOnPath(path: XZ[], progress: number): XZ {
  let target = Math.min(Math.max(progress, 0), 1) * pathLength(path);
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (target <= seg || i === path.length - 1) {
      const f = seg === 0 ? 0 : Math.min(target / seg, 1);
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
    }
    target -= seg;
  }
  return path[path.length - 1];
}

// Route from wherever an engineer is standing to an asset: back out to the service road first.
export function routeFrom(from: XZ, asset: string): XZ[] {
  const target = assetPath(asset);
  if (from[0] === CONTROL_ROOM[0] && from[1] === CONTROL_ROOM[1]) return target;
  const exit: XZ[] = from[1] < ROAD_Z - 1 ? [[from[0] + 7, from[1]], [from[0] + 7, ROAD_Z]] : [[from[0], ROAD_Z]];
  return [from, ...exit, ...target.slice(2)];
}
