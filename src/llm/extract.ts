// What the model writes while it reads a paragraph: one fact per line, simple enough that a 1.5B model keeps to it.
//   CLASS Dog
//   Dog ISA Mammal
//   REL Person owns Dog
//   ATTR Dog name
// Every partial stream is parsed again from the start, so the diagram grows as the lines arrive.
// The checks flag what would make the result a bad ontology: cycles in the hierarchy, a class that is its own
// parent, near-duplicate names, and relations that point at classes nobody declared.

export interface Extracted {
  classes: Map<string, { name: string; declared: boolean }>;
  isa: [child: string, parent: string][];
  rels: [from: string, rel: string, to: string][];
  attrs: Map<string, Set<string>>;
  issues: Issue[];
  bad: Map<string, string>; // class → reason, drawn red
}

export interface Issue {
  kind: "cycle" | "self" | "duplicate" | "undeclared" | "unparsed";
  text: string;
}

export const SYSTEM_PROMPT = `You turn a paragraph into a small OWL ontology.
Write one fact per line and nothing else, using exactly these forms:
CLASS <ClassName>
<ChildClass> ISA <ParentClass>
REL <ClassName> <relationName> <ClassName>
ATTR <ClassName> <attributeName>
Class names are singular CamelCase nouns. Relation and attribute names are camelCase.
Declare each class with CLASS before using it. Put general classes above specific ones.

Example paragraph: "A library lends books and magazines to members. Each loan records a due date."
Example answer:
CLASS Item
CLASS Book
CLASS Magazine
CLASS Member
CLASS Loan
Book ISA Item
Magazine ISA Item
REL Loan borrowedBy Member
REL Loan ofItem Item
ATTR Loan dueDate
ATTR Member name`;

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const camel = (s: string) =>
  s
    .replace(/[^A-Za-z0-9_ ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
const norm = (s: string) => s.toLowerCase().replace(/(ies)$/, "y").replace(/(ses|xes)$/, (m) => m.slice(0, 2)).replace(/s$/, "");

/** Parse every complete line. The last line is skipped unless `final`, because it may still be streaming. */
export function parseFacts(stream: string, final = false): Extracted {
  const lines = stream.split(/\r?\n/);
  if (!final) lines.pop();
  const ex: Extracted = { classes: new Map(), isa: [], rels: [], attrs: new Map(), issues: [], bad: new Map() };
  const touch = (raw: string, declared: boolean) => {
    const name = NAME.test(raw) ? raw.charAt(0).toUpperCase() + raw.slice(1) : camel(raw);
    if (!name) return "";
    const c = ex.classes.get(name);
    if (!c) ex.classes.set(name, { name, declared });
    else if (declared) c.declared = true;
    return name;
  };

  for (let raw of lines) {
    raw = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/[`*]/g, "").trim();
    if (!raw) continue;
    const words = raw.split(/\s+/);
    const head = words[0].toUpperCase();
    if (head === "CLASS" && words.length >= 2) {
      touch(words.slice(1).join(" "), true);
    } else if (head === "REL" && words.length >= 4) {
      ex.rels.push([touch(words[1], false), words[2].replace(/[^A-Za-z0-9_]/g, ""), touch(words.slice(3).join(" "), false)]);
    } else if (head === "ATTR" && words.length >= 3) {
      const c = touch(words[1], false);
      (ex.attrs.get(c) ?? ex.attrs.set(c, new Set()).get(c)!).add(words[2].replace(/[^A-Za-z0-9_]/g, ""));
    } else {
      const isa = raw.match(/^(.+?)\s+(?:ISA|IS_A|IS A|SUBCLASSOF|SUBCLASS OF)\s+(.+)$/i);
      if (isa) ex.isa.push([touch(isa[1], false), touch(isa[2], false)]);
      else if (ex.issues.length < 20) ex.issues.push({ kind: "unparsed", text: `Ignored line: "${raw.slice(0, 80)}"` });
    }
  }
  check(ex);
  return ex;
}

function check(ex: Extracted) {
  const flag = (c: string, why: string) => ex.bad.has(c) || ex.bad.set(c, why);
  for (const [c, p] of ex.isa)
    if (c === p) {
      ex.issues.push({ kind: "self", text: `${c} is declared a subclass of itself.` });
      flag(c, "subclass of itself");
    }

  // Cycles: walk up the ISA graph; any class we reach twice on one path closes a loop.
  const up = new Map<string, string[]>();
  for (const [c, p] of ex.isa) if (c !== p) (up.get(c) ?? up.set(c, []).get(c)!).push(p);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const p of up.get(n) ?? []) {
      if (state.get(p) === 1) {
        const loop = stack.slice(stack.indexOf(p));
        const sig = [...loop].sort().join(",");
        if (!reported.has(sig)) {
          reported.add(sig);
          ex.issues.push({ kind: "cycle", text: `Hierarchy cycle: ${[...loop, p].join(" → ")}. Nothing can be its own ancestor.` });
        }
        for (const c of loop) flag(c, "in a subclass cycle");
      } else if (!state.has(p)) visit(p);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of up.keys()) if (!state.has(n)) visit(n);

  const byNorm = new Map<string, string>();
  for (const name of ex.classes.keys()) {
    const k = norm(name);
    const other = byNorm.get(k);
    if (other && other !== name) {
      ex.issues.push({ kind: "duplicate", text: `"${other}" and "${name}" look like the same concept.` });
      flag(name, `duplicate of ${other}`);
    } else byNorm.set(k, name);
  }

  for (const c of ex.classes.values())
    if (!c.declared && ex.issues.filter((i) => i.kind === "undeclared").length < 12)
      ex.issues.push({ kind: "undeclared", text: `${c.name} is used but never declared with CLASS.` });
}

const quote = (s: string) => s.replace(/["`{}<>]/g, "'");

export function factsToMermaid(ex: Extracted, direction = "TB"): string {
  const lines = ["classDiagram", `  direction ${direction}`];
  for (const c of ex.classes.values()) {
    lines.push(`  class ${c.name}:::${ex.bad.has(c.name) ? "bad" : c.declared ? "inner" : "undeclared"}`);
    const a = ex.attrs.get(c.name);
    if (a?.size) lines.push(`  class ${c.name} {`, ...[...a].filter(Boolean).map((x) => `    +${x}`), "  }");
  }
  const seen = new Set<string>();
  for (const [c, p] of ex.isa) {
    if (!c || !p || seen.has(c + "<" + p)) continue;
    seen.add(c + "<" + p);
    lines.push(`  ${p} <|-- ${c}`);
  }
  for (const [a, r, b] of ex.rels) if (a && b) lines.push(`  ${a} --> ${b} : ${quote(r || "relatedTo")}`);
  return lines.join("\n");
}

/** Write the extracted ontology as Turtle, so it can be opened in the explorer or in Protégé. */
export function factsToTurtle(ex: Extracted, base = "https://example.org/onto#"): string {
  const out = [`@prefix : <${base}> .`, "@prefix owl: <http://www.w3.org/2002/07/owl#> .", "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .", "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .", "", ": a owl:Ontology ; rdfs:label \"Extracted ontology\" .", ""];
  for (const c of ex.classes.keys()) {
    // leave out only the offending edges: self-loops, and edges whose two ends are both flagged (a cycle)
    const parents = ex.isa.filter(([x, p]) => x === c && p && p !== c && !(ex.bad.has(c) && ex.bad.has(p))).map(([, p]) => ":" + p);
    out.push(`:${c} a owl:Class${parents.length ? " ; rdfs:subClassOf " + [...new Set(parents)].join(", ") : ""} .`);
  }
  const rels = new Map<string, [string, string][]>();
  for (const [a, r, b] of ex.rels) if (a && r && b) (rels.get(r) ?? rels.set(r, []).get(r)!).push([a, b]);
  for (const [r, pairs] of rels) {
    const one = pairs.length === 1 ? ` ; rdfs:domain :${pairs[0][0]} ; rdfs:range :${pairs[0][1]}` : "";
    out.push(`:${r} a owl:ObjectProperty${one} .`);
    if (pairs.length > 1) for (const [a, b] of pairs) out.push(`:${a} rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :${r} ; owl:someValuesFrom :${b} ] .`);
  }
  for (const [c, attrs] of ex.attrs) for (const a of attrs) if (a) out.push(`:${a} a owl:DatatypeProperty ; rdfs:domain :${c} ; rdfs:range xsd:string .`);
  return out.join("\n") + "\n";
}
