import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"
import { DomainAnnotatedFactories, ResolverHolder, basicDomainFactories } from "../../src/index.js"
import entityFactories, { attribute, entity, relation } from "../../src/fdr/entity-factory.js"
import { RootQueryPattern, safeStringify } from "../../src/fdr/query.js"

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
  "@id": "voc:Aleena",
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
    "rdfs:label": null,
    "voc:terrain": null,
    "voc:resident": [{ "@type": { "@id": "voc:Droid"}}]
  }
}

const query8 = {
  "@type": {"@id" : "voc:Planet"},
  "voc:surfaceWater >": 20
}

const query9 = {
  "@type": {"@id" : "voc:Planet"},
  "voc:surfaceWater ?": null
}

const query10 = {
  "@type": {"@id" : "voc:Planet"},
  "@ref": "planet",
  "voc:resident": {
    "@type": {"@id" : "voc:Human"}, 
    "rdfs:label": null,
    "voc:homeworld": { "@pattern": "planet" }
  },
  "rdfs:label": null,
  "voc:population": null,
  "voc:climate": null
  // ,
  // "voc:film": {
  //   "rdfs:label": null,
  //   "voc:character": {
  //     "@type": {"@id" : "voc:Human"}, 
  //     "rdfs:label": null,
  //     "voc:pilot": { 
  //       "voc:film": { "@fetchAll": true }
  //     }
  //   }
  // }
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
  let result = await executeQuery(query10)
  // assert.equal(result.length, 1)
  // assert.equal(result[0]["rdfs:label"], "Obi-Wan Kenobi") 
  // console.log(JSON.stringify(result))
  safeStringify(result)
}).timeout(10000)

