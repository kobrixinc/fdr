import { assert } from "chai"
import { fdr }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"

const prefixes: {[key: string]: any}  = {
  "dbr": "http://dbpedia.org/resource/",
  "dbo": "http://dbpedia.org/ontology/",
  "dbp": "http://dbpedia.org/property/",
  "foaf": "http://xmlns.com/foaf/0.1/",
  "ulsini": "http://ulsini.org/ontology/"
}

describe("FDR API Tests", function() {
  it("Environment configured with DBPedia", async () => {
    let store = new SPARQLProtocolClient("https://dbpedia.org/sparql", 
                                         "https://dbpedia.org/sparql/statements")
    let graph = fdr.graph({ store })
    
    fdr.resolver.prefixResolver.withPrefixes(prefixes)
    
    let subject = graph.factory.subject(fdr.subjectId("dbr:Miami"))
    subject = await graph.use(subject)

    let abstract = subject.get("dbo:abstract")

    console.log(abstract)

  }).timeout(20000)
})