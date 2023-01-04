import { Dataset, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import datasetFactory from "@rdfjs/dataset"
import { make } from "./fdr"
import { TripleStoreClient } from "./triplestore-client"
import { NoChange, QuadAdded, QuadChange, QuadRemoved } from "./changemgmt"

export class SparqlClient {
  constructor(readonly readEndpoint: string, 
              readonly updateEndpoint: string = readEndpoint,
              readonly options: {} = {}) {

  }

  async select(query: string): Promise<Array<object>> {
    let result = await fetch(this.readEndpoint, {
      method: 'post',
      body: query
    })
    let lines = (await result.text()).split('\n')
    let names = lines[0].split(",")
    let rows = []
    for (let i = 1; i < lines.length; i++) {
      let row = {}
      let cols = lines[i].split(",")
      for (let n = 0; n < names.length; n++)
        row[names[n]] = cols[n]
    }
    return rows
  }

  async update(query: string): Promise<object> {
    let result = await fetch(this.updateEndpoint, {
      method: 'post',
      body: query
    })
    return result
  }
}


class SPARQLProtocolClient implements TripleStoreClient {

  client: SparqlClient
  graphs: Set<NamedNode>
  propertyFilter: ((n:NamedNode) => Boolean) = (n) => true
  valueFilter: ((l:Term) => Boolean) = (l) => !l['language'] || l['language'] == 'en'
  
  private n3_format(value: Term): string {
    let n3 = this.n3_format.bind(this)
    if (value.termType == "NamedNode")
      return `<${value.value}>`
    else if (value.termType == "Quad") {
      let quad = value as Quad
      return `<< ${n3(quad.subject)}  <${quad.predicate.value}> ${n3(quad.object)} >>`
    }
    else if (value.termType == "Variable") 
      return `?${value.value}`
    if (value.termType == "Literal") {
      let l = value as Literal
      let result = `"${value.value}"`
      if (l.datatype)
        result += `^^<${l.datatype.value}>`
      if (l.language)
        result += `@<${l.language}>`
      return result
    }
    else
      return value.value
  }

  constructor(readonly endpointUrl: string, 
              readonly updateUrl: string = endpointUrl) {
    this.client = new SparqlClient(
      endpointUrl,
      updateUrl
    )
    this.graphs = new Set<NamedNode>()
  }

  withGraph(graphName: NamedNode): SPARQLProtocolClient {
    this.graphs.add(graphName)
    return this
  }

  basicAuthentication(user: string, password: string): SPARQLProtocolClient {
    this.client = new SparqlClient(
      this.endpointUrl,
      this.updateUrl,
      { authentication: {
        "@type": "basic",
        "user": user,
        "password": password
      }})
    return this
  }

  // new version, supporting RDF*
  // when we have a quad, the 4th component, the named graph may or may
  // not be present - if it's not we use the ones configured in the 
  // through 'withGraph', and if it is present we take it as a "scope"
  // to override (replace) the graphs configured 'through' withGraph. 
  // I'm sure there valid use cases for adding the named graph from the quad
  // to the current list of name graphs, but this feels better.
  //
  // It would be possible to have retrieve all meta-triples alongside all the triples
  // for a given subject together in a single query, something like this:
  //
  // select * where {
  //   << ?s ?p ?o >> ?mp ?mo .
  //  {
  //  select * where {
  //   values ?s { <https://swapi.co/resource/film/5>  }
  //    ?s ?p ?o
  //  }
  //  }
  //  }
  //
  // But not clear if that's useful or desired. The thing is that can have many
  // meta levels theoretically and not obvious where to stop. Also, the prototype
  // of the function would get too complicated if we add another option, e.g.
  // fetch(options, ...subjects:Array)
  async fetch(...subjects: Array<NamedNode | Quad>): Promise<Dataset> {
    let n3 = this.n3_format.bind(this)
    let tripleSubjectQuery = function(quad: Quad, contextual: string): string {
      if (quad.graph && quad.graph.termType != "DefaultGraph") {
        contextual = ` FROM <${quad.graph}>\n`
      }
      return `      
      {
        select ?subject ?property ?value ?metaproperty ?metavalue  where {
          values (?subject ?property ?value) { 
            (<https://swapi.co/resource/film/5>  <https://swapi.co/vocabulary/boxOffice> "90163.2432371946"^^<http://www.w3.org/2001/XMLSchema#string> ) } .
        << ?subject ?property ?value >> ?metaproperty ?metavalue
        }  
      }
     `

    }

    let self = this
    let fromGraphs = ''
    if (this.graphs.size > 0) {      
      this.graphs.forEach(g => fromGraphs += ` FROM <${g.value}>\n` )
    }

    let subqueries: Array<string> = subjects.map(subject => {
      let contextual = fromGraphs
      if (subject.termType == "Quad")
        return tripleSubjectQuery(subject as Quad, fromGraphs)
      else
        return ` 
        {
          select ?subject ?property ?value ${contextual} where {
            values ?subject { ${n3(subject)} } .
            ?subject ?property ?value
          }      
        }
        `  
    })
    
    let data = await this.client.select(` 
      SELECT * WHERE {
        ${subqueries.join("\n\tUNION\n")}
      }`
    )
    const quads: Array<Quad> = []
    data.forEach( row => {      
      let subject = row['subject']
      let prop = row['property']
      let value = row['value']
      if (row.hasOwnProperty("metaproperty")) {
        quads.push(make.quad(make.quad(subject, prop, value), 
                   row["metaproperty"],
                   row["metavalue"]))
      }
      else if (self.propertyFilter.call(self, prop) &&
          self.valueFilter.call(self, value)) {
          quads.push(make.quad(subject, prop, value))
      }
    })
    return datasetFactory.dataset(quads)
  }

  async fetch_old(subject: NamedNode<string>): Promise<[Dataset<Quad>, object]> {
    let self = this
    let fromGraphs = ''
    if (this.graphs.size > 0) {      
      this.graphs.forEach(g => fromGraphs += ` FROM <${g.value}>\n` )
    }
    let data = await this.client.select(` 
      SELECT ?prop ?value ${fromGraphs} WHERE {
        <${subject.value}> ?prop ?value
      }`
    )
    const quads: Array<Quad> = []
    data.forEach( row => {
      let prop = row['prop']
      let value = row['value']
      if (self.propertyFilter.call(self, prop) &&
          self.valueFilter.call(self, value)) {
          quads.push(make.quad(subject, prop, value))
      }
    })
    return [datasetFactory.dataset(quads), {}]
  }
  
  query(query: object): Promise<any> {
    throw new Error('Method not implemented.')
  }

  async modify(changes: QuadChange[]): Promise<object> {
    let n3 = this.n3_format.bind(this)
    // let self = this
    let update = changes.map(ch => {
      if (ch instanceof QuadAdded) {
        let triple = `{ ${n3(ch.quad.subject)} ${n3(ch.quad.predicate)} ${n3(ch.quad.object)} }`
        if (ch.quad.graph.value)
          return `INSERT DATA { GRAPH <${n3(ch.quad.graph)}> ${triple} }`
        else
          return `INSERT DATA ${triple} `
      }
      else if (ch instanceof QuadRemoved) {
        let triple = `{ ${n3(ch.quad.subject)} ${n3(ch.quad.predicate)} ${n3(ch.quad.object)} }`
        if (ch.quad.graph.value)
          return `DELETE DATA { GRAPH <${ch.quad.graph.value}> ${triple} }`
        else
          return `DELETE DATA ${triple} `
      }
      else if (ch instanceof NoChange) {
        return ''
      }      
      else {
        throw new Error("Unknown type of QuadChange " + ch)
      }
    }).join(";")
    try {
      console.log('running update query', update)
      await this.client.update(update) // will throw exception if anything goes wrong
      return { ok: true}
    }
    catch (err) {
      console.error('While running update query', err)
      return {ok:false, error: err}
    }
  }

}

// (async function() {
//   // const endpointUrl = 'https://query.wikidata.org/sparql'
//   const endpointUrl = 'http://localhost:7200/repositories/starwars'
//   let client = new SPARQLProtocolClient(endpointUrl)

//   //let data = await client.fetch(make.named("http://www.wikidata.org/entity/Q243"))
//   let data = await client.fetch(make.named("https://swapi.co/resource/film/5"))

//   console.log("size", data[0].size)
//   for (let x of data[0]) 
//     console.log(x.subject, x.predicate, x.object)
//   console.log("Hello world, again!")
// })()

export default SPARQLProtocolClient