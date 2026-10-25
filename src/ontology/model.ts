// Triples → the things an ontology viewer shows: named classes, their asserted hierarchy, properties and the
// OWL restrictions that a class diagram cannot draw (those are rendered as Manchester-style text instead).
import { OWL, RDF, RDFS, SKOS, key, localName, type Term, type Triple } from "./rdf.ts";

export interface Restriction {
  property: string; // IRI
  kind: "some" | "only" | "value" | "min" | "max" | "exactly" | "self";
  filler: string; // Manchester text
  fillerIri?: string; // set when the filler is one named class
  defined: boolean; // part of an equivalentClass definition rather than a subClassOf
}

export interface OClass {
  iri: string;
  name: string;
  comment?: string;
  parents: Set<string>; // asserted named superclasses
  definedParents: Set<string>; // named conjuncts of an equivalentClass definition
  children: Set<string>;
  equivalents: string[];
  restrictions: Restriction[];
  disjoint: Set<string>;
}

export interface OProperty {
  iri: string;
  name: string;
  kind: "object" | "data";
  domains: string[];
  ranges: string[];
  inverse?: string;
  characteristics: string[];
}

export interface Ontology {
  title: string;
  comment?: string;
  classes: Map<string, OClass>;
  properties: Map<string, OProperty>;
  tripleCount: number;
}

const THING = OWL + "Thing";
const CLASS_TYPES = new Set([OWL + "Class", RDFS + "Class"]);
const CHARACTERISTICS: Record<string, string> = {
  FunctionalProperty: "functional",
  InverseFunctionalProperty: "inverse functional",
  TransitiveProperty: "transitive",
  SymmetricProperty: "symmetric",
  AsymmetricProperty: "asymmetric",
  ReflexiveProperty: "reflexive",
  IrreflexiveProperty: "irreflexive",
};

export function buildOntology(triples: Triple[], fallbackTitle = "Ontology"): Ontology {
  const bySubject = new Map<string, Triple[]>();
  for (const tr of triples) {
    const k = key(tr.s);
    let list = bySubject.get(k);
    if (!list) bySubject.set(k, (list = []));
    list.push(tr);
  }
  const objects = (s: Term, p: string): Term[] => (bySubject.get(key(s)) ?? []).filter((t) => t.p === p).map((t) => t.o);
  const one = (s: Term, p: string): Term | undefined => objects(s, p)[0];
  const types = (s: Term) => objects(s, RDF + "type").map((o) => o.v);

  // A readable label: an English or untagged rdfs:label / skos:prefLabel, else the IRI's local name.
  const labels = new Map<string, string>();
  for (const tr of triples) {
    if ((tr.p !== RDFS + "label" && tr.p !== SKOS + "prefLabel") || tr.o.t !== "lit" || tr.s.t !== "iri") continue;
    const lang = tr.o.lang?.toLowerCase();
    if (!lang || lang.startsWith("en")) {
      if (!labels.has(tr.s.v) || !lang) labels.set(tr.s.v, tr.o.v);
    }
  }
  const nameOf = (iri: string) => labels.get(iri) ?? localName(iri);

  const list = (head: Term | undefined): Term[] => {
    const out: Term[] = [];
    for (let guard = 0; head && head.t === "bnode" && guard < 10000; guard++) {
      const first = one(head, RDF + "first");
      if (first) out.push(first);
      head = one(head, RDF + "rest");
    }
    return out;
  };

  const restrictionOf = (b: Term, defined: boolean): Restriction | null => {
    const prop = one(b, OWL + "onProperty");
    if (!prop || prop.t !== "iri") return null;
    const filler = (t: Term | undefined) => (t ? text(t) : "Thing");
    const fillerIri = (t: Term | undefined) => (t?.t === "iri" && t.v !== THING ? t.v : undefined);
    const qualified = one(b, OWL + "onClass") ?? one(b, OWL + "onDataRange");
    const pairs: [string, Restriction["kind"]][] = [
      [OWL + "someValuesFrom", "some"],
      [OWL + "allValuesFrom", "only"],
      [OWL + "hasValue", "value"],
    ];
    for (const [p, kind] of pairs) {
      const o = one(b, p);
      if (o) return { property: prop.v, kind, filler: filler(o), fillerIri: fillerIri(o), defined };
    }
    const cards: [string, Restriction["kind"]][] = [
      [OWL + "minCardinality", "min"],
      [OWL + "minQualifiedCardinality", "min"],
      [OWL + "maxCardinality", "max"],
      [OWL + "maxQualifiedCardinality", "max"],
      [OWL + "cardinality", "exactly"],
      [OWL + "qualifiedCardinality", "exactly"],
    ];
    for (const [p, kind] of cards) {
      const o = one(b, p);
      if (o) return { property: prop.v, kind, filler: `${o.v}${qualified ? " " + filler(qualified) : ""}`, fillerIri: fillerIri(qualified), defined };
    }
    if (one(b, OWL + "hasSelf")) return { property: prop.v, kind: "self", filler: "", defined };
    return null;
  };

  // Class expressions in Manchester syntax, the way Protégé prints them.
  const text = (t: Term, depth = 0): string => {
    if (t.t === "iri") return t.v === THING ? "Thing" : nameOf(t.v);
    if (t.t === "lit") return JSON.stringify(t.v);
    if (depth > 12) return "…";
    const wrap = (s: string) => (depth > 0 ? `(${s})` : s);
    const r = restrictionOf(t, false);
    if (r) return wrap(`${nameOf(r.property)} ${r.kind}${r.filler ? " " + r.filler : ""}`);
    const and = one(t, OWL + "intersectionOf");
    if (and) return wrap(list(and).map((x) => text(x, depth + 1)).join(" and "));
    const or = one(t, OWL + "unionOf");
    if (or) return wrap(list(or).map((x) => text(x, depth + 1)).join(" or "));
    const not = one(t, OWL + "complementOf");
    if (not) return "not " + text(not, depth + 1);
    const oneOf = one(t, OWL + "oneOf");
    if (oneOf) return "{" + list(oneOf).map((x) => text(x, depth + 1)).join(", ") + "}";
    return "anonymous class";
  };

  const classes = new Map<string, OClass>();
  const cls = (iri: string): OClass => {
    let c = classes.get(iri);
    if (!c) {
      c = { iri, name: nameOf(iri), parents: new Set(), definedParents: new Set(), children: new Set(), equivalents: [], restrictions: [], disjoint: new Set() };
      classes.set(iri, c);
    }
    return c;
  };

  for (const tr of triples) {
    if (tr.s.t !== "iri" || tr.s.v === THING) continue;
    if (tr.p === RDF + "type" && CLASS_TYPES.has(tr.o.v)) cls(tr.s.v);
    if (tr.p === RDFS + "subClassOf" || tr.p === OWL + "equivalentClass" || tr.p === OWL + "disjointWith") cls(tr.s.v);
  }

  for (const c of [...classes.values()]) {
    const s: Term = { t: "iri", v: c.iri };
    for (const sup of objects(s, RDFS + "subClassOf")) {
      if (sup.t === "iri") {
        if (sup.v !== THING && sup.v !== c.iri) c.parents.add(cls(sup.v).iri);
      } else if (sup.t === "bnode") {
        const r = restrictionOf(sup, false);
        if (r) c.restrictions.push(r);
        else c.equivalents.push("⊑ " + text(sup));
      }
    }
    for (const eq of objects(s, OWL + "equivalentClass")) {
      if (eq.t === "iri") {
        c.equivalents.push(nameOf(eq.v));
        continue;
      }
      c.equivalents.push(text(eq));
      const r = restrictionOf(eq, true);
      if (r) c.restrictions.push(r);
      for (const part of list(one(eq, OWL + "intersectionOf"))) {
        if (part.t === "iri" && part.v !== THING && part.v !== c.iri) c.definedParents.add(cls(part.v).iri);
        else if (part.t === "bnode") {
          const pr = restrictionOf(part, true);
          if (pr) c.restrictions.push(pr);
        }
      }
    }
    for (const d of objects(s, OWL + "disjointWith")) if (d.t === "iri") c.disjoint.add(d.v);
    const comment = one(s, RDFS + "comment") ?? one(s, SKOS + "definition");
    if (comment?.t === "lit") c.comment = comment.v;
  }
  // owl:AllDisjointClasses
  for (const tr of triples) {
    if (tr.p !== RDF + "type" || tr.o.v !== OWL + "AllDisjointClasses") continue;
    const members = list(one(tr.s, OWL + "members")).filter((m) => m.t === "iri").map((m) => m.v);
    for (const a of members) for (const b of members) if (a !== b && classes.has(a)) classes.get(a)!.disjoint.add(b);
  }
  for (const c of classes.values()) for (const p of [...c.parents, ...c.definedParents]) classes.get(p)?.children.add(c.iri);

  const properties = new Map<string, OProperty>();
  for (const tr of triples) {
    if (tr.p !== RDF + "type" || tr.s.t !== "iri") continue;
    const kind = tr.o.v === OWL + "ObjectProperty" ? "object" : tr.o.v === OWL + "DatatypeProperty" ? "data" : null;
    if (!kind || properties.has(tr.s.v)) continue;
    const named = (ts: Term[]) => ts.flatMap((o) => (o.t === "iri" ? [o.v] : list(one(o, OWL + "unionOf")).filter((m) => m.t === "iri").map((m) => m.v)));
    const inverse = one(tr.s, OWL + "inverseOf");
    properties.set(tr.s.v, {
      iri: tr.s.v,
      name: nameOf(tr.s.v),
      kind,
      domains: named(objects(tr.s, RDFS + "domain")),
      ranges: named(objects(tr.s, RDFS + "range")),
      inverse: inverse?.t === "iri" ? inverse.v : undefined,
      characteristics: types(tr.s).flatMap((t) => (t.startsWith(OWL) && CHARACTERISTICS[t.slice(OWL.length)] ? [CHARACTERISTICS[t.slice(OWL.length)]] : [])),
    });
  }

  const ontologyNode = triples.find((t) => t.p === RDF + "type" && t.o.v === OWL + "Ontology")?.s;
  const lit = (p: string) => {
    if (!ontologyNode) return undefined;
    const o = objects(ontologyNode, p).find((x) => x.t === "lit" && (!x.lang || x.lang.startsWith("en"))) ?? one(ontologyNode, p);
    return o?.t === "lit" ? o.v : undefined;
  };
  const dcTitle = lit("http://purl.org/dc/elements/1.1/title") ?? lit("http://purl.org/dc/terms/title") ?? lit(RDFS + "label");
  const named = ontologyNode?.t === "iri" && !ontologyNode.v.startsWith("urn:ontolive") ? localName(ontologyNode.v.replace(/[#/]$/, "")).replace(/\.(owl|ttl|rdf)$/, "") : fallbackTitle;
  const title = dcTitle ?? named.charAt(0).toUpperCase() + named.slice(1);

  return { title, comment: lit(RDFS + "comment"), classes, properties, tripleCount: triples.length };
}

/** Classes with no named superclass: the top of the asserted hierarchy. */
export function roots(o: Ontology): OClass[] {
  return [...o.classes.values()].filter((c) => c.parents.size === 0 && c.definedParents.size === 0);
}
