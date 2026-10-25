import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { loadOntology } from "../src/ontology/load.ts";

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
const family = readFileSync(new URL("../public/samples/family.ttl", import.meta.url), "utf8");

test("turtle sample: hierarchy, properties and restrictions", () => {
  const o = loadOntology(family, "family.ttl", parseXml);
  const byName = (n: string) => [...o.classes.values()].find((c) => c.name === n)!;
  assert.ok(o.classes.size >= 15, `classes: ${o.classes.size}`);
  const mother = byName("Mother");
  assert.ok(mother, "Mother exists");
  assert.ok([...mother.parents, ...mother.definedParents].some((p) => o.classes.get(p)!.name === "Woman"));
  assert.ok(mother.restrictions.some((r) => r.kind === "some"), "Mother is defined by hasChild some Person");
  assert.ok([...o.properties.values()].some((p) => p.kind === "data"));
});

// The canonical Pizza ontology (RDF/XML). Fetch it to tests/fixtures/pizza.owl to run this.
const pizzaPath = new URL("./fixtures/pizza.owl", import.meta.url);
test("rdf/xml: Pizza ontology", { skip: !existsSync(pizzaPath) }, () => {
  const o = loadOntology(readFileSync(pizzaPath, "utf8"), "pizza.owl", parseXml);
  const byName = (n: string) => [...o.classes.values()].find((c) => c.name === n)!;
  assert.ok(o.classes.size > 90, `classes: ${o.classes.size}`);
  const margherita = byName("Margherita");
  assert.ok([...margherita.parents].some((p) => o.classes.get(p)!.name === "NamedPizza"));
  assert.ok(margherita.restrictions.some((r) => r.kind === "some" && r.filler === "MozzarellaTopping"));
  assert.ok(margherita.restrictions.some((r) => r.kind === "only" && r.filler.includes(" or ")));
  assert.ok(byName("CheeseyPizza").definedParents.size > 0, "defined classes hang under their named conjunct");
  assert.ok(margherita.disjoint.size > 5);
  assert.ok(o.properties.get([...o.properties.keys()].find((k) => k.endsWith("hasTopping"))!)!.domains.length > 0);
});
