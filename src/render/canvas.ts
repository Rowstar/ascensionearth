import { activateSound, playClick } from "./sfx";

export type DragPayload = {
  kind: string;
  [key: string]: unknown;
};

export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onClick?: () => void;
  onDrop?: (payload: DragPayload) => void;
  dragPayload?: DragPayload;
  cursor?: string;
}

export class CanvasApp {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  mouseX: number;
  mouseY: number;
  hoveredId?: string;
  regions: HitRegion[];
  private activeDrag?: DragPayload;
  private dragConsumed: boolean;
  onFrame?: (ctx: CanvasRenderingContext2D, dt: number, time: number) => HitRegion[];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context not available");
    }
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
    this.mouseX = 0;
    this.mouseY = 0;
    this.regions = [];
    this.activeDrag = undefined;
    this.dragConsumed = false;

    window.addEventListener("resize", () => this.resize());
    this.resize();

    canvas.addEventListener("mousemove", (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = ((event.clientX - rect.left) / rect.width) * this.width;
      this.mouseY = ((event.clientY - rect.top) / rect.height) * this.height;
      this.updateHover();
    });

    canvas.addEventListener("mousedown", () => {
      let region: HitRegion | undefined;
      for (let i = this.regions.length - 1; i >= 0; i -= 1) {
        const hit = this.regions[i];
        if (this.mouseX >= hit.x && this.mouseX <= hit.x + hit.w && this.mouseY >= hit.y && this.mouseY <= hit.y + hit.h) {
          if (hit.dragPayload) {
            region = hit;
            break;
          }
        }
      }
      if (region?.dragPayload) {
        this.activeDrag = region.dragPayload;
        this.dragConsumed = true;
      }
    });

    canvas.addEventListener("mouseup", () => {
      if (!this.activeDrag) {
        return;
      }
      let region: HitRegion | undefined;
      for (let i = this.regions.length - 1; i >= 0; i -= 1) {
        const hit = this.regions[i];
        if (this.mouseX >= hit.x && this.mouseX <= hit.x + hit.w && this.mouseY >= hit.y && this.mouseY <= hit.y + hit.h) {
          if (hit.onDrop) {
            region = hit;
            break;
          }
        }
      }
      if (region?.onDrop) {
        region.onDrop(this.activeDrag);
      }
      this.activeDrag = undefined;
    });

    canvas.addEventListener("click", () => {
      activateSound();
      if (this.dragConsumed) {
        this.dragConsumed = false;
        return;
      }
      let region: HitRegion | undefined;
      for (let i = this.regions.length - 1; i >= 0; i -= 1) {
        const hit = this.regions[i];
        if (this.mouseX >= hit.x && this.mouseX <= hit.x + hit.w && this.mouseY >= hit.y && this.mouseY <= hit.y + hit.h) {
          if (hit.onClick) {
            region = hit;
            break;
          }
        }
      }
      if (region?.onClick) {
        playClick();
        region.onClick();
      }
    });
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = this.width * ratio;
    this.canvas.height = this.height * ratio;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  updateHover(): void {
    let hovered: HitRegion | undefined;
    for (let i = this.regions.length - 1; i >= 0; i -= 1) {
      const hit = this.regions[i];
      if (this.mouseX >= hit.x && this.mouseX <= hit.x + hit.w && this.mouseY >= hit.y && this.mouseY <= hit.y + hit.h) {
        hovered = hit;
        if (hit.cursor) {
          break;
        }
      }
    }
    this.hoveredId = hovered?.id;
    this.canvas.style.cursor = hovered?.cursor ?? "default";
  }

  start(render: (ctx: CanvasRenderingContext2D, dt: number, time: number) => HitRegion[]): void {
    this.onFrame = render;
    let last = performance.now();
    const frame = (time: number) => {
      const dt = Math.min(100, time - last);
      last = time;
      if (this.onFrame) {
        this.regions = this.onFrame(this.ctx, dt, time) || [];
      }
      this.updateHover();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
