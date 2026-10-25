// Two ways to turn the same Mermaid text into SVG, timed the same way, so the page can show the difference
// instead of quoting it. Pele is synchronous; Mermaid.js is async and is only downloaded when first chosen.
import { render as peleRender, enableZoom, type Zoom } from "pele";

export type Engine = "pele" | "mermaid";

export interface Drawn {
  ms: number;
  ok: boolean;
  error?: string;
}

export class Stage {
  engine: Engine = "pele";
  private zoom: Zoom | undefined;
  private mermaid: typeof import("mermaid").default | undefined;
  private busy = false;
  private queued: string | null = null;
  private seq = 0;
  /** Requests that arrived while Mermaid was still drawing and were replaced by a newer one. */
  skipped = 0;

  constructor(
    private host: HTMLElement,
    private onDrawn: (d: Drawn, engine: Engine) => void,
  ) {}

  private font = () => getComputedStyle(this.host).getPropertyValue("--pele-font").trim() || undefined;

  /** Draw `text`. With Pele this finishes before returning; with Mermaid the newest pending text wins. */
  draw(text: string) {
    if (this.engine === "pele") return this.drawPele(text);
    if (this.busy) {
      if (this.queued !== null) this.skipped++;
      this.queued = text;
      return;
    }
    void this.drawMermaid(text);
  }

  /** Render without touching the page: used by the speed race. */
  async time(engine: Engine, text: string): Promise<number> {
    const t = performance.now();
    if (engine === "pele") peleRender(text, { fontFamily: this.font() });
    else await (await this.loadMermaid()).render("ol-race-" + this.seq++, text);
    return performance.now() - t;
  }

  private drawPele(text: string) {
    const t = performance.now();
    try {
      const { svg } = peleRender(text, { fontFamily: this.font() });
      this.place(svg);
      this.onDrawn({ ms: performance.now() - t, ok: true }, "pele");
    } catch (e) {
      // Keep the last good diagram on screen: half-written diagrams are normal while a model streams.
      this.onDrawn({ ms: performance.now() - t, ok: false, error: (e as Error).message }, "pele");
    }
  }

  private async drawMermaid(text: string) {
    this.busy = true;
    const mermaid = await this.loadMermaid();
    const t = performance.now();
    try {
      const { svg } = await mermaid.render("ol-m-" + this.seq++, text);
      if (this.engine === "mermaid") this.place(svg);
      this.onDrawn({ ms: performance.now() - t, ok: true }, "mermaid");
    } catch (e) {
      this.onDrawn({ ms: performance.now() - t, ok: false, error: (e as Error).message }, "mermaid");
    } finally {
      this.busy = false;
      const next = this.queued;
      this.queued = null;
      if (next !== null && this.engine === "mermaid") void this.drawMermaid(next);
    }
  }

  async loadMermaid() {
    if (!this.mermaid) {
      this.mermaid = (await import("mermaid")).default;
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      this.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict", maxEdges: 2000, maxTextSize: 500000 });
    }
    return this.mermaid;
  }

  private place(svg: string) {
    this.host.innerHTML = svg;
    if (!this.zoom) this.zoom = enableZoom(this.host, { always: true, maxScale: 6 });
    else this.zoom.refresh();
  }
}
