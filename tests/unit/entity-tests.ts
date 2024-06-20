import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { DomainAnnotatedFactories, ResolverHolder, basicDomainFactories } from "../../src/index.js"
import entityFactories from "../../src/fdr/entity-factory.js"

const prefixes: {[key: string]: any}  = {
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
      .contain("Address")
      .contain("Person")
  }).timeout(20000)

  it.only("Can create a new simple entity and save in graph", async () => {
    let id = "http://test.org/address/1"
    let a = graph.factory.Address(id)
    expect(a.ready).to.equal(false)
    expect(() => a.street).to.throw(Error)
    await graph.use(a)
    expect(a.id).to.equal(id)
    // a.commit()
  
  }).timeout(20000)

})