# FDR Query Language
As part of the implementation of FDR, we create an pattern-oriented query language for RDF data. The language is inspired by 
MQL from Freebase (ref?). It is based JSON-LD and it supports the following features:


The query is expressed as a JSON-LD which is captures both the constraints of the query (ultimately what triples are returned) and the shape of the result. This dual role of the JSON query forces the JSON the have some unorthodox structure, but it makes for a concise and clear formulation.

To illustrate the language, we will be using a simple data set on the Star Wars fictional universe, created Ontotext (now Graphwise) for the GraphDB triplestore: https://platform.ontotext.com/3.2/datasets/star-wars.html .

At the top-level a query is always a JSON object describing an RDF graph pattern and the results is alway a list of pattern matches/instantiations. The simplest pattern is a specific RDF resouce identified by an IRI

```
{
  "@id": "https://swapi.co/resource/human/10"
}
```

We get back a single entity with no additional data:

```
[{"@id":"https://swapi.co/resource/human/10"}]
```

Instead of the `@id` we could provide some more general constraint, like the type for example and we could also request that a specific property be returned in the result:

```
{
  "@type": {"@id" : "voc:Human"},
  "rdfs:label": null
}
```

We'd get a much bigger result set that would look like this:

```
[
  {
    "@id": "https://swapi.co/resource/human/10",
    "rdf:type": {
      "@id": "voc:Human"
    },
    "rdfs:label": "Obi-Wan Kenobi"
  },
  {
    "@id": "https://swapi.co/resource/human/69",
    "rdf:type": {
      "@id": "voc:Human"
    },
    "rdfs:label": "Jango Fett"
  },
  {
    "@id": "https://swapi.co/resource/human/88",
    "rdf:type": {
      "@id": "voc:Human"
    },
    "rdfs:label": "Captain Phasma"
  },
  {
    "@id": "https://swapi.co/resource/human/14",
    "rdf:type": {
      "@id": "voc:Human"
    },
    "rdfs:label": "Han Solo"
  },
  etc...
]
```

Few things to note here:

1. In the query we've provided the `@type` as a JSON object `{"@id" : "voc:Human"}`. This is the standard way to refer to resources. Had we written `@type: "voc:Human"`, it would have tried to match a literal value of `"voc:Human"` for the type. Notice that in the results, the type is also returned as a JSON object, again for the same reason - RDF resources are JSON objects. 
2. We are assuming a JSON-LD context that has the `voc:` prefix defined already. This is done at the API level so as to avoid dealing with prefix maps in every query.
3. In the query pattern we have `rdfs:label: null`. This is the syntax to request that a specific property be returned. We are saying "I am looking for entities that have that rdfs:label property, please fetch and return it for every match".
4. Notice that in the result we have the `rdfs:label` property return and the `@type` also returned. When a property is provided in the query pattern with a specific value to match or a blank (`null`), it will be returned as part of the result. 

Unsurprisingly, the query can specify an exact label to match:

```
{
  "@type":{"@id": "voc:Human"},
  "rdfs:label": "Han Solo"
}
```

This is of course asking for an exact match of the name "Han Solo". The syntax to specify partial/substring matches or doing arithmetic comparisons is where we depart from orthodox JSON and include the comparison operators inside the property name, like this:

```
{
  "rdfs:label ~": ".* Solo"
}
```

which is a regular expression match. Similarly we can do number comparison:

```
{
  "@type" : "voc:Planet"
  "voc:population >": "14000000"
}
```

To be sure, JSON doesn't prohibit such extra characters in a property name, but of course we are bying conciseness at the expense of syntactic purity.

An alternative, more pure way, to specify value constraints is through directives:

```
{
  "@type" : "voc:Planet"
  "voc:population": {
    "@gt" : "14000000"
  }
}
```

These sorts of directives are included only for the purists. And one can used operators inside properties just as well. 

But some other directives are essential.

To get all properties of a subject, one can use the `@fetch` directive with the value `all`:

```
{
  "@id": "https://swapi.co/resource/human/10",
  "@fetch": "all"
}
```

More interestingly, directives are used to describe a recursive structure. A JSON by itself can only be a tree, but if we want to specify a graph, with cycles or not, we need the ability to refer to portions of a pattern. Let's illustrate with a simple example.

Take the `foaf:knows` relationship in the FOAF ontology. If we want fetch the entire social network starting with a single individual, say `Han Solo`, we'd write:

```
{
  "@id": "https://swapi.co/resource/human/14",
  "@ref": "me",
  "foaf:knows": {"@pattern": "me"},
  "rdfs:label":null
}
```

The `@ref` directive lets you provide a name for a portion of your query pattern, here the top-level/root of the pattern. You can use this name in other places, within other directives to define a recursive structure or just a clone of a pattern. Here we are saying that the object of a `foaf:knows` is the same pattern as the top-level pattern. We are define a network, with possible cycles, recursively. 

Recursion is sometimes necessary, but one must be careful as it can lead to very large results, potentially the whole graph being pulled into an answer. Often, a simple nest structure a few levels deep is enough.

The following produces all humans, with all their properties that are from the planet `Tatooine`. It also asks only for `voc:terrain` property of that planet and for all its droid residents.

```
{
  "@type": {"@id" : "voc:Human"},
  "@fetch": "all", 
  "voc:homeworld": {
    "@type": "voc:Planet",
    "rdfs:label": "Tatooine",
    "voc:terrain": null,
    "voc:resident": { 
      "@type": { "@id": "voc:Droid"}
    }
  }
}
```

We could further constraint which droids we're interested in. There is one imporant subtlety to note here, namely that the existing of resident droids on that planet is required. The generated SPARQL looks like this:

```
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX voc: <https://swapi.co/vocabulary/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      
SELECT * WHERE { 
  ?v_1 rdf:type <https://swapi.co/vocabulary/Human> .
  ?v_1 voc:homeworld ?v_3 .
  ?v_3 rdf:type <https://swapi.co/vocabulary/Planet> .
  ?v_3 rdfs:label "Tatooine" .
  ?v_3 voc:terrain ?terrain1 .
  ?v_3 voc:resident ?v_5 .
  ?v_5 rdf:type <https://swapi.co/vocabulary/Droid> .
  ?v_1 ?allprops4 ?allvalues5 .      
}
```

## Single vs Multiple Values

When your query is asking to get back the value of a property via the `null` keyword, the query engine assume you are wanting a single value back. To get all values, the syntax is an empty array `[]`:

```
{
  "@id": "https://swapi.co/vocabulary/Aleena",
  "voc:skinColor": []
}
```

