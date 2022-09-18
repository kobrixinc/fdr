# What Is It?

The Semantic Web (RDF) technology stack has traditionally been snubbed by mainstream application developers. There are many reasons for that, none of which are fundamental as the recent accelerated adoption shows. On the technical side, there are standards for data models and querying, there are authoring tools, there are database engines that are pretty solid. Moreover, so called graph thinking is in fact becoming mainstream fueled by a graph technology - Labeled Property Graphs - that can hardly brag about standardization, vendor diversity or solid traditions. So time is ripe for leveraging RDF as a graph-oriented database technology for building applications. [Note: application thus built can better be aligned with data-centric / model-driven architectures, for obvious reasons]

Because of that there is a lack of a good practical programming interface to an RDF based database. A *good practical API* for RDF should not only reflect the Semantic Web specifications, but should embody programming patterns that make it natural to interact with the database and write regular software applications at the appropriate level of abstraction. RDF itself is too low-level. OWL is unusable as an application backend. Objects are still the most natural and easy way to have a decent data model and couple it with code in a readable, maintainable manner. But there are aspects in the Semantic Web tradition - yes, there is a lot of code written backed by RDF data - that will certainly drive some innovation. And a good practical library should acknowledge and embrace that. 

FDR is trying to be that good practical API for Semantic Web based applications. It’s in TypeScript, but if the approach developed proves useful, it is easy to imagine a port to other languages.

### Name Origin

FDR is just a RDF in reverse. Look no deeper than that.

### Why Not X?

Of course there some existing software libraries to make use of RDF. Why should someone decide to use FDR instead? We comment only on the ones that we deem important enough. If we’ve missed some, please let us know.

- The **RDF Data Model, Dataset, Stream and Query interfaces** to be found under Specifications at [https://rdf.js.org/](https://rdf.js.org/). Those are great specs and one can find implementations for them. FDR actually adopts them and builds on top. They are too low-level, they don’t make it easy to build RDF based applications, they merely make it possible.
- rdflib.js ([https://linkeddata.github.io/rdflib.js/doc/index.html](https://linkeddata.github.io/rdflib.js/doc/index.html)) is great. It offers interactions with RDF, also at low-level, it offers local storage of RDF data. The main issue here is the focus is clearly manipulating RDF store if you care for nothing else.

### Status

FDR is at its first, usable and hopefully useful version. It is work in progress insofar that it does not yet provide a framework for creating conventional object-oriented models, which is a must for programmers to feel at home. But the foundations for that are there and the level of abstraction is already much more palpable than raw triples.

# Capabilities

FDR offers the following essentially orthogonal capabilities to a [Java/Type]Script programmer:

1. Abstractions over triples - instead of managing sets of triples, a programmer should be focused on entities and relationships, or more generally sub-graphs of any size that are considered as logical unit from a business standpoint (e.g. vanilla object-oriented entities mapping to low-level RDF representation). That’s easier said than done. It is hard to define what is an entity of interest when you have a full graph. 
2. A well-defined model for interaction with RDF endpoints and mutating the graph. Again, it’s easier said than done. Not obvious at what point to fetch what data, what to keep in a local cache and for how long, how to track changes coming from elsewhere, how to persist changes coming from your own app etc. But user of FDR has to do very little work in order to deal with movement of RDF data to/from remote endpoints. Managing a local cache of an arbitrary large portion of the graph, allowing concurrent modifications, is key part of the architecture. 
3. Easy integration with GUI frameworks like VueJS, React and AngularrJS. Specifically, it is possible to use an FDR abstraction as a model in some GUI framework and handle change propagation (in both directions) in an elegant and predictable manner.

All aim to simplify programming business logic and GUIs. We try to make common things easy and less common things possible. We try to keep it simple without compromising flexibility. 

# Concepts

This section describes the core concepts at the foundation of the FDR design. As a programming library, there are several layers in the architecture and depending on the task at hand one may need to understand this or that layer, or even a few simultaneously, more deeply. 

## Subject

The term “resource” from the RDF acronym is a bit of an unfortunate choice. Historically the intended use was for describing online web resources. But really in the subject position of an RDF triple we have, well, a subject. And the wide applicability of the RDF model to all matters of data modeling, including conventional business applications, demonstrates that the term suggest too narrow of a scope. [Note: on the early days, there was a competing framework called Topic Maps (ref) where what was described was called a subject which also presupposed a lighter ontological commitment]

## Graph

A graph is a simply a collection of subjects related via properties. 

## Triplestore

Anything that store triples. While typically a single endpoint abiding by the SPARQL Protocol (see [https://www.w3.org/TR/sparql11-protocol/](https://www.w3.org/TR/sparql11-protocol/)), this can be anything else capable of storing and retrieving RDF triples. There are enough ad hoc, special purpose endpoints that ultimately are about serving and storing RDF, without being fully SPARQL compliant, and we want to allow connectivity with all of them. 

## Data Specification

# API

The FDR API is derived from the concepts outlined above.