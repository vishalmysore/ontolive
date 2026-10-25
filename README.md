# OntoLive

**Every ontology tool needs a Java install. This one needs a browser tab.**

OntoLive is an OWL ontology viewer that runs entirely in the browser. Drop in a `.owl` (RDF/XML) or `.ttl` (Turtle) file and browse its class hierarchy as a live diagram. Click a class to centre on it, then drag the depth slider: the diagram redraws on every step of the slider, even for a hundred-class neighbourhood.

It also has a second mode. A small language model running on your GPU reads a paragraph and writes an ontology one line at a time, and the diagram grows with every token. Guardrails check each partial answer and turn a class red when the model puts it in a subclass cycle, makes it its own parent, or invents a near-duplicate.

Live demo: https://vishalmysore.github.io/ontolive/

## Why it is fast enough to be live

The diagrams are Mermaid `classDiagram` text drawn by [Pele](https://pele.run), a synchronous Mermaid renderer with no dependencies. Because Pele returns SVG in a few milliseconds, the page can redraw on every slider tick and on every streamed token. A toggle switches the same text to Mermaid.js so you can see the difference, and the **Race** button times both renderers on the current view, in your browser. On a 59-class Pizza neighbourhood we measured a median of 1.2 ms for Pele and 476 ms for Mermaid.js. Measure it on your own machine; numbers vary by hardware.

## Mapping OWL to a class diagram

| OWL | Drawn as |
| --- | --- |
| `rdfs:subClassOf` a named class | inheritance arrow |
| named conjunct of an `owl:equivalentClass` definition | inheritance arrow, dashed box (a defined class) |
| object property `domain` → `range` | association, labelled with the property |
| `someValuesFrom` / `allValuesFrom` / `hasValue` restriction | dashed dependency (toggle "Restrictions") |
| datatype property with a `domain` | attribute inside the class box |
| cardinalities, unions, complements, disjointness | listed in the side panel in Manchester syntax |

A class diagram cannot express every OWL axiom, so the side panel shows them as text, the way Protégé does.

## Features

- RDF/XML (including internal DTD entities such as `&owl;`), Turtle, N-Triples. Files are read locally and never uploaded.
- Overview mode (levels below the roots) and focus mode (hops out from a class along every visible edge).
- Searchable class list, details panel, shareable links (`#src=pizza&focus=Margherita&depth=2`).
- **Sweep depth** animates the slider for screen recordings; **Download SVG** keeps the current theme.
- Colours come from CSS variables, so the diagram follows light and dark mode without being re-rendered.
- LLM mode: WebLLM (Qwen2.5, Llama 3.2, Phi-3.5; q4f32 builds first), streaming extraction, guardrails, export to Turtle or open the result in the explorer.

## Run it

```bash
npm install
npm run dev
```

```bash
npm test
```

The tests parse the bundled Turtle sample and, when `tests/fixtures/pizza.owl` exists, the canonical Pizza ontology. Fetch it from [owlcs/pizza-ontology](https://github.com/owlcs/pizza-ontology). The site loads Pizza from that repository at runtime; it is not redistributed here.

## Credits

[Pele](https://github.com/obsidianmd/pele) by Obsidian, [N3.js](https://github.com/rdfjs/N3.js), [WebLLM](https://github.com/mlc-ai/web-llm), [Mermaid](https://mermaid.js.org) for the comparison, and the [Pizza ontology](https://github.com/owlcs/pizza-ontology) from the University of Manchester.

## License

MIT
