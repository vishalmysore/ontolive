import { loadOntology } from "./ontology/load.ts";
import type { OClass, Ontology } from "./ontology/model.ts";
import { buildView, type View, type ViewOptions } from "./view/diagram.ts";
import { Stage, type Drawn, type Engine } from "./view/renderers.ts";
import { factsToMermaid, factsToTurtle, parseFacts, SYSTEM_PROMPT, type Extracted } from "./llm/extract.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const PIZZA = "https://raw.githubusercontent.com/owlcs/pizza-ontology/master/pizza.owl";
const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

// ---------------------------------------------------------------- tabs

for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]"))
  tab.onclick = () => {
    for (const t of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) t.setAttribute("aria-selected", String(t === tab));
    $("explore").hidden = tab.dataset.tab !== "explore";
    $("grow").hidden = tab.dataset.tab !== "grow";
  };

// ---------------------------------------------------------------- render statistics

class Stats {
  count = 0;
  total = 0;
  last: Drawn | null = null;
  constructor(
    private el: HTMLElement,
    private stage: Stage,
    private extra: () => string,
  ) {}
  reset() {
    this.count = this.total = 0;
    this.stage.skipped = 0;
  }
  add(d: Drawn, engine: Engine) {
    if (d.ok) {
      this.count++;
      this.total += d.ms;
    }
    this.last = d;
    const cls = d.ms < 16 ? "fast" : d.ms > 100 ? "slow" : "";
    const avg = this.count ? this.total / this.count : 0;
    const skipped = this.stage.skipped ? ` · <span class="slow">${this.stage.skipped} updates dropped</span>` : "";
    this.el.innerHTML = `${engine === "pele" ? "Pele" : "Mermaid.js"} <b class="${cls}">${d.ms.toFixed(1)} ms</b> · avg ${avg.toFixed(1)} ms over ${this.count}${skipped}${this.extra()}`;
  }
}

// ---------------------------------------------------------------- explorer

let onto: Ontology | null = null;
let view: View | null = null;
let sourceName = "";
const opts: ViewOptions = { focus: null, depth: 2, properties: true, restrictions: false, attributes: true, direction: "LR", maxNodes: 250 };

const stageEl = $("stage");
const stage = new Stage(stageEl, (d, e) => {
  stats.add(d, e);
  $("stage-error").hidden = d.ok;
  if (!d.ok) $("stage-error").textContent = d.error ?? "";
});
const stats = new Stats($("hud"), stage, () => (view ? ` · ${view.classes.length}${view.total > view.classes.length ? "/" + view.total : ""} classes · ${view.edges} edges` : ""));

function redraw() {
  if (!onto) return;
  view = buildView(onto, opts);
  stage.draw(view.text);
  $("src").textContent = view.text;
  $("src-size").textContent = `${view.text.split("\n").length} lines`;
  $("depth-help").textContent = opts.focus
    ? `Hops out from ${onto.classes.get(opts.focus)?.name}, along every edge shown.`
    : "Levels below the top of the hierarchy.";
  for (const b of document.querySelectorAll<HTMLButtonElement>("#class-list button")) b.classList.toggle("on", b.dataset.iri === opts.focus);
  writeHash();
}

function show(o: Ontology, name: string) {
  onto = o;
  sourceName = name;
  opts.focus = null;
  const objectProps = [...o.properties.values()].filter((p) => p.kind === "object").length;
  $("onto-status").innerHTML = `<b>${esc(o.title)}</b>: ${o.classes.size} classes, ${objectProps} object and ${o.properties.size - objectProps} datatype properties, ${o.tripleCount.toLocaleString()} triples.`;
  listClasses();
  details(null);
  stats.reset();
  readHash();
  redraw();
}

async function loadText(text: string, name: string, base?: string) {
  const t = performance.now();
  try {
    const o = loadOntology(text, name, parseXml, base);
    show(o, name);
    $("onto-status").innerHTML += ` Parsed in ${(performance.now() - t).toFixed(0)} ms.`;
  } catch (e) {
    $("onto-status").innerHTML = `<span class="error">Could not read ${esc(name)}: ${esc((e as Error).message)}</span>`;
  }
}

async function loadUrl(url: string, name = url.split("/").pop() || "ontology") {
  $("onto-status").textContent = `Fetching ${name}…`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadText(await res.text(), name, url.startsWith("http") ? url : undefined);
  } catch (e) {
    $("onto-status").innerHTML = `<span class="error">Could not fetch ${esc(name)} (${esc((e as Error).message)}). The server may not allow cross-origin requests; download the file and drop it here instead.</span>`;
  }
}

$("load-pizza").onclick = () => loadUrl(PIZZA, "pizza.owl");
$("load-family").onclick = () => loadUrl("./samples/family.ttl", "family.ttl");
$("url-form").onsubmit = (e) => {
  e.preventDefault();
  const u = $<HTMLInputElement>("url").value.trim();
  if (u) void loadUrl(u);
};
const readFile = async (f: File) => loadText(await f.text(), f.name);
$<HTMLInputElement>("file").onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void readFile(f);
};
addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("dragging");
});
addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files[0];
  if (f) {
    (document.querySelector('[data-tab="explore"]') as HTMLButtonElement).click();
    void readFile(f);
  }
});

// view controls: every change redraws immediately; that is the point of a synchronous renderer
const depth = $<HTMLInputElement>("depth");
depth.oninput = () => {
  opts.depth = Number(depth.value);
  $("depth-val").textContent = depth.value;
  redraw();
};
const bindCheck = (id: string, key: "properties" | "restrictions" | "attributes") =>
  ($<HTMLInputElement>(id).onchange = (e) => {
    opts[key] = (e.target as HTMLInputElement).checked;
    redraw();
  });
bindCheck("opt-props", "properties");
bindCheck("opt-restr", "restrictions");
bindCheck("opt-attrs", "attributes");
$<HTMLSelectElement>("direction").onchange = (e) => {
  opts.direction = (e.target as HTMLSelectElement).value as ViewOptions["direction"];
  redraw();
};
$<HTMLSelectElement>("max-nodes").onchange = (e) => {
  opts.maxNodes = Number((e.target as HTMLSelectElement).value);
  redraw();
};
$("to-top").onclick = () => focus(null);

function focus(iri: string | null) {
  opts.focus = iri;
  details(iri ? onto!.classes.get(iri)! : null);
  redraw();
}

// click a class in the diagram: Pele puts the class id on data-id; Mermaid on id="<render>-classId-<name>-<n>"
stageEl.addEventListener("click", (e) => {
  const node = (e.target as Element).closest("[data-id], g.node[id*='classId-']");
  if (!node || !view) return;
  const id = node.getAttribute("data-id") ?? node.id.match(/classId-(.+)-\d+$/)?.[1] ?? "";
  const iri = view.idToIri.get(id);
  if (iri) focus(iri);
});

function listClasses() {
  const q = $<HTMLInputElement>("search").value.trim().toLowerCase();
  const all = [...onto!.classes.values()].sort((a, b) => a.name.localeCompare(b.name));
  const hits = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
  $("class-list").innerHTML = hits
    .slice(0, 400)
    .map((c) => `<li><button data-iri="${esc(c.iri)}" class="${c.iri === opts.focus ? "on" : ""}">${esc(c.name)}<span class="n">${c.children.size || ""}</span></button></li>`)
    .join("");
}
$("search").oninput = listClasses;
$("class-list").onclick = (e) => {
  const b = (e.target as Element).closest("button");
  if (b?.dataset.iri) focus(b.dataset.iri);
};

function details(c: OClass | null) {
  const el = $("details");
  if (!c || !onto) {
    el.innerHTML = `<div class="card"><p class="muted">Click a class in the diagram or the list to focus on it. OWL restrictions, definitions and disjointness are listed here, because a class diagram cannot draw them.</p></div>`;
    return;
  }
  const o = onto;
  const chip = (iri: string) => `<button class="chip" data-iri="${esc(iri)}">${esc(o.classes.get(iri)?.name ?? iri.split(/[#/]/).pop()!)}</button>`;
  const chips = (iris: Iterable<string>, limit = 30) => {
    const list = [...iris].sort((a, b) => (o.classes.get(a)?.name ?? a).localeCompare(o.classes.get(b)?.name ?? b));
    if (!list.length) return `<span class="muted small">none</span>`;
    return `<div class="chips">${list.slice(0, limit).map(chip).join("")}${list.length > limit ? `<span class="chip more muted">+${list.length - limit}</span>` : ""}</div>`;
  };
  const propName = (iri: string) => o.properties.get(iri)?.name ?? iri.split(/[#/]/).pop();
  const axioms = c.restrictions
    .map((r) => `<li>${esc(propName(r.property)!)} <span class="kw">${r.kind}</span> ${esc(r.filler)}${r.defined ? ' <span class="def">definition</span>' : ""}</li>`)
    .join("");
  const domainOf = [...o.properties.values()].filter((p) => p.domains.includes(c.iri));
  el.innerHTML = `<div class="card">
    <div><h3>${esc(c.name)}</h3><div class="iri">${esc(c.iri)}</div></div>
    ${c.comment ? `<p>${esc(c.comment)}</p>` : ""}
    <div><h2>Superclasses</h2>${chips([...c.parents, ...c.definedParents])}</div>
    <div><h2>Subclasses (${c.children.size})</h2>${chips(c.children)}</div>
    ${c.equivalents.length ? `<div><h2>Equivalent to</h2><ul class="axioms">${c.equivalents.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
    ${axioms ? `<div><h2>Restrictions</h2><ul class="axioms">${axioms}</ul></div>` : ""}
    ${domainOf.length ? `<div><h2>Properties from here</h2><ul class="axioms">${domainOf.map((p) => `<li>${esc(p.name)} <span class="kw">${p.kind === "object" ? "→" : ":"}</span> ${esc(p.ranges.map((r) => o.classes.get(r)?.name ?? r.split(/[#/]/).pop()).join(" or ") || "—")}${p.characteristics.length ? ` <span class="def">${p.characteristics.join(", ")}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
    <div><h2>Disjoint with (${c.disjoint.size})</h2>${chips(c.disjoint, 12)}</div>
  </div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-iri]").forEach((b) => (b.onclick = () => o.classes.has(b.dataset.iri!) && focus(b.dataset.iri!)));
}

// engine toggle
function setEngine(engine: Engine, which: "explore" | "grow") {
  const target = which === "explore" ? stage : stage2;
  target.engine = engine;
  const attr = which === "explore" ? "data-engine" : "data-engine2";
  for (const b of document.querySelectorAll<HTMLButtonElement>(`[${attr}]`)) b.setAttribute("aria-pressed", String(b.getAttribute(attr) === engine));
  if (which === "explore") {
    stats.reset();
    redraw();
  } else {
    stats2.reset();
    if (lastFacts) stage2.draw(factsToMermaid(lastFacts));
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-engine]")) b.onclick = () => setEngine(b.dataset.engine as Engine, "explore");

// sweep: animate the slider on every frame, for screen recordings and to make the renderer's speed visible
let sweeping = 0;
$("sweep").onclick = () => {
  if (sweeping) {
    cancelAnimationFrame(sweeping);
    sweeping = 0;
    $("sweep").textContent = "▶ Sweep depth";
    return;
  }
  if (!onto) return;
  $("sweep").textContent = "■ Stop";
  stats.reset();
  const max = Number(depth.max);
  let start = 0;
  const tick = (t: number) => {
    start ||= t;
    const phase = ((t - start) / 4500) % 1; // 0 → max → 0 every 4.5 s
    const d = Math.round(max * (1 - Math.abs(1 - 2 * phase)) * 0.75);
    if (d !== opts.depth) {
      depth.value = String(d);
      depth.dispatchEvent(new Event("input"));
    }
    sweeping = requestAnimationFrame(tick);
  };
  sweeping = requestAnimationFrame(tick);
};

// race: same text, both renderers, measured here
$("race").onclick = async () => {
  if (!view) return;
  const out = $("race-out");
  out.hidden = false;
  out.innerHTML = "Loading Mermaid.js…";
  await stage.loadMermaid();
  const runs = 20;
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const times: Record<Engine, number[]> = { pele: [], mermaid: [] };
  for (const engine of ["pele", "mermaid"] as Engine[])
    for (let i = 0; i < runs; i++) {
      out.innerHTML = `Rendering ${view.classes.length} classes with ${engine === "pele" ? "Pele" : "Mermaid.js"}: ${i + 1}/${runs}`;
      try {
        times[engine].push(await stage.time(engine, view.text));
      } catch (e) {
        out.innerHTML = `<span class="error">${engine} failed: ${esc((e as Error).message)}</span>`;
        return;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  const p = median(times.pele);
  const m = median(times.mermaid);
  const w = (x: number) => `${Math.max(1, (x / Math.max(p, m)) * 100)}%`;
  out.innerHTML = `<b>${view.classes.length} classes, ${view.edges} edges, median of ${runs} renders in this browser</b>
    <div>Pele ${p.toFixed(1)} ms</div><div class="bar" style="width:${w(p)}"></div>
    <div>Mermaid.js ${m.toFixed(1)} ms</div><div class="bar m" style="width:${w(m)}"></div>
    <div class="muted small">Pele was ${(m / p).toFixed(0)}× faster on this diagram. Try a bigger depth for a bigger gap.</div>`;
};

$("copy-src").onclick = () => navigator.clipboard.writeText($("src").textContent ?? "");
$("dl-svg").onclick = () => {
  const svg = stageEl.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // bake the theme in, so the file looks the same outside this page
  const cs = getComputedStyle(stageEl);
  const vars = ["--pele-bg", "--pele-fg", "--pele-muted", "--pele-line", "--pele-surface", "--pele-surface-alt", "--pele-border", "--pele-accent", "--pele-font", "--pele-radius"];
  clone.setAttribute("style", (clone.getAttribute("style") ?? "") + ";" + vars.map((v) => `${v}:${cs.getPropertyValue(v)}`).join(";"));
  const css = `.focus>rect{fill:${cs.getPropertyValue("--gold-soft")};stroke:${cs.getPropertyValue("--gold")};stroke-width:2.5}.bad>rect{fill:${cs.getPropertyValue("--bad-soft")};stroke:${cs.getPropertyValue("--bad")}}.defined>rect{stroke-dasharray:5 3}`;
  clone.insertAdjacentHTML("afterbegin", `<style>${css}</style><rect width="100%" height="100%" fill="${cs.getPropertyValue("--stage")}"/>`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([clone.outerHTML], { type: "image/svg+xml" }));
  a.download = `${(onto?.title ?? "ontology").replace(/\W+/g, "-")}${opts.focus ? "-" + onto!.classes.get(opts.focus)!.name : ""}.svg`;
  a.click();
};

// shareable state: #src=pizza&focus=Margherita&depth=2
function writeHash() {
  if (!onto) return;
  const p = new URLSearchParams();
  if (sourceName === "pizza.owl") p.set("src", "pizza");
  else if (sourceName === "family.ttl") p.set("src", "family");
  if (opts.focus) p.set("focus", onto.classes.get(opts.focus)!.name);
  p.set("depth", String(opts.depth));
  history.replaceState(null, "", "#" + p.toString());
}
let hashRead = false;
function readHash() {
  if (hashRead || !onto) return;
  hashRead = true;
  const p = new URLSearchParams(location.hash.slice(1));
  const d = p.get("depth");
  if (d !== null) {
    opts.depth = Math.min(8, Math.max(0, Number(d) || 0));
    depth.value = String(opts.depth);
    $("depth-val").textContent = depth.value;
  }
  const f = p.get("focus");
  const c = f && [...onto.classes.values()].find((x) => x.name === f);
  if (c) {
    opts.focus = c.iri;
    details(c);
  }
}

// ---------------------------------------------------------------- the LLM tab

const SAMPLES: [string, string][] = [
  [
    "Hospital",
    "A hospital employs doctors and nurses. Surgeons and pediatricians are kinds of doctors. Patients are admitted to wards and are treated by doctors. Every admission records a date and a diagnosis. Nurses are assigned to wards, and each ward belongs to a department such as cardiology or oncology.",
  ],
  [
    "Space missions",
    "A space agency launches missions. Crewed missions carry astronauts, while robotic missions carry instruments. Rovers and orbiters are spacecraft. Each mission uses a launch vehicle and targets a celestial body such as a planet, a moon or an asteroid. Astronauts have a name and a nationality.",
  ],
  [
    "A trap for the model",
    "In a small startup every manager is an employee, and every team lead is a manager. Because the startup is so small, people often say that a manager is really just a team lead. Employees report to managers. Managers manage teams, and each team owns projects.",
  ],
  ["Write your own", ""],
];
const sampleSel = $<HTMLSelectElement>("sample");
sampleSel.innerHTML = SAMPLES.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("");
const para = $<HTMLTextAreaElement>("para");
para.value = SAMPLES[0][1];
sampleSel.onchange = () => (para.value = SAMPLES[Number(sampleSel.value)][1]);

const stage2El = $("stage2");
const stage2 = new Stage(stage2El, (d, e) => stats2.add(d, e));
let lastFacts: Extracted | null = null;
let tokens = 0;
const stats2 = new Stats($("hud2"), stage2, () => (lastFacts ? ` · ${lastFacts.classes.size} classes · ${tokens} chunks` : ""));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-engine2]")) b.onclick = () => setEngine(b.dataset.engine2 as Engine, "grow");

function showFacts(ex: Extracted) {
  lastFacts = ex;
  stage2.draw(factsToMermaid(ex));
  const serious = ex.issues.filter((i) => i.kind !== "unparsed" && i.kind !== "undeclared").length;
  $("issue-count").textContent = serious ? String(serious) : "";
  $("issues").innerHTML = ex.issues.length
    ? ex.issues.map((i) => `<li class="${i.kind}">${esc(i.text)}</li>`).join("")
    : ex.classes.size
      ? `<li class="ok">No problems so far.</li>`
      : "";
}

type ModelModule = typeof import("./llm/engine.ts");
let llm: ModelModule | null = null;
let model: import("./llm/engine.ts").Model | null = null;

async function initModels() {
  llm = await import("./llm/engine.ts");
  const sel = $<HTMLSelectElement>("model");
  const { ids, preferred } = llm.modelChoices();
  sel.innerHTML = ids.map((id) => `<option${id === preferred ? " selected" : ""}>${id}</option>`).join("");
  if (!llm.hasWebGPU()) {
    $("llm-status").innerHTML = `<span class="error">This browser has no WebGPU, so the model cannot run here. Try a recent Chrome or Edge on a desktop.</span>`;
    $<HTMLButtonElement>("run").disabled = true;
  }
}
void initModels();

$("run").onclick = async () => {
  if (!llm) return;
  const run = $<HTMLButtonElement>("run");
  const stop = $<HTMLButtonElement>("stop");
  const id = $<HTMLSelectElement>("model").value;
  run.disabled = true;
  try {
    if (!model || model.id !== id) {
      const bar = $("progress-bar");
      (bar.parentElement as HTMLElement).hidden = false;
      model = await llm.Model.load(id, (text, f) => {
        $("llm-status").textContent = text;
        bar.style.width = `${Math.round(f * 100)}%`;
      });
      (bar.parentElement as HTMLElement).hidden = true;
      run.textContent = "Build ontology";
    }
    stop.disabled = false;
    stats2.reset();
    tokens = 0;
    stage2El.innerHTML = "";
    $("raw").textContent = "";
    $("llm-status").textContent = "Writing…";
    const result = await model.stream(SYSTEM_PROMPT, `Paragraph: "${para.value.trim()}"\nAnswer:`, (text) => {
      tokens++;
      $("raw").textContent = text;
      showFacts(parseFacts(text));
    });
    showFacts(parseFacts(result.text, true));
    $("llm-status").textContent = `${result.tokens} tokens in ${result.seconds.toFixed(1)} s (${(result.tokens / result.seconds).toFixed(1)} tok/s). The diagram was redrawn ${tokens} times.`;
    $<HTMLButtonElement>("to-explorer").disabled = $<HTMLButtonElement>("dl-ttl").disabled = !lastFacts?.classes.size;
  } catch (e) {
    $("llm-status").innerHTML = `<span class="error">${esc((e as Error).message)}</span>`;
  } finally {
    run.disabled = false;
    stop.disabled = true;
  }
};
$("stop").onclick = () => model?.interrupt();

$("dl-ttl").onclick = () => {
  if (!lastFacts) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([factsToTurtle(lastFacts)], { type: "text/turtle" }));
  a.download = "extracted-ontology.ttl";
  a.click();
};
$("to-explorer").onclick = () => {
  if (!lastFacts) return;
  (document.querySelector('[data-tab="explore"]') as HTMLButtonElement).click();
  void loadText(factsToTurtle(lastFacts), "extracted.ttl");
};

// ---------------------------------------------------------------- start

const startSrc = new URLSearchParams(location.hash.slice(1)).get("src");
if (startSrc === "pizza") void loadUrl(PIZZA, "pizza.owl");
else void loadUrl("./samples/family.ttl", "family.ttl");
