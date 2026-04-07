import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { DomainAnnotatedFactories, ResolverHolder, basicDomainFactories } from "../../src/index.js"
import entityFactories, { attribute, entity, relation } from "../../src/fdr/entity-factory.js"
import { RootQueryPattern } from "../../src/fdr/query.js"

const prefixes: {[key: string]: any}  = {
  "voc": "https://swapi.co/vocabulary/",
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#"
}

let endpointurl = 'http://localhost:7200/repositories/starwars'
let store = new SPARQLProtocolClient(endpointurl, endpointurl + "/statements")

fdr.resolver.prefixResolver.withPrefixes(prefixes)


const query1 = {
  "@id": "https://swapi.co/resource/human/10",
  "rdfs:label": null
}

const query2 = {
  "@type": {"@id" : "voc:Human"},
  "rdfs:label": null
}

const query3 = {
  "@type": {"@id" : "voc:Human"},
  "@fetch": "all", 
  "voc:homeworld": {
    "@type": "voc:Planet",
    "voc:name": "Stewjon",
    "voc:terrein": null
  }
}

const query4 = {
  "@id": "https://swapi.co/vocabulary/Aleena",
  "voc:skinColor": []
}

const query5 = {
  "@id": "https://swapi.co/resource/human/10",
  "voc:film": [{"@type": {"@id": "voc:Film"}, "rdfs:label": null}],
  "rdfs:label":null
}

it.only("Simple Query", async () => {
  console.log("simple query test")
  let pattern = RootQueryPattern.make(query5)
  console.log(pattern.toSparql().toString())
  let bindings = await store.sparqlSelect({queryString: pattern.toSparql().toString()})
  // for (let binding of bindings) {    
  //   console.log(JSON.stringify(binding, null, 2), binding)
  // }
  let result = pattern.fromBindings(bindings)
  result.map(x => JSON.stringify(x)).forEach(console.log)
}).timeout(1000000)