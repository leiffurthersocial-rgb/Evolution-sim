/**
 * utils.ts
 * -----------------------------------------------------------------------------
 * Small, dependency-free helpers shared across systems: geometry, clamping, a
 * generic uniform spatial grid for neighbour queries, and colour helpers.
 * -----------------------------------------------------------------------------
 */

/** Any point-like entity the spatial grid can bucket. */
export interface Point {
  x: number;
  y: number;
}

/** Clamp `v` into [min, max]. */
export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Euclidean distance between two points. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance — cheaper when you only need comparisons. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Normalise a value from [min,max] into [0,1]. */
export const norm = (v: number, min: number, max: number): number =>
  max === min ? 0 : (v - min) / (max - min);

/** Convert HSL (h in degrees, s/l in 0..1) to a CSS hsl() string. */
export function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${((h % 360) + 360) % 360}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/** Population standard deviation of a numeric array. */
export function stddev(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  let m = 0;
  for (const v of values) m += v;
  m /= n;
  let variance = 0;
  for (const v of values) variance += (v - m) * (v - m);
  return Math.sqrt(variance / n);
}

/** Arithmetic mean of a numeric array (0 for empty). */
export function mean(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / n;
}

/**
 * SpatialGrid<T>
 * -----------------------------------------------------------------------------
 * A uniform grid that buckets point-like entities into cells so "what is near
 * (x, y) within radius r" runs in roughly O(items-in-nearby-cells) instead of
 * O(all items). The single most important optimisation for scaling to thousands
 * of organisms and food items. Holds no long-lived references, so it never leaks.
 */
export class SpatialGrid<T extends Point> {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private cells: T[][];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = Math.max(8, cellSize);
    this.cols = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  private _index(x: number, y: number): number {
    const cx = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
  }

  insert(entity: T): void {
    this.cells[this._index(entity.x, entity.y)].push(entity);
  }

  /**
   * Collect entities whose cell overlaps the query circle. Returns a flat array
   * (may include a few just outside `radius`; callers distance-test if exact).
   */
  query(x: number, y: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const r = Math.ceil(radius / this.cellSize);
    const cx = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    for (let gy = cy - r; gy <= cy + r; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - r; gx <= cx + r; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        const bucket = this.cells[gy * this.cols + gx];
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
