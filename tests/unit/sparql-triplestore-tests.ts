import { SparqlClient } from "@/fdr/sparql-triplestore-client"

describe("SPARQL Protocol Implementation Tests", function() {

  it('Fetches a subject with properties', async () => {
    let client = new SparqlClient("http://obelix:7200/repositories/starwars")
    let result = client.select("select * where { ?s ?p ?o }")
    console.log('test passed', result)
  })
})
