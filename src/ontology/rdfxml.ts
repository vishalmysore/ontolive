// RDF/XML, the format Protégé saves by default. This covers the RDF/XML grammar that OWL tools emit:
// typed nodes, rdf:about/ID/nodeID, rdf:resource, nested nodes and parseType Resource/Collection/Literal.
import { RDF, type Term, type Triple } from "./rdf.ts";

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const SYNTAX = new Set(["about", "ID", "nodeID", "resource", "parseType", "datatype", "type"]);

/** Inline the internal DTD entities (&owl; etc.) that OWL files rely on; not every XML parser expands them. */
export function expandEntities(text: string): string {
  const entities = new Map<string, string>();
  const doctype = text.match(/<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/);
  if (doctype) {
    for (const m of doctype[1].matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])(.*?)\2\s*>/g)) entities.set(m[1], m[3]);
    text = text.replace(doctype[0], "");
  } else {
    text = text.replace(/<!DOCTYPE[^>]*>/, "");
  }
  return entities.size ? text.replace(/&([\w.-]+);/g, (all, name: string) => entities.get(name) ?? all) : text;
}

function resolve(ref: string, base: string): string {
  if (/^[a-z][\w+.-]*:/i.test(ref)) return ref;
  if (ref === "") return base.replace(/#.*$/, "");
  if (ref.startsWith("#")) return base.replace(/#.*$/, "") + ref;
  try {
    return new URL(ref, base).href;
  } catch {
    return base + ref;
  }
}

export function parseRdfXml(doc: Document, documentBase = "urn:ontolive:"): Triple[] {
  const triples: Triple[] = [];
  let blank = 0;
  const fresh = (): Term => ({ t: "bnode", v: "x" + blank++ });
  const iriOf = (el: Element) => (el.namespaceURI ?? "") + el.localName;
  const rdfAttr = (el: Element, name: string) => (el.hasAttributeNS(RDF, name) ? el.getAttributeNS(RDF, name) : null);
  const baseOf = (el: Element, inherited: string) => {
    const b = el.getAttributeNS(XML_NS, "base");
    return b ? resolve(b, inherited) : inherited;
  };
  const langOf = (el: Element, inherited?: string) => el.getAttributeNS(XML_NS, "lang") || inherited;
  const children = (el: Element) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);

  function node(el: Element, base: string, lang?: string): Term {
    base = baseOf(el, base);
    lang = langOf(el, lang);
    const about = rdfAttr(el, "about");
    const id = rdfAttr(el, "ID");
    const nodeID = rdfAttr(el, "nodeID");
    const subject: Term =
      about !== null
        ? { t: "iri", v: resolve(about, base) }
        : id !== null
          ? { t: "iri", v: resolve("#" + id, base) }
          : nodeID !== null
            ? { t: "bnode", v: "n" + nodeID }
            : fresh();
    if (!(el.namespaceURI === RDF && el.localName === "Description")) triples.push({ s: subject, p: RDF + "type", o: { t: "iri", v: iriOf(el) } });
    const type = rdfAttr(el, "type");
    if (type) triples.push({ s: subject, p: RDF + "type", o: { t: "iri", v: resolve(type, base) } });
    propertyAttributes(el, subject, lang);
    let li = 1;
    for (const child of children(el)) {
      const p = child.namespaceURI === RDF && child.localName === "li" ? RDF + "_" + li++ : iriOf(child);
      property(child, subject, p, base, lang);
    }
    return subject;
  }

  function propertyAttributes(el: Element, subject: Term, lang?: string) {
    for (const a of Array.from(el.attributes)) {
      if (!a.namespaceURI || a.namespaceURI === XML_NS || a.name.startsWith("xmlns")) continue;
      if (a.namespaceURI === RDF && SYNTAX.has(a.localName)) continue;
      triples.push({ s: subject, p: a.namespaceURI + a.localName, o: { t: "lit", v: a.value, lang } });
    }
  }

  function property(el: Element, subject: Term, p: string, base: string, lang?: string) {
    base = baseOf(el, base);
    lang = langOf(el, lang);
    const resource = rdfAttr(el, "resource");
    const nodeID = rdfAttr(el, "nodeID");
    const parseType = rdfAttr(el, "parseType");
    const kids = children(el);
    let object: Term;
    if (resource !== null) {
      object = { t: "iri", v: resolve(resource, base) };
      propertyAttributes(el, object, lang);
    } else if (nodeID !== null) {
      object = { t: "bnode", v: "n" + nodeID };
    } else if (parseType === "Collection") {
      const items = kids.map((k) => node(k, base, lang));
      object = { t: "iri", v: RDF + "nil" };
      for (let i = items.length - 1; i >= 0; i--) {
        const cell = fresh();
        triples.push({ s: cell, p: RDF + "first", o: items[i] });
        triples.push({ s: cell, p: RDF + "rest", o: object });
        object = cell;
      }
    } else if (parseType === "Resource") {
      object = fresh();
      for (const k of kids) property(k, object, iriOf(k), base, lang);
    } else if (parseType === "Literal") {
      object = { t: "lit", v: el.textContent ?? "", datatype: RDF + "XMLLiteral" };
    } else if (kids.length) {
      object = node(kids[0], base, lang);
    } else {
      const datatype = rdfAttr(el, "datatype");
      object = { t: "lit", v: el.textContent ?? "", lang: datatype ? undefined : lang, datatype: datatype ? resolve(datatype, base) : undefined };
    }
    triples.push({ s: subject, p, o: object });
  }

  const root = doc.documentElement;
  if (!root) return triples;
  const base = baseOf(root, documentBase);
  const tops = root.namespaceURI === RDF && root.localName === "RDF" ? children(root) : [root];
  for (const el of tops) node(el, base, langOf(root));
  return triples;
}
