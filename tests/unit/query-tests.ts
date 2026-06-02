import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { DomainAnnotatedFactories, ResolverHolder, basicDomainFactories } from "../../src/index.js"
import entityFactories, { attribute, entity, relation } from "../../src/fdr/entity-factory.js"
import { RootQueryPattern } from "../../src/fdr/query.js"

const prefixes: {[key: string]: any}  = {
  "voc": "https://swapi.co/vocabulary/",
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  "foaf": "http://xmlns.com/foaf/0.1/"
}

let endpointurl = 'http://localhost:7200/repositories/starwars'
let store = new SPARQLProtocolClient(endpointurl, endpointurl + "/statements")

fdr.resolver.prefixResolver.withPrefixes(prefixes)


const query0 = {
  "@id": "https://swapi.co/resource/human/10"
}

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
    "rdfs:label": "Stewjon",
    "voc:terrain": null
  }
}

const query4 = {
  "@id": "https://swapi.co/resource/human/88",
  "voc:skinColor": []
}

const query5 = {
  "@id": "https://swapi.co/resource/human/10",
  "voc:film": [{"@type": {"@id": "voc:Film"}, "rdfs:label": null}],
  "rdfs:label":null
}

const query6 = {
  "@id": "https://swapi.co/resource/human/10",
  "@ref": "me",
  "foaf:knows": {"@pattern": "me"},
  "rdfs:label":null
}

const query7 = {
  "@type": {"@id" : "voc:Human"},
  "@fetch": "all", 
  "voc:homeworld": {
    "@type": "voc:Planet",
    "rdfs:label": "Stewjon",
    "voc:terrain": null,
    "voc:resident": [{ "@type": { "@id": "voc:Droid"}}]
  }
}

const query8 = {
  "@type": {"@id" : "voc:Planet"},
  "voc:surfaceWater >": 20
}


async function executeQuery(query: object): Promise<Array<object>> {
  console.log("Query: ", JSON.stringify(query))
  let pattern = RootQueryPattern.make(query)
  console.log(pattern.toSparql().toString())
  let bindings = await store.sparqlSelect({queryString: pattern.toSparql().toString()})
  let result = pattern.fromBindings(bindings)
  // result.map(x => JSON.stringify(x)).forEach(console.log)
  return result
}

it.only("ONE TEST DEBUGGING", async () =>   {
  let result = await executeQuery(query8)
  // assert.equal(result.length, 1)
  // assert.equal(result[0]["rdfs:label"], "Obi-Wan Kenobi") 
  console.log(JSON.stringify(result))
}).timeout(10000)


it("Fetch by ID with label", async () =>   {
  let result = await executeQuery(query1)
  assert.equal(result.length, 1)
  assert.equal(result[0]["rdfs:label"], "Obi-Wan Kenobi") 
}).timeout(10000)

it("Fetch by type with label", async () =>   {
  let result = await executeQuery(query2)

  expect(result).to.be.an('array');

  // 2. Check that it has at least 30 humans
  expect(result.length).to.be.at.least(30);

  // 3. Extract the labels/names to make searching easier
  // Assuming the engine returns objects where "rdfs:label" is a key
  const names = result.map(h => h["rdfs:label"]);

  // 4. Verify specific iconic characters are present
  const expectedCharacters = [
    "Luke Skywalker",
    "Leia Organa",
    "Obi-Wan Kenobi",
    "Han Solo",
    "Darth Vader"
  ];

  expectedCharacters.forEach(name => {
    expect(names).to.include(name, `Result should have included ${name}`);
  });

  // 5. Optional: Verify the structure of an item
  if (result.length > 0) {
    expect(result[0]).to.have.property('@id');
    expect(result[0]).to.have.property('rdfs:label');
  }

}).timeout(10000)

it("Fetch all humans on Stewjon with all their properties", async () =>   {
  const result = await executeQuery(query3)

  // 1. Check it's a single element array
  expect(result).to.be.an('array').with.lengthOf(1)
  const obiWan = result[0]

  // 2. Identity and basic labels
  expect(obiWan["rdfs:label"]).to.equal("Obi-Wan Kenobi")
  expect(obiWan["@id"]).to.include("human/10")

  // 3. Check types (using deep.include since it's an array of objects)
  expect(obiWan["rdf:type"]).to.be.an('array')
  expect(obiWan["rdf:type"]).to.deep.include({ "@id": "voc:Human" })

  // 4. Validate the Homeworld nested object
  expect(obiWan["voc:homeworld"]).to.be.an('object')
  expect(obiWan["voc:homeworld"]['rdfs:label']).to.equal("Stewjon")
  expect(obiWan["voc:homeworld"]['voc:terrain']).to.equal("grass")

  // 5. Physical Characteristics
  expect(obiWan["voc:skinColor"]).to.equal("fair")
  expect(obiWan["voc:eyeColor"]).to.equal("blue-gray")
  expect(obiWan["voc:height"]).to.equal("182.0")
  expect(obiWan["voc:gender"]).to.equal("male")

  // 6. Check Films (at least 6 films as per your result)
  expect(obiWan["voc:film"]).to.be.an('array').with.lengthOf(6)
  // Spot check a specific film URI (e.g., Film 1)
  const filmIds = obiWan["voc:film"].map(f => f["@id"])
  expect(filmIds).to.include("https://swapi.co/resource/film/1")

  // 7. Check Starships
  expect(obiWan["voc:starship"]).to.be.an('array')
  const starshipIds = obiWan["voc:starship"].map(s => s["@id"])
  // Checking for a few known ones from your result list
  expect(starshipIds).to.include.members([
    "https://swapi.co/resource/starship/48",
    "https://swapi.co/resource/starship/59"
  ])
}).timeout(20000)
