/**
 * input.ts
 * -----------------------------------------------------------------------------
 * Canvas interaction: translates raw mouse/wheel/touch events into high-level
 * intents (pick an organism, pan the camera, zoom, hover) and forwards them via
 * callbacks. Keeping this out of main.ts and the renderer keeps both focused.
 *
 * Click-vs-drag is disambiguated by movement distance: a press-and-release that
 * barely moves is a "pick" (select the organism under the cursor); a press that
 * moves is a pan.
 * -----------------------------------------------------------------------------
 */
const DRAG_THRESHOLD = 4; // CSS px of movement before a press becomes a pan
export class InputController {
    constructor(canvas, camera, handlers) {
        this.canvas = canvas;
        this.camera = camera;
        this.handlers = handlers;
        this.dragging = false;
        this.moved = 0;
        this.lastX = 0;
        this.lastY = 0;
        this.attach();
    }
    /** CSS-pixel coordinates of an event relative to the canvas. */
    localPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    attach() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.dragging = true;
            this.moved = 0;
            const p = this.localPoint(e);
            this.lastX = p.x;
            this.lastY = p.y;
        });
        window.addEventListener('mousemove', (e) => {
            const p = this.localPoint(e);
            if (this.dragging) {
                const dx = p.x - this.lastX;
                const dy = p.y - this.lastY;
                this.moved += Math.abs(dx) + Math.abs(dy);
                this.camera.pan(dx, dy);
                this.lastX = p.x;
                this.lastY = p.y;
                this.handlers.onCameraChange();
            }
            else {
                // Only report hover when the pointer is actually over the canvas.
                const rect = this.canvas.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    this.handlers.onHover(this.camera.screenToWorld(p.x, p.y));
                }
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (!this.dragging)
                return;
            this.dragging = false;
            if (this.moved < DRAG_THRESHOLD) {
                const p = this.localPoint(e);
                this.handlers.onPick(this.camera.screenToWorld(p.x, p.y));
            }
        });
        // Wheel to zoom, anchored under the cursor.
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const p = this.localPoint(e);
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            this.camera.zoomAt(p.x, p.y, factor);
            this.handlers.onCameraChange();
        }, { passive: false });
        // Update the cursor to hint that dragging pans the view.
        this.canvas.style.cursor = 'grab';
        this.canvas.addEventListener('mousedown', () => (this.canvas.style.cursor = 'grabbing'));
        window.addEventListener('mouseup', () => (this.canvas.style.cursor = 'grab'));
    }
}
//# sourceMappingURL=input.js.map