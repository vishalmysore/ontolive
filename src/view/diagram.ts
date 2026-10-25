// The view: pick a neighbourhood of the ontology and write it as a Mermaid classDiagram.
// Nothing here is drawn; Pele (or Mermaid.js) turns the text into SVG.
import { roots, type Ontology } from "../ontology/model.ts";

export interface ViewOptions {
  focus: string | null; // class IRI, or null for the top of the hierarchy
  depth: number; // hops from the focus, or hierarchy levels below the roots
  properties: boolean; // object properties as domain → range associations
  restrictions: boolean; // "some"/"only" restrictions as dashed edges
  attributes: boolean; // datatype properties listed inside the class box
  direction: "TB" | "LR" | "BT" | "RL";
  maxNodes: number;
}

export interface View {
  text: string;
  classes: string[]; // IRIs in the diagram
  idToIri: Map<string, string>;
  total: number; // how many classes the depth would reach before the cap
  edges: number;
}

type Kind = "sub" | "prop" | "restr";
interface Edge {
  from: string;
  to: string;
  kind: Kind;
  label: string;
}

function edgesOf(o: Ontology, opt: ViewOptions): Edge[] {
  const out: Edge[] = [];
  for (const c of o.classes.values()) {
    for (const p of c.parents) out.push({ from: c.iri, to: p, kind: "sub", label: "" });
    for (const p of c.definedParents) if (!c.parents.has(p)) out.push({ from: c.iri, to: p, kind: "sub", label: "" });
  }
  if (opt.properties)
    for (const p of o.properties.values()) {
      if (p.kind !== "object") continue;
      for (const d of p.domains) for (const r of p.ranges) if (o.classes.has(d) && o.classes.has(r)) out.push({ from: d, to: r, kind: "prop", label: p.name });
    }
  if (opt.restrictions)
    for (const c of o.classes.values())
      for (const r of c.restrictions)
        if (r.fillerIri && o.classes.has(r.fillerIri) && (r.kind === "some" || r.kind === "only" || r.kind === "value"))
          out.push({ from: c.iri, to: r.fillerIri, kind: "restr", label: `${o.properties.get(r.property)?.name ?? r.property.split(/[#/]/).pop()} ${r.kind}` });
  return out;
}

/** Breadth-first over every edge the view shows, so a class's neighbours come before their neighbours. */
function neighbourhood(o: Ontology, edges: Edge[], opt: ViewOptions): string[] {
  const seen = new Map<string, number>();
  let frontier: string[];
  if (opt.focus && o.classes.has(opt.focus)) {
    frontier = [opt.focus];
    const adj = new Map<string, string[]>();
    const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    for (const e of edges) {
      link(e.from, e.to);
      link(e.to, e.from);
    }
    seen.set(opt.focus, 0);
    for (let d = 1; d <= opt.depth; d++) {
      const next: string[] = [];
      for (const n of frontier) for (const m of adj.get(n) ?? []) if (!seen.has(m)) seen.set(m, d), next.push(m);
      frontier = next;
    }
  } else {
    // Overview: the roots and `depth` levels of subclasses below them.
    frontier = roots(o).map((c) => c.iri).sort((a, b) => o.classes.get(a)!.name.localeCompare(o.classes.get(b)!.name));
    for (const r of frontier) seen.set(r, 0);
    for (let d = 1; d <= opt.depth; d++) {
      const next: string[] = [];
      for (const n of frontier) for (const m of o.classes.get(n)!.children) if (!seen.has(m)) seen.set(m, d), next.push(m);
      frontier = next;
    }
  }
  return [...seen.keys()];
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=\d)/, "_") || "_";
const quote = (s: string) => s.replace(/["`{}<>]/g, "'").replace(/\s+/g, " ").trim();

export function buildView(o: Ontology, opt: ViewOptions): View {
  const edges = edgesOf(o, opt);
  const reached = neighbourhood(o, edges, opt);
  const keep = new Set(reached.slice(0, opt.maxNodes));

  const ids = new Map<string, string>();
  const idToIri = new Map<string, string>();
  for (const iri of keep) {
    const c = o.classes.get(iri)!;
    let id = safe(c.name);
    for (let n = 2; idToIri.has(id); n++) id = safe(c.name) + "_" + n;
    ids.set(iri, id);
    idToIri.set(id, iri);
  }

  const lines = ["classDiagram", `  direction ${opt.direction}`];
  const attrs = new Map<string, string[]>();
  if (opt.attributes)
    for (const p of o.properties.values())
      if (p.kind === "data")
        for (const d of p.domains)
          if (keep.has(d)) (attrs.get(d) ?? attrs.set(d, []).get(d)!).push(`+${safe(p.name)} ${safe(p.ranges[0]?.split(/[#/]/).pop() ?? "literal")}`);

  for (const iri of keep) {
    const c = o.classes.get(iri)!;
    const id = ids.get(iri)!;
    const cssClass = iri === opt.focus ? "focus" : c.definedParents.size ? "defined" : c.children.size === 0 ? "leaf" : "inner";
    const label = safe(c.name) === id ? "" : `["${quote(c.name)}"]`;
    lines.push(`  class ${id}${label}:::${cssClass}`);
    const members = attrs.get(iri);
    if (members?.length) lines.push(`  class ${id} {`, ...members.map((m) => "    " + m), "  }");
  }

  let count = 0;
  const drawn = new Set<string>();
  for (const e of edges) {
    if (!keep.has(e.from) || !keep.has(e.to)) continue;
    const a = ids.get(e.from)!;
    const b = ids.get(e.to)!;
    const sig = `${a}|${b}|${e.kind}|${e.label}`;
    if (drawn.has(sig)) continue;
    drawn.add(sig);
    count++;
    if (e.kind === "sub") lines.push(`  ${b} <|-- ${a}`);
    else if (e.kind === "prop") lines.push(`  ${a} --> ${b} : ${quote(e.label)}`);
    else lines.push(`  ${a} ..> ${b} : ${quote(e.label)}`);
  }

  return { text: lines.join("\n"), classes: [...keep], idToIri, total: reached.length, edges: count };
}
