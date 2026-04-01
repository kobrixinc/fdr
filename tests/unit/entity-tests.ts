import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { DomainAnnotatedFactories, ResolverHolder, basicDomainFactories } from "../../src/index.js"
import entityFactories, { attribute, entity, relation } from "../../src/fdr/entity-factory.js"

const prefixes: {[key: string]: any}  = {
  "voc": "https://swapi.co/vocabulary/",
}

fdr.resolver.prefixResolver.withPrefixes(prefixes)

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

@entity({
  idProperty: 'id',
  iriFactory: () => "https://swapi.co/resource/planet/" + Math.random(),
  type: "voc:Planet"
})
class Planet {
  id: string = ''
  @attribute({type: 'xsd:string', iri: 'rdfs:label'})
  name: string = ''
  @attribute({type: 'xsd:string', iri: 'voc:terrain'})
  terrain: string = ''
  @relation({type: 'voc:Human', iri: 'voc:resident'})
  residents: Array<Human> = []
}

@entity({
  iriFactory: () => "https://swapi.co/resource/starship/" + Math.random(),
  type: "voc:Starship"
})
class Starship {
  name: string = ''
  capacity: number = 0
  pilots: Array<Human> = []
}


let endpointurl = 'http://localhost:7200/repositories/starwars'
let store = new SPARQLProtocolClient(endpointurl, endpointurl + "/statements")
let domainFactories = new DomainAnnotatedFactories()
  .addFromMap(basicDomainFactories)
  .addFromMap(entityFactories)

let graph = fdr.graph({store})

function initGraph() {
  graph = fdr.graph({
    store: store,
    factories: domainFactories
  })
}
    
initGraph()

describe("FDR Entities Tests", function() {
  it("Entity Annotations Properly Interpreted", async () => {
    let entityNames = Object.getOwnPropertyNames(graph.factory)
    console.log('factories', entityNames)
    expect(entityNames).to
      .contain("Human")
      .contain("Planet")
  }).timeout(20000)

  it.skip("Can create a new simple entity and save in graph", async () => {
    let id = "http://test.org/address/1"
    let a = graph.factory.Address(id)
    expect(a.ready).to.equal(false)
    expect(() => a.street).to.throw(Error)
    await graph.use(a)
    expect(a.id).to.equal(id)
    // a.commit()
  
  }).timeout(20000)

  // Test multi-valued data properties and multi-valued object properties
  // Test circular structures - with direct circular referecence and indirect ones
  // Test update propagation:
  //   1. make a simple update to object and commit
  //   2. after load of parent structure, get child object directly from cache and update it
  //      (this means, through a working copy of child)
  //   3. two structure that just share some triples in some fashion with being parent-child necessarily
  //      (is that scenario possible?). It
  //   4. Need to implement and test the "mentions" mechanism. Revisit its reason for being as well.
  //     Make a convincing argument it is actually needed.
  //   5. What would it take to change the type of an entity? Can we support that?
  it.only("Fetch an existing complex entity", async () => {
    let obiwan = graph.factory.Human("https://swapi.co/resource/human/10")
    await graph.use(obiwan)
    expect(obiwan.name).to.equal("Obi-Wan Kenobi")
    expect(obiwan.world.name).to.equal("Stewjon")
    let wc = obiwan.workingCopy()
    wc.name = "Dart Vader"
    wc.commit()
    expect(obiwan.name).to.equal("Dart Vader")
    // Wolrd Stewjon should be available in cache on its own:
    let stewjon = graph.factory.Planet("https://swapi.co/resource/planet/20")
    expect(stewjon.name).to.equal("Stewjon")
    expect(stewjon.residents).to.be.an('array').that.contains(obiwan)
  }).timeout(20000)  
})