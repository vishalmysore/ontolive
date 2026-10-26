---
title: "Pele makes Mermaid diagrams fast enough to be live. So I built an ontology viewer that runs in a browser tab"
published: false
description: "Pele renders Mermaid to SVG in about a millisecond. That is fast enough to redraw on every slider tick and every LLM token. OntoLive uses it to explore OWL ontologies with nothing to install."
tags: javascript, webdev, ai, opensource
cover_image: https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/hero-margherita.png
---

# Pele makes Mermaid diagrams fast enough to be live

![OntoLive showing the Margherita class from the Pizza ontology, with its restrictions listed beside the diagram](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/hero-margherita.png)

**Try it:** [vishalmysore.github.io/ontolive](https://vishalmysore.github.io/ontolive/#src=pizza&focus=Margherita&depth=2) · **Code:** [github.com/vishalmysore/ontolive](https://github.com/vishalmysore/ontolive)

## What is Pele?

[Pele](https://pele.run) is a new open-source library from the Obsidian team. It renders [Mermaid](https://mermaid.js.org) diagrams to SVG. You give it the same text you would give Mermaid:

```js
import { render } from "pele";

const { svg } = render(`classDiagram
  Pizza <|-- Margherita
  Margherita --> MozzarellaTopping : hasTopping`);

document.querySelector("#diagram").innerHTML = svg;
```

Pele has four properties that matter here:

- **It is synchronous.** `render()` returns the SVG straight away. There is no promise to wait for.
- **It is fast.** Most diagrams take a few milliseconds or less.
- **It has no runtime dependencies.**
- **It is themed with CSS variables.** Set `--pele-accent`, `--pele-surface`, `--pele-font` and the rest on a parent element. The diagram follows your light or dark theme without being drawn again.

Pele aims to support every diagram type built into Mermaid 12.1, including flowcharts, sequence diagrams, class diagrams, Gantt charts and pie charts.

Faster diagrams sound like a small upgrade. The real change is what they let you build. Once a render costs a millisecond, a diagram can redraw on every keystroke, every slider tick and every token a language model streams. That turns a diagram from a picture into an interface.

I wanted to find a problem where that difference matters. Ontologies turned out to be a good one.

## The problem: looking at an ontology needs a desktop app

An ontology is a formal model of a domain: classes such as `Pizza` and `MozzarellaTopping`, a hierarchy (`Margherita` is a kind of `NamedPizza`), and rules (`Margherita` has some `TomatoTopping` and only mozzarella or tomato toppings). They are stored in the OWL language, usually as RDF/XML or Turtle files.

To look at one, most people install Protégé, a Java desktop application, and then add a visualisation plugin. Fine for an ontology engineer. Too much for the developer, analyst or student who only wants to see what is in a file someone sent them.

A browser could do this. In practice there are two obstacles:

1. **Real ontologies are too big to draw at once.** The well-known Pizza ontology has 99 classes. Industrial ones have thousands. A single diagram of everything is unreadable.
2. **The answer is to explore, not to draw.** Pick a class, show its neighbourhood, widen or narrow it. Exploring needs a fresh diagram on every interaction. With a renderer that takes half a second each time, the page feels broken.

Pele removes the second obstacle, and that removes the first.

## The solution: OntoLive

[OntoLive](https://vishalmysore.github.io/ontolive/) is an ontology viewer that runs entirely in a browser tab. Drop in a `.owl` or `.ttl` file. It is parsed in the tab and never uploaded. You can also load the Pizza ontology with one click.

### Explore by focus and depth

Click any class and the view centres on it. The **depth** slider decides how far out to look: one hop shows the class and its direct neighbours, two hops shows their neighbours, and so on. Every step of the slider produces new Mermaid text and a new diagram.

| Depth 1 around `PizzaTopping` | Depth 2 around `PizzaTopping` |
| --- | --- |
| ![Depth 1](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/depth-1.png) | ![Depth 2](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/depth-2.png) |

Drag the slider and the hierarchy unfolds as fast as you move. There is also a **Sweep depth** button that animates the slider, handy for screen recordings.

### How OWL becomes a class diagram

Mermaid's `classDiagram` maps onto OWL surprisingly well:

| In the ontology | In the diagram |
| --- | --- |
| `rdfs:subClassOf` | inheritance arrow |
| a defined class (`owl:equivalentClass`) | inheritance arrow and a dashed box |
| object property with a domain and range | labelled association |
| `some` / `only` restriction | dashed dependency, if you switch them on |
| datatype property | attribute inside the class box |

Some OWL statements have no honest drawing: cardinalities, unions, complements and disjointness. OntoLive lists them in a side panel instead, written the way Protégé shows them, for example `hasTopping only MozzarellaTopping or TomatoTopping`. The diagram shows the shape; the panel shows the rules.

Because Pele is themed with CSS variables, dark mode needed no extra code. The same diagram picks up the page colours:

![The Family sample ontology in dark mode, focused on Person](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/family-dark.png)

### Pele versus Mermaid.js, measured in your browser

OntoLive has a switch that sends the same Mermaid text to Mermaid.js instead of Pele. A **Race** button renders the current view 20 times with each and reports the median. Here is one run on a 36-class view of the Pizza ontology, in headless Chrome:

![Race result: Pele 0.7 ms, Mermaid.js 205.4 ms](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/race.png)

On a laptop browser, a 59-class view came out at 1.2 ms for Pele and 476 ms for Mermaid.js. Your numbers will differ by machine, which is why the page measures them rather than quoting them.

The table is less convincing than the feel. With Mermaid.js selected, dragging the slider from 0 to 6 took about half a second per step, and three of the seven updates were dropped because the previous render had not finished. With Pele, the same sweep averaged about 5 ms per step and nothing was dropped. One feels like a slideshow. The other feels like a control.

## Watching a language model build an ontology

If diagrams are this cheap, they can keep up with a language model as it types.

The second tab, **Watch an LLM build one**, runs a small model (Qwen2.5 1.5B by default) on your GPU through [WebLLM](https://github.com/mlc-ai/web-llm). Give it a paragraph and it writes an ontology one fact per line:

```text
CLASS Employee
CLASS Manager
Manager ISA Employee
REL Employee reportsTo Manager
ATTR Employee name
```

After every token, OntoLive parses what it has so far, turns it into Mermaid and redraws. You watch the classes appear and connect as the model writes.

Small models make ontology mistakes, so every partial answer is also checked:

- **Cycles:** A is a B, B is a C, C is an A. Nothing can be its own ancestor.
- **Self-subclassing:** a class declared a subclass of itself.
- **Near-duplicates:** `Manager` and `Managers` as two classes.
- **Undeclared classes:** relations that point at classes the model never declared.

Offending classes turn red in the diagram as soon as the mistake is written. One of the sample paragraphs is a deliberate trap: it says people in a small startup call a manager "really just a team lead". The model took the bait:

![The model writes "Manager ISA Manager" and the Manager class turns red mid-stream](https://raw.githubusercontent.com/vishalmysore/ontolive/main/docs/images/llm-trap.jpg)

`Manager ISA Manager` is wrong, and you can see it while the model is still writing. When it finishes, export the result as Turtle or open it in the explorer. The broken edges are left out of the export.

This is the part I find most useful beyond ontologies. If you ask a model for structure (a plan, a schema, a workflow), you can check that structure while it streams and show the problems on the diagram. That only works if the diagram can keep up.

## Why this is useful

- **Anyone can open an ontology.** Send a link instead of asking someone to install Java and Protégé. Links keep the focus and depth, for example [Margherita at depth 2](https://vishalmysore.github.io/ontolive/#src=pizza&focus=Margherita&depth=2).
- **Big ontologies stay readable.** You see a neighbourhood, never the whole graph, and changing it costs nothing.
- **Private files stay private.** Parsing and rendering happen in the tab. Nothing is uploaded.
- **Model output becomes visible.** A streaming diagram with live checks shows when a model's structure goes wrong, and where.
- **The diagrams are plain Mermaid.** Copy the source into a README, a Notion page or an Obsidian note. Download the SVG with your theme baked in.

## Try it

- Live: [vishalmysore.github.io/ontolive](https://vishalmysore.github.io/ontolive/)
- Pizza, focused on Margherita: [open the link](https://vishalmysore.github.io/ontolive/#src=pizza&focus=Margherita&depth=2)
- Code (MIT): [github.com/vishalmysore/ontolive](https://github.com/vishalmysore/ontolive)
- Pele: [pele.run](https://pele.run) and [github.com/obsidianmd/pele](https://github.com/obsidianmd/pele)

To run it locally:

```bash
git clone https://github.com/vishalmysore/ontolive
cd ontolive
npm install
npm run dev
```

Drop your own `.owl` or `.ttl` file on the page, press **Race**, and see what Pele does on your machine.

*Credits: [Pele](https://github.com/obsidianmd/pele) by Obsidian, [N3.js](https://github.com/rdfjs/N3.js) for Turtle parsing, [WebLLM](https://github.com/mlc-ai/web-llm) for in-browser models, and the [Pizza ontology](https://github.com/owlcs/pizza-ontology), which OntoLive loads from its GitHub repository.*
