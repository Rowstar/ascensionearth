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
  private inputMode: "mouse" | "touch";
  private suppressClickUntilMs: number;
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
    this.inputMode = "mouse";
    this.suppressClickUntilMs = 0;
    this.canvas.style.touchAction = "none";

    window.addEventListener("resize", () => this.resize());
    this.resize();

    canvas.addEventListener("pointermove", (event) => {
      this.setInputMode(event.pointerType);
      this.updatePointerPosition(event.clientX, event.clientY);
      this.updateHover();
    });

    canvas.addEventListener("pointerdown", (event) => {
      this.setInputMode(event.pointerType);
      this.updatePointerPosition(event.clientX, event.clientY);
      if (this.inputMode === "touch") {
        event.preventDefault();
      }
      const region = this.hitTestRegion((hit) => !!hit.dragPayload);
      if (region?.dragPayload) {
        this.activeDrag = region.dragPayload;
        this.dragConsumed = true;
      }
    });

    canvas.addEventListener("pointerup", (event) => {
      this.setInputMode(event.pointerType);
      this.updatePointerPosition(event.clientX, event.clientY);
      if (this.inputMode === "touch") {
        event.preventDefault();
      }
      if (!this.activeDrag) {
        if (this.inputMode === "touch") {
          this.triggerClick();
          this.suppressClickUntilMs = performance.now() + 350;
        }
        return;
      }
      const region = this.hitTestRegion((hit) => !!hit.onDrop);
      if (region?.onDrop) {
        region.onDrop(this.activeDrag);
      }
      this.activeDrag = undefined;
    });

    canvas.addEventListener("pointercancel", () => {
      this.activeDrag = undefined;
      this.dragConsumed = false;
    });

    canvas.addEventListener("click", () => {
      if (performance.now() < this.suppressClickUntilMs) {
        return;
      }
      this.triggerClick();
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

  private setInputMode(pointerType: string): void {
    this.inputMode = pointerType === "mouse" ? "mouse" : "touch";
  }

  private updatePointerPosition(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = ((clientX - rect.left) / rect.width) * this.width;
    this.mouseY = ((clientY - rect.top) / rect.height) * this.height;
  }

  private interactionPadding(): number {
    if (this.inputMode !== "touch") {
      return 0;
    }
    return Math.min(this.width, this.height) < 860 ? 14 : 10;
  }

  private isPointInRegion(hit: HitRegion, padding = 0): boolean {
    return (
      this.mouseX >= hit.x - padding &&
      this.mouseX <= hit.x + hit.w + padding &&
      this.mouseY >= hit.y - padding &&
      this.mouseY <= hit.y + hit.h + padding
    );
  }

  private hitTestRegion(predicate?: (hit: HitRegion) => boolean): HitRegion | undefined {
    const padding = this.interactionPadding();
    for (let i = this.regions.length - 1; i >= 0; i -= 1) {
      const hit = this.regions[i];
      if (!this.isPointInRegion(hit, padding)) continue;
      if (!predicate || predicate(hit)) {
        return hit;
      }
    }
    return undefined;
  }

  private triggerClick(): void {
    activateSound();
    if (this.dragConsumed) {
      this.dragConsumed = false;
      return;
    }
    const region = this.hitTestRegion((hit) => !!hit.onClick);
    if (region?.onClick) {
      playClick();
      region.onClick();
    }
  }

  updateHover(): void {
    let hovered: HitRegion | undefined;
    const padding = this.interactionPadding();
    for (let i = this.regions.length - 1; i >= 0; i -= 1) {
      const hit = this.regions[i];
      if (!this.isPointInRegion(hit, padding)) continue;
      hovered = hit;
      if (hit.cursor) {
        break;
      }
    }
    this.hoveredId = hovered?.id;
    this.canvas.style.cursor = this.inputMode === "mouse" ? hovered?.cursor ?? "default" : "default";
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
