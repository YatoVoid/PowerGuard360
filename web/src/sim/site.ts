// Plant site layout in metres, shared by the engine (walking distances) and the 3D scene (positions).
// x runs west to east, z runs north to south; the delivery dock sits on the south-east corner.

export type XZ = [number, number];

export const UNIT_X = (i: number) => -84 + i * 24;

// Three bays on the dock apron, one per inbound truck.
export const DOCK_BAYS: XZ[] = [[134, 86], [150, 86], [166, 86]];
export const DOCK_DOOR: XZ = [150, 76];

// Workers stay on the service road (z = 38) between the turbine row and the data center,
// then turn up the gap between units to reach a turbine.
const ROAD_Z = 38;

export interface DeliveryTarget {
  label: string;
  path: XZ[];
}

function viaRoad(...tail: XZ[]): XZ[] {
  return [DOCK_DOOR, [DOCK_DOOR[0], ROAD_Z], ...tail];
}

export function deliveryTarget(asset: string): DeliveryTarget {
  if (asset.startsWith("GT-")) {
    const x = UNIT_X(Number(asset.slice(3)) - 1);
    return { label: `${asset} enclosure`, path: viaRoad([x + 12, ROAD_Z], [x + 12, -48], [x + 5, -48]) };
  }
  if (asset === "battery") {
    return { label: "battery yard", path: viaRoad([-132, ROAD_Z], [-132, 34]) };
  }
  // Lube oil goes to the fin-fan cooler skid behind the turbine row.
  return { label: "lube oil skid", path: viaRoad([100, ROAD_Z], [100, -96], [48, -96]) };
}

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
