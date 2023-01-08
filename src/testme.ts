import { DatasetCore, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import { NoChange, QuadAdded, QuadChange, QuadRemoved } from "./fdr/changemgmt.js"
import { make } from "./fdr/fdr.js"
import SPARQLProtocolClient from "./fdr/sparql-triplestore-client.js"

function setupEndpoint(): SPARQLProtocolClient {
  const endpointUrl = 'http://obelix:7200/repositories/starwars'
  let client = new SPARQLProtocolClient(endpointUrl, endpointUrl + "/statements")
  return client
}
  
function coreSetToArray(coreset: DatasetCore): Array<Quad> {
  let result: Array<Quad> = []
  for (const el of coreset)
    result.push(el)
  return result
}
 
/**
* Given a set of quads, extract the values (i.e. the "object" part)
* from the ones where the predicate is 'prop'
* @param prop The predicate of interest.
* @param set The set of quads.
* @returns An array of all the values for that property.
*/
function valuesOf(prop: NamedNode, set: DatasetCore): Array<Term> {
let A: Array<Term> = []
for (const el of set.match(null, prop, null, null)) {
  // console.log('el.object', el.object, typeof el.object)
  A.push(el.object)
}
return A
}

function assert(yesorno, msg) {
  if (!yesorno) {
    throw new Error("TEST ERROR: " + msg)
  }
}

console.log('Hello Test!')

let endpoint = setupEndpoint()
let film = make.named("https://swapi.co/resource/film/5")
let boxofficeProp = make.named('https://swapi.co/vocabulary/boxOffice')
let confidences = {}
let annotatedTriples: Array<Quad> = []

// Step 1: get all values for the box office amount for the film and
// annotate them with some random confidence value.
let changes: Array<QuadChange> = 
  valuesOf(boxofficeProp, (await endpoint.fetch(film))).map(val => {
    confidences[val.value] = Math.random()
    let triple = make.quad(film, boxofficeProp, val)
    let quad = make.metaQuad(triple,
            make.named("rdfs:label"), 
            make.literal(confidences[val.value]),
            triple.graph)
    annotatedTriples.push(triple)
    return new QuadAdded(quad)
  })
let result = await endpoint.modify(changes)
// console.log('modify result', result)

// Step 2: Read back the annotations, check that they are correct and
// then remove them.
let storedAnnotations = await endpoint. fetch(...annotatedTriples)
let errors: Array<string> = []
changes = annotatedTriples.map(triple => {
  let A = storedAnnotations.match(triple, make.named("rdfs:label"))
  if (A.size == 0) {
    errors.push("No annotations stored for triple " + triple)
    return new NoChange()
  }
  else {
    let asarray: Array<object> = []
    for (let t of A) asarray.push(t)
    let confidence = asarray[0]['object'] as Literal        
    if (confidences[(triple.object as Literal).value] != confidence.value)
      errors.push("Confidence value for " + triple.subject.value + " : " + triple.object.value + 
            " is the unexpected " + confidence.value)
    return new QuadRemoved(make.metaQuad(triple, make.named("rdfs:label"), confidence, triple.graph))
  }
})

// now let's just try to fetch a mix of triples and a regular subject
let mixedData = await endpoint.fetch(...annotatedTriples, film)
for (let boxtriple of mixedData.match(film, boxofficeProp)) {
  // console.log(boxtriple)
  if (mixedData.match(boxtriple).size == 0)
    errors.push("No annotation for " + boxtriple.value)
}

result = await endpoint.modify(changes)

assert(errors.length == 0, "There were errors: " + errors.join("\n\n\n"))

// Step 3: make sure the annotations were properly removed
assert(annotatedTriples.length == changes.length, "Expecting " + annotatedTriples.length + " changes for new annotated triples.")
storedAnnotations = await endpoint.fetch(...annotatedTriples)
assert(storedAnnotations.size == 0, "There are still annotations to boxoffice triples not removed.")