# Object Graphs

In JavaScript one relies on object structures which can be easily mapped to RDF graphs. Conversely, an RDF graph finds a natural representation as a JavaScript object. 

TypeScript brings classical class-oriented programming with static typing, affording stronger engineering practices. 

FDR lets you to annotate your TypeScript classes in order to control exactly how their instances are to be represented as an RDF graph. Similarly to some traditional object-relational mapping frameworks (like Hibernate in the Java world), you can control which RDFS/OWL class a given TypeScript class corresponds to and how the runtime object's properties are translate to RDF literals or to relations to other RDF entities. Furthermore, FDF provides fine-grained control over eager vs lazy retrieval patterns, from the conservative separate roundtrip for each relationships to a complete recursive querying over an entire object graph (an object relation closure if you will).

## Annotations

The main FDR annotation is `@entity` which applies to a TypeScript class. The required metadata for this annotation is:

* `id` - which JavaScript object property will hold the identifier (the IRI) of the entity.
* `idFactory` - a function to generate/mine new IRIs when new entities are created and stored in the triplestore
* `type` - the IRI of the RDFS/OWL corresponding to this TypeScript class.

Literal properties are called annotated with `@attribute` while related objects (i.e. RDF _subjects_) are annotated with `@relation`. 

Both the `@attribute` and `@relation` annotations require that you provide the _IRI_ and the type of the corresponding RDF property. 

Here is an example of properly annotated class _Human_ for the Star Wars data:

```
@entity({
  idProperty: 'id',
  iriFactory: () => "https://swapi.co/resource/human/" + Math.random(),
  type: "voc:Human"
})
class Human {
  id: string = ''
  @attribute({type: 'xsd:string', iri: 'rdfs:label'})
  name: string = ''
  @attribute({type: 'xsd:string', iri: 'voc:gender'})
  gender: string = ''
  @attribute({type: 'xsd:decimal', iri: 'voc:height'})
  height: number = 0

  @relation({type: 'voc:Planet', iri: 'voc:homeworld'})
  world: Planet | null = null
  @relation({type: 'voc:Starship', iri: 'voc:starship'})
  starships: Array<Starship> = []
}
```

As with any framework mapping a runtime object-model to some data storage model, there comes the dilemma of eager vs lazy fetching of related entities. In the above example, we have the `voc:homeworld` and `voc:starship` relationships. When retrieving a given `Human` instance, should FDR automatically fetch all their properties? And recursively their properties' properties? 

As a general rule, you'd want to ensure you have the full entity through the `graph.use(entity)` asynchronous function. But for performance reasons and also for programming convenience, you also want the ability to eagerly get everything you need in one network hop. Here is what FDR offers to resolve these dilemmas.

## Ontological Relation  Theory

Following the taxonomy proposed by the Unified Foundatonal Ontology (UFO), we can categorize relations into formal, material and characterizations.

Relations that are characterizations (quality or mode) and relations that are of the "component of" kind imply eager fetching because they relate entities that are inherently part of the entity being retrieved.

Material relations or _member of_ or _collection of_ or even formal relations are generally better off lazily retrieved. 

## API Support

Instead of needing to specify the eagerness of retrieval patterns at coding time, via annotations, one can also direct FDR what to do at runtime, on a case by case basis. 

## Combining API with Relation Meta-Properties

TBD