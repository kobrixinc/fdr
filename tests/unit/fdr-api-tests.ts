import { assert, expect } from "chai"
import { fdr, fdrmake }  from "../../src/fdr/fdr.js"
import SPARQLProtocolClient from "../../src/fdr/sparql-triplestore-client.js"

const prefixes: {[key: string]: any}  = {
  "dbr": "http://dbpedia.org/resource/",
  "dbo": "http://dbpedia.org/ontology/",
  "dbp": "http://dbpedia.org/property/",
  "foaf": "http://xmlns.com/foaf/0.1/",
  "ulsini": "http://ulsini.org/ontology/"
}

describe("FDR API Tests", function() {
  let store = new SPARQLProtocolClient("https://dbpedia.org/sparql", 
  "https://dbpedia.org/sparql/statements")
  let graph = fdr.graph({ store })
  fdr.resolver.prefixResolver.withPrefixes(prefixes)

  it("Environment configured with DBPedia", async () => {
    
    let subject = graph.factory.subject(fdr.subjectId("dbr:Miami"))
    subject = await graph.use(subject)

    let abstract = subject.get("dbo:abstract", "ca")

    console.log(abstract)

  }).timeout(20000)
  
  it("fdr, fdrmake resolution should work together", async () => {
    
    fdr.resolver.prefixResolver.withPrefixes(prefixes)

    let fdr_resolved = fdr.resolver.resolve("dbo:abstract")
    let fdrmake_resolved = fdrmake.maker.resolver.resolve("dbo:abstract")
    expect(fdr_resolved).to.equals(fdrmake_resolved)

  }).timeout(20000)
  
  it("fdr, fdrmake config should work together", async () => {
    fdr.config.lang = 'bg'
    expect(fdrmake.maker.config.lang).to.equals('bg')

  }).timeout(20000)

  it.only("cache uses proper key comparison", async () => {
    let id1 = fdr.subjectId("dbr:Miami")
    let subject = graph.factory.subject(id1)
    expect(subject.ready).to.be.false
    let subject_ready = await graph.use(subject)
    expect(subject_ready.ready).to.be.true
    subject = graph.factory.subject(id1)
    expect(subject.ready).to.be.true
    let id2 = fdr.subjectId("dbr:Miami")
    let subject2 = graph.factory.subject(id2)
    expect(subject2.ready).to.be.true
  }).timeout(20000)

  it("changing a working copy should not change the primary copy", async () => {
    let subject = graph.factory.subject(fdr.subjectId("dbr:Miami"))
    subject = await graph.use(subject)
    let wc = subject.workingCopy()
    expect(wc.get("dbp:name")).to.equals('Miami')
    wc.set("dbp:name", "Sweet Water")
    expect(wc.get("dbp:name")).to.equals('Sweet Water')
    expect(subject.get("dbp:name")).to.equals('Miami')
    wc.commit()
    expect(wc.get("dbp:name")).to.equals('Sweet Water')
  }).timeout(20000)
})