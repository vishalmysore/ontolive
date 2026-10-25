import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "pele";
import { DOMParser } from "@xmldom/xmldom";
import { factsToMermaid, factsToTurtle, parseFacts } from "../src/llm/extract.ts";
import { loadOntology } from "../src/ontology/load.ts";

const stream = `CLASS Employee
CLASS Manager
CLASS TeamLead
- Manager ISA Employee
TeamLead ISA Manager
Manager ISA TeamLead
CLASS Managers
REL Employee reportsTo Manager
ATTR Employee name
CLASS Team`;

test("partial stream: the unfinished last line waits", () => {
  const ex = parseFacts(stream);
  assert.ok(!ex.classes.has("Team"));
  assert.ok(parseFacts(stream, true).classes.has("Team"));
});

test("guardrails catch the cycle and the near-duplicate", () => {
  const ex = parseFacts(stream, true);
  assert.ok(ex.issues.some((i) => i.kind === "cycle" && i.text.includes("TeamLead")));
  assert.ok(ex.bad.has("Manager") && ex.bad.has("TeamLead"));
  assert.ok(ex.issues.some((i) => i.kind === "duplicate"));
  assert.ok(!ex.bad.has("Employee"));
});

test("every prefix of a stream renders or fails cleanly, and the result round-trips through Turtle", () => {
  for (let i = 1; i <= stream.length; i++) {
    const text = factsToMermaid(parseFacts(stream.slice(0, i)));
    assert.ok(render(text).svg.length > 0, `prefix ${i}`);
  }
  const ttl = factsToTurtle(parseFacts(stream, true));
  assert.match(ttl, /:Manager a owl:Class ; rdfs:subClassOf :Employee/, "a flagged class keeps its sound parents");
  assert.doesNotMatch(ttl, /:Manager a owl:Class ; rdfs:subClassOf [^.]*:TeamLead/, "the cycle edge is dropped");
  const o = loadOntology(ttl, "x.ttl", (x) => new DOMParser().parseFromString(x, "application/xml") as unknown as Document);
  assert.ok(o.classes.size >= 5);
});
