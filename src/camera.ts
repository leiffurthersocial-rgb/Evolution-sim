/**
 * camera.ts
 * -----------------------------------------------------------------------------
 * A 2D camera (pan + zoom) that maps WORLD coordinates to SCREEN coordinates.
 *
 * The renderer draws everything in world units and lets the camera place them
 * on the canvas via a scale + translation. This is what enables:
 *   - "see the whole map at once" (fit): scale so the entire world is visible,
 *   - zooming in on a region (wheel / buttons),
 *   - panning (drag),
 * regardless of the world size versus the canvas size.
 *
 * The camera is pure math — no canvas, no DOM — so it is trivially testable and
 * reusable.
 * -----------------------------------------------------------------------------
 */

import { clamp } from './utils.js';
import type { Point } from './utils.js';

export class Camera {
  /** World units per screen pixel-inverse: screen = world * scale + offset. */
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  minScale = 0.05;
  maxScale = 12;

  /** True while the view is auto-fitted (so it re-fits on resize). */
  fitted = true;

  worldToScreenX(x: number): number {
    return x * this.scale + this.offsetX;
  }
  worldToScreenY(y: number): number {
    return y * this.scale + this.offsetY;
  }

  /** Convert a screen (canvas CSS-pixel) point to world coordinates. */
  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }

  /**
   * Fit the whole world into the given viewport (CSS pixels) and centre it.
   * `padding` leaves a margin so organisms at the edge aren't clipped.
   */
  fit(worldW: number, worldH: number, viewW: number, viewH: number, padding = 12): void {
    const s = Math.min((viewW - padding * 2) / worldW, (viewH - padding * 2) / worldH);
    this.scale = clamp(s, this.minScale, this.maxScale);
    this.offsetX = (viewW - worldW * this.scale) / 2;
    this.offsetY = (viewH - worldH * this.scale) / 2;
    this.fitted = true;
  }

  /** Zoom by `factor` while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    // Re-anchor so the same world point stays under the cursor.
    this.offsetX = sx - before.x * this.scale;
    this.offsetY = sy - before.y * this.scale;
    this.fitted = false;
  }

  /** Pan by a screen-pixel delta. */
  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.fitted = false;
  }

  /** Centre the view on a world point at the current scale (for follow-cam). */
  centerOn(worldX: number, worldY: number, viewW: number, viewH: number): void {
    this.offsetX = viewW / 2 - worldX * this.scale;
    this.offsetY = viewH / 2 - worldY * this.scale;
  }

  /** Current zoom as a percentage for the UI readout. */
  zoomPercent(): number {
    return Math.round(this.scale * 100);
  }
}