it("Fetch by ID with no properties", async () =>   {
  let result = await executeQuery(query0)
  assert.equal(result.length, 1)
  assert.equal(result[0]["@id"], query0["@id"]) 
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


it("Fetch multi-valued skinColor property for Aleena", async () => {
  const result = await executeQuery(query4);

  // 1. Verify structure
  expect(result).to.be.an('array').with.lengthOf(1);

  // 2. Check identity
  expect(result[0]["@id"]).to.equal("voc:Aleena");

  // 3. Verify multi-valued property regardless of order
  // .have.members checks for exact set equality (ignores order)
  expect(result[0]["voc:skinColor"])
    .to.be.an('array')
    .to.have.members(["blue", "gray"]);

  // Note: if you only wanted to check that it contains these WITHOUT 
  // failing if extra colors are added later, you would use .include.members
}).timeout(10000);

it("Fetch character with nested films, labels, and IRIs", async () => {
  const result = await executeQuery(query5);

  expect(result).to.be.an('array').with.lengthOf(1);
  const character = result[0];
  const films = character["voc:film"];

  // 1. Verify we have the full set of films
  expect(films).to.be.an('array').with.lengthOf(6);

  // 2. Spot check specific films by their full object structure
  // Using deep.include allows us to check for specific objects within the array
  expect(films).to.deep.include({
    "@id": "https://swapi.co/resource/film/1",
    "rdf:type": { "@id": "voc:Film" },
    "rdfs:label": "A New Hope"
  });

  expect(films).to.deep.include({
    "@id": "https://swapi.co/resource/film/6",
    "rdf:type": { "@id": "voc:Film" },
    "rdfs:label": "Revenge of the Sith"
  });

  // 3. Alternatively, if you want to check just the IDs and Labels more cleanly:
  const filmSummary = films.map(f => ({ id: f["@id"], label: f["rdfs:label"] }));

  expect(filmSummary).to.deep.include({ 
    id: "https://swapi.co/resource/film/2", 
    label: "The Empire Strikes Back" 
  })
}).timeout(10000)

it("Fetch recursive FOAF knows chain for Obi-Wan", async () => {
  const result = await executeQuery(query6);

  // 1. Root: Obi-Wan (Human 10)
  expect(result).to.be.an('array').with.lengthOf(1);
  const obiWan = result[0];
  expect(obiWan["@id"]).to.equal("https://swapi.co/resource/human/10");
  expect(obiWan["rdfs:label"]).to.equal("Obi-Wan Kenobi");

  // 2. Level 1: Knows Human 5 (Leia)
  const level1 = obiWan["foaf:knows"];
  expect(level1["@id"]).to.equal("https://swapi.co/resource/human/5");

  // 3. Level 2: Knows Human 1 (Luke)
  const level2 = level1["foaf:knows"];
  expect(level2["@id"]).to.equal("https://swapi.co/resource/human/1");

  // 4. Level 3: Luke knows an ARRAY [Human 14, Human 4]
  const level3 = level2["foaf:knows"];
  expect(level3).to.be.an('array').with.lengthOf(2);

  // We check for members using deep.include to ignore order
  // Check for Han Solo (Human 14) branch
  expect(level3).to.be.deep.include({
    "@id": "https://swapi.co/resource/human/14",
    "foaf:knows": {
      "@id": "https://swapi.co/resource/human/25"
    }
  });

  // Check for Darth Vader (Human 4) branch
  expect(level3).to.be.deep.include({
    "@id": "https://swapi.co/resource/human/4",
    "foaf:knows": {
      "@id": "https://swapi.co/resource/human/35",
      "foaf:knows": {
        "@id": "https://swapi.co/resource/human/11"
      }
    }
  });
}).timeout(10000)

it("Fetch humans on planets with droid residents", async () => {
  const result = await executeQuery(query7);

  // 1. Basic result check
  expect(result).to.be.an('array').with.length.at.least(2);

  // Helper to find a specific human by label
  const findHuman = (label: string) => result.find((h: any) => h["rdfs:label"] === label);

  // 2. Test Planet: Tatooine (checking Darth Vader)
  const vader = findHuman("Darth Vader");
  expect(vader, "Darth Vader should be in the result").to.exist;

  // a) Test @fetch: all 
  expect(vader).to.have.property("voc:skinColor", "white");
  expect(vader).to.have.property("voc:eyeColor", "yellow");
  expect(vader).to.have.property("voc:height", "202.0");

  // b) Test Planet properties & Droid requirement
  const tatooine = vader!["voc:homeworld"];
  expect(tatooine["rdfs:label"]).to.equal("Tatooine");
  expect(tatooine["voc:terrain"]).to.equal("desert");
  
  const tatooineDroids = tatooine["voc:resident"].map((r: any) => r["@id"]);
  expect(tatooineDroids).to.include("https://swapi.co/resource/droid/2");

  // 3. Test Planet: Naboo (checking Padmé Amidala)
  const padme = findHuman("Padmé Amidala");
  expect(padme, "Padmé should be in the result").to.exist;

  const naboo = padme!["voc:homeworld"];
  expect(naboo["rdfs:label"]).to.equal("Naboo");
  // CRITICAL: Ensure this uses bracket notation
  expect(naboo["voc:terrain"]).to.contain("swamps");

  const nabooDroids = naboo["voc:resident"].map((r: any) => r["@id"]);
  expect(nabooDroids).to.include("https://swapi.co/resource/droid/3");

  // 4. Verify multiple humans from the same planet
  const humanLabels = result.map((h: any) => h["rdfs:label"]);
  expect(humanLabels).to.include.members(["Padmé Amidala", "Palpatine", "Gregar Typho"]);
}).timeout(10000)

it("Test arithmetic operator filter: planets with surfaceWater strictly greater than 20", async () => {
  const result = await executeQuery(query8);

  // 1. Basic collection check
  expect(result).to.be.an('array').and.not.be.empty;

  // 2. Loop through every returned planet to enforce the filter rule
  result.forEach((planet: any) => {
    // Ensure the property exists on every item
    expect(planet).to.have.property("voc:surfaceWater");

    // Convert the string-encoded RDF literal to a real number for comparison
    const waterValue = parseFloat(planet["voc:surfaceWater"]);

    // Assert that the condition (> 20) holds true for this item
    expect(waterValue).to.be.greaterThan(20, 
      `Planet ${planet["@id"]} failed the filter with a value of ${planet["voc:surfaceWater"]}`
    );
  });
}).timeout(10000)

it("Fetch with a single optional attribute: planets with maybe surfaceWater", async () => {
  const result = await executeQuery(query9);

  // 1. Ensure we got a rich array back
  expect(result).to.be.an('array').with.length.at.least(40);

  // 2. Separate planets with surfaceWater from those without
  const planetsWithWater = result.filter((p: any) => p.hasOwnProperty("voc:surfaceWater"));
  const planetsWithoutWater = result.filter((p: any) => !p.hasOwnProperty("voc:surfaceWater"));

  // 3. Assert that both query groups exist (proving OPTIONAL mechanism works)
  expect(planetsWithWater.length).to.be.greaterThan(0);
  expect(planetsWithoutWater.length).to.be.greaterThan(0);

  // 4. Spot check specific content to be sure the mapping is flawless
  
  // Planet 25 has no surface water
  const planet25 = result.find((p: any) => p["@id"] === "https://swapi.co/resource/planet/25");
  expect(planet25).to.exist;
  expect(planet25).to.not.have.property("voc:surfaceWater");

  // Planet 4 (Hoth/Alderaan depending on mapping) has 100 surface water
  const planet4 = result.find((p: any) => p["@id"] === "https://swapi.co/resource/planet/4");
  expect(planet4).to.exist;
  expect(planet4!["voc:surfaceWater"]).to.equal("100");

  // Planet 12 has a decimal point "0.9"
  const planet12 = result.find((p: any) => p["@id"] === "https://swapi.co/resource/planet/12");
  expect(planet12).to.exist;
  expect(planet12!["voc:surfaceWater"]).to.equal("0.9");
}).timeout(10000)