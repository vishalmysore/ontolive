// The smallest RDF model both parsers agree on: IRIs, blank nodes and literals in plain triples.
export type Term =
  | { t: "iri"; v: string }
  | { t: "bnode"; v: string }
  | { t: "lit"; v: string; lang?: string; datatype?: string };

export interface Triple {
  s: Term;
  p: string;
  o: Term;
}

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";

export const key = (t: Term): string => (t.t === "iri" ? t.v : t.t === "bnode" ? "_:" + t.v : '"' + t.v);

export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"), iri.lastIndexOf(":"));
  const name = cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
