import { assert } from "chai"
import { DatasetCore, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import { rdfjs } from "../../src/fdr/fdr.js"
import SPARQLProtocolClient, { SparqlClient } from "../../src/fdr/sparql-triplestore-client.js"
import { KBChange, NoChange, QuadAdded, QuadChange, QuadRemoved } from "../../src/fdr/changemgmt.js"

describe("SPARQL Protocol Implementation Tests", function() {

  function setupEndpoint(): SPARQLProtocolClient {    const endpointUrl = 'http://localhost:7200/repositories/starwars'
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

  it('Fetches a subject with properties', async () => {
    let client = new SparqlClient("http://localhost:7200/repositories/starwars")
    let result = await client.select("select * where { ?s ?p ?o }")
    console.log('test passed', result)
  }).timeout(20000)

  it('Fetches a subject with properties', async () => {
    let endpoint = setupEndpoint()
    let data = await endpoint.fetch(rdfjs.named("https://swapi.co/resource/film/5"))
    let quads = coreSetToArray(data)
    let boxoffice = data.match(null, rdfjs.named('https://swapi.co/vocabulary/boxOffice'), null, null)
    assert(boxoffice.size > 0, "Could not find voc:boxOffice property")
  })

  it('test literal values', () => {
    let a = rdfjs.literal("Petar")
    let b = rdfjs.literal(30)
    let c = rdfjs.literal(30.123)
    console.log(a)
    console.log(b)
    console.log(c)
  })   

  it('Update the value of boxoffice', async () => {
    let endpoint = setupEndpoint()
    let film = rdfjs.named("https://swapi.co/resource/film/5")
    let boxofficeProp = rdfjs.named('https://swapi.co/vocabulary/boxOffice')
    let changes = 
      valuesOf(boxofficeProp, (await endpoint.fetch(film))).map(val =>
      new QuadRemoved(rdfjs.quad(film, boxofficeProp, val)))

    console.log(`remove changes  ${changes}`  )

    let newboxoffice =  Math.random()*1000000
    changes.push(new QuadAdded(rdfjs.quad(film, boxofficeProp, rdfjs.literal(newboxoffice))))

    let result = await endpoint.modify(changes)
    assert(result.ok, result.error)
    // console.log('modify result', result)
    let newvalues = valuesOf(boxofficeProp, (await endpoint.fetch(film))).map(el => el.value)
    console.log('new values of box office', newvalues)
    assert(newvalues.length == 1, "Expecting a single box office property value.")
    assert(newvalues[0] == ""+newboxoffice, "Expecting a box office value to be new " + newboxoffice)
  })  

  it('Can store and fetch annotations', async () => {
    let endpoint = setupEndpoint()
    let film = rdfjs.named("https://swapi.co/resource/film/5")
    let boxofficeProp = rdfjs.named('https://swapi.co/vocabulary/boxOffice')
    let confidences = {}
    let annotatedTriples: Array<Quad> = []

    // Step 1: get all values for the box office amount for the film and
    // annotate them with some random confidence value.
    let changes: Array<KBChange> = 
      valuesOf(boxofficeProp, (await endpoint.fetch(film))).map(val => {
        confidences[val.value] = Math.random()
        let triple = rdfjs.quad(film, boxofficeProp, val)
        let quad = rdfjs.metaQuad(triple,
                rdfjs.named("rdfs:label"), 
                rdfjs.literal(confidences[val.value]),
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
      let A = storedAnnotations.match(triple, rdfjs.named("rdfs:label"))
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
        return new QuadRemoved(rdfjs.metaQuad(triple, rdfjs.named("rdfs:label"), confidence, triple.graph))
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
  })
})
