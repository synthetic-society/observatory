import { poissonDisk } from "../lib/poisson";
import { mulberry32 } from "../model/stats";

type Props = {
  variant?: "navy" | "black";
  seed?: number;
  crowd?: number; // How many people share the answers given so far
  className?: string;
};

const palette = {
  navy: { dot: "#15205c", you: "#d83a86" },
  black: { dot: "#000000", you: "#d83a86" },
};

const W = 1000;
const H = 500;
const CX = W / 2;
const CY = H / 2;
const HOLE_RADIUS = 14;
const MIN_RADIUS = HOLE_RADIUS + 40;
const MAX_DOTS = 700;
const AREA_PER_DOT = 150;
const VIEW_MARGIN = 30;
const EDGE_OPACITY = 0.2;
const DOT_RADIUS = 3;

// The ring grows slowly with the crowd so that a hundred people and a million
// both stay on screen.
const radiusFor = (crowd: number) => (crowd <= 1 ? MIN_RADIUS : Math.max(MIN_RADIUS, 4 * crowd ** 0.3));

const areaOf = (radius: number) =>
  Math.min(Math.PI * (radius * radius - HOLE_RADIUS * HOLE_RADIUS), (W + 2 * VIEW_MARGIN) * (H + 2 * VIEW_MARGIN));

// Up to a hundred people, we show one dot each. Beyond that, the ring fills more more and more slowly
const dotCountFor = (crowd: number, radius: number) => {
  if (crowd <= 1) return 0;
  if (crowd <= 100) return Math.round(crowd);
  return Math.min(MAX_DOTS, Math.round(areaOf(radius) / AREA_PER_DOT));
};

// Dots spread evenly around a ring, leaving a hole in the middle for the person
const dotsInRing = (radius: number, target: number, random: () => number) => {
  if (target <= 0) return [];
  const points = poissonDisk({
    bounds: {
      xMin: -VIEW_MARGIN,
      xMax: W + VIEW_MARGIN,
      yMin: -VIEW_MARGIN,
      yMax: H + VIEW_MARGIN,
    },
    minDistance: Math.max(2, Math.sqrt(areaOf(radius) / target) * 0.85),
    random,
    limit: target,
    initial: () => {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random() * (radius * radius - HOLE_RADIUS * HOLE_RADIUS) + HOLE_RADIUS * HOLE_RADIUS);
      return { x: CX + Math.cos(angle) * distance, y: CY + Math.sin(angle) * distance };
    },
    accepts: ({ x, y }) => {
      const distanceSquared = (x - CX) ** 2 + (y - CY) ** 2;
      return distanceSquared >= HOLE_RADIUS ** 2 && distanceSquared <= radius ** 2;
    },
  });
  return points.map((point) => ({ ...point, distance: Math.hypot(point.x - CX, point.y - CY) }));
};

// Dots fade towards the edge so the ring has no hard edge
const opacityAt = (distance: number, radius: number) => {
  if (radius <= HOLE_RADIUS) return 1;
  const fromHole = (distance - HOLE_RADIUS) / (radius - HOLE_RADIUS);
  return 1 - (1 - EDGE_OPACITY) * Math.min(1, Math.max(0, fromHole));
};

/** A ring of dots for the crowd, with a marker in the middle for the person. */
export default function DotField({ variant = "navy", seed = 7, crowd = 1, className = "" }: Props) {
  const colors = palette[variant];
  const radius = radiusFor(crowd);
  const points = dotsInRing(radius, dotCountFor(crowd, radius), mulberry32(seed));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className={`block h-full w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {points.map((point) => (
        <circle
          key={`${point.x},${point.y}`}
          cx={point.x}
          cy={point.y}
          r={DOT_RADIUS}
          fill={colors.dot}
          opacity={opacityAt(point.distance, radius)}
        />
      ))}
      <circle cx={CX} cy={CY} r={8} fill="none" stroke={colors.dot} stroke-width={2} />
      <circle cx={CX} cy={CY} r={4} fill={colors.you} />
    </svg>
  );
}
