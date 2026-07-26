export type Point = { x: number; y: number };

type Bounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

type Options = {
  bounds: Bounds;
  minDistance: number;
  random: () => number;
  /** Reject a candidate point, for scattering over a shape rather than the whole box. */
  accepts?: (point: Point) => boolean;
  initial?: () => Point;
  limit?: number;
};

/**
 * Draws scatter dots that are at least `minDistance` apart, but look more even than picking
 * positions at random. We use Bridson's algorithm: keep growing the set from points already
 * placed, and drop a point once it has no room left around it.
 */
export const poissonDisk = ({
  bounds,
  minDistance,
  random,
  accepts = () => true,
  initial,
  limit = Number.POSITIVE_INFINITY,
}: Options): Point[] => {
  if (limit <= 0) return [];
  const { xMin, xMax, yMin, yMax } = bounds;
  const cellSize = minDistance / Math.SQRT2;
  const columns = Math.ceil((xMax - xMin) / cellSize);
  const rows = Math.ceil((yMax - yMin) / cellSize);
  const grid = new Int32Array(columns * rows).fill(-1);
  const points: Point[] = [];
  const active: number[] = [];
  const distanceSquared = minDistance ** 2;

  const add = (point: Point) => {
    const index = points.push(point) - 1;
    const column = Math.floor((point.x - xMin) / cellSize);
    const row = Math.floor((point.y - yMin) / cellSize);
    grid[column + row * columns] = index;
    active.push(index);
  };

  const isValid = (point: Point) => {
    if (point.x < xMin || point.x >= xMax || point.y < yMin || point.y >= yMax || !accepts(point)) {
      return false;
    }

    const column = Math.floor((point.x - xMin) / cellSize);
    const row = Math.floor((point.y - yMin) / cellSize);
    for (let y = Math.max(0, row - 2); y <= Math.min(rows - 1, row + 2); y++) {
      for (let x = Math.max(0, column - 2); x <= Math.min(columns - 1, column + 2); x++) {
        const other = points[grid[x + y * columns]];
        if (other && (other.x - point.x) ** 2 + (other.y - point.y) ** 2 < distanceSquared) {
          return false;
        }
      }
    }
    return true;
  };

  // `accepts` can reject a lot of the box, so keep trying for a first point.
  for (let attempt = 0; attempt < 100 && points.length === 0; attempt++) {
    const point = initial?.() ?? {
      x: xMin + random() * (xMax - xMin),
      y: yMin + random() * (yMax - yMin),
    };
    if (isValid(point)) add(point);
  }

  while (active.length && points.length < limit) {
    const activeIndex = Math.floor(random() * active.length);
    const origin = points[active[activeIndex]];
    let placed = false;

    // Thirty tries around this point; if none land, it has no room left.
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = minDistance * (1 + random());
      const point = {
        x: origin.x + Math.cos(angle) * distance,
        y: origin.y + Math.sin(angle) * distance,
      };
      if (isValid(point)) {
        add(point);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(activeIndex, 1);
  }

  return points.slice(0, limit);
};
