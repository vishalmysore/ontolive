// One entry point for every format: sniff the text, pick a parser, build the model.
import { buildOntology, type Ontology } from "./model.ts";
import { expandEntities, parseRdfXml } from "./rdfxml.ts";
import { parseTurtle } from "./turtle.ts";

export type Format = "rdfxml" | "turtle";

export function sniff(text: string, name = ""): Format {
  if (/\.(ttl|nt|n3)$/i.test(name)) return "turtle";
  if (/\.(owl|rdf|xml)$/i.test(name) && text.trimStart().startsWith("<")) return "rdfxml";
  return text.trimStart().startsWith("<") && /<rdf:RDF|xmlns:rdf=/.test(text) ? "rdfxml" : "turtle";
}

/** `parseXml` is DOMParser in the browser and xmldom in the tests. */
export function loadOntology(text: string, name: string, parseXml: (xml: string) => Document, base?: string): Ontology {
  const fallback = name.replace(/\.[^.]+$/, "") || "Ontology";
  if (sniff(text, name) === "rdfxml") {
    const doc = parseXml(expandEntities(text));
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) throw new Error("Not valid RDF/XML: " + (err.textContent ?? "").slice(0, 200));
    return buildOntology(parseRdfXml(doc, base), fallback);
  }
  return buildOntology(parseTurtle(text, base), fallback);
}
