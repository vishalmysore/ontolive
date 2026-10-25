import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { render } from "pele";
import { loadOntology } from "../src/ontology/load.ts";
import { buildView, type ViewOptions } from "../src/view/diagram.ts";

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
const base: ViewOptions = { focus: null, depth: 2, properties: true, restrictions: false, attributes: true, direction: "TB", maxNodes: 400 };

test("family overview and focus views render with Pele", () => {
  const o = loadOntology(readFileSync(new URL("../public/samples/family.ttl", import.meta.url), "utf8"), "family.ttl", parseXml);
  const overview = buildView(o, base);
  assert.match(overview.text, /Agent <\|-- Person/);
  assert.ok(render(overview.text).svg.includes("pele-class"));
  const mother = [...o.classes.values()].find((c) => c.name === "Mother")!.iri;
  const focus = buildView(o, { ...base, focus: mother, depth: 1, restrictions: true });
  assert.match(focus.text, /Mother:::focus/);
  assert.ok(render(focus.text).svg.length > 0);
});

const pizzaPath = new URL("./fixtures/pizza.owl", import.meta.url);
test("pizza: every depth renders, fast", { skip: !existsSync(pizzaPath) }, () => {
  const o = loadOntology(readFileSync(pizzaPath, "utf8"), "pizza.owl", parseXml);
  for (const restrictions of [false, true])
    for (let depth = 0; depth <= 6; depth++) {
      const v = buildView(o, { ...base, depth, restrictions });
      const t = performance.now();
      const r = render(v.text);
      console.log(`depth ${depth} restr ${restrictions}: ${v.classes.length} classes, ${v.edges} edges, ${(performance.now() - t).toFixed(1)} ms, ${r.width}x${r.height}`);
    }
  const margherita = [...o.classes.values()].find((c) => c.name === "Margherita")!.iri;
  const v = buildView(o, { ...base, focus: margherita, depth: 2, restrictions: true });
  assert.ok(v.classes.length > 5);
  render(v.text);
});
