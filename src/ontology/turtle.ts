// Turtle, N-Triples and N3 go through N3.js, which already speaks RDF terms.
import { Parser } from "n3";
import type { Term, Triple } from "./rdf.ts";

interface N3Term {
  termType: string;
  value: string;
  language?: string;
  datatype?: { value: string };
}

const term = (q: N3Term): Term =>
  q.termType === "NamedNode"
    ? { t: "iri", v: q.value }
    : q.termType === "BlankNode"
      ? { t: "bnode", v: q.value }
      : { t: "lit", v: q.value, lang: q.language || undefined, datatype: q.datatype?.value };

export function parseTurtle(text: string, baseIRI = "urn:ontolive:"): Triple[] {
  return new Parser({ baseIRI }).parse(text).map((q) => ({ s: term(q.subject), p: q.predicate.value, o: term(q.object) }));
}
