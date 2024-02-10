<base target="_blank">

FDR is a TypeScript library for building applications backed by an [RDF](https://en.wikipedia.org/wiki/Resource_Description_Framework) model and the Semantic Web Technology Stack in general (SPARQL, triplestores, OWL ontologies, inferencing etc.).

FDR makes use of the [RDFJS APIs](https://rdf.js.org/), but considers them as a low level foundational layer. 

The goals of FDR as a framework and a toolkit are:

- Provide a set of abstractions that makes programming with models and data represented in RDF easy and fun.
- Provide facilities for state management that include UI state, caching and synchronization with backend (typically SPARQL endpoints).
- Make it possible to extend with one's one abstractions for front-end or backend integration with non-standard APIs (i.e. APIs that don't follow the [SPARQL HTTP protocol](https://www.w3.org/TR/sparql11-protocol/))

**NPM Package:** https://www.npmjs.com/package/@kobrix/fdr

**Tutorial:** https://kobrixinc.github.io/fdr-tutorial/ (app repo https://github.com/kobrixinc/fdr-tutorial)

**Programmer's Guide:** https://kobrixinc.github.io/fdr/ 



## Quick Start

To install:

```
npm install @kobrix/fdr
```

Connecting to a triplestore with a local cache and reading some data:

```TypeScript
import { SPARQLProtocolClient, fdr } from '@kobrix/fdr'

// Setup some prefixes to use globally when providing IRIs for properties and entities.
fdr.resolver.prefixResolver.withPrefixes({
  "dbr": "http://dbpedia.org/resource/",
  "dbp": "http://dbpedia.org/property/"
})

// Default client implementation for a stnadard SPARQL endpoint. 
let dbpedia = new SPARQLProtocolClient("https://dbpedia.org/sparql", "https://dbpedia.org/sparql/statements")

// Obtain a local cache bound to a given endpoint (could be a custom REST API 
// so long as an implementation for it is provided)
let graph = fdr.graph({ store: dbpedia })

// Create an entity "proxy", something that refers to an entity in the graph,
// without necessarily fetching its properties.
let newyork = graph.factory.subject(fdr.subjectId("dbr:New_York_City"))

// Declare that we will actually need the properties of that entity - an async backend call.
await graph.use(newyork)

// Hee is the current populate of Manhattan according to DBPedia.
console.log('NewYork', newyork.get("dbp:populationTotal"))
```

For more, follow the [tutorial](https://kobrixinc.github.io/fdr-tutorial/).

## Community

To get support, file an issue or post to the Github discussions:

https://github.com/kobrixinc/fdr/discussions

To contribute, file a pull request. If you are looking for ideas what a useful PR could be, post to the discussions.

