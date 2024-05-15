import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { ResolverHolder } from "src/index.js"

const prefixes: {[key: string]: any}  = {
}

let endpointurl = 'http://localhost:7200/repositories/starwars'
let store = new SPARQLProtocolClient(endpointurl, endpointurl + "/statements")
let graph = fdr.graph({ store })
    
describe("FDR Entities Tests", function() {
  it("Entity Annotations Properly Interpreted", async () => {
    let entityNames = Object.getOwnPropertyNames(graph.factory.entity)
    console.log('factories', entityNames)
    expect(entityNames).to
      .contain("Address")
      .contain("Person")
  }).timeout(20000)
})