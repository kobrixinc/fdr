import { Dataset, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import datasetFactory from "@rdfjs/dataset"
import rdf from 'rdf-ext'
import { rdfjs } from "./fdr.js"
import { SPARQLEndpoint, TripleStore } from "./triplestore-client.js"
import { KBChange, NoChange, QuadAdded, QuadChange, QuadRemoved } from "./changemgmt.js"
import fetch from "isomorphic-fetch"

export class SparqlClient {
  constructor(readonly readEndpoint: string, 
              readonly updateEndpoint: string = readEndpoint,
              readonly options: {} = {}) {

  }

  async select(query: string): Promise<Array<object>> {
    let formBody: Array<string> = []
    let details = {query}
    for (var property in details) {
      var encodedKey = encodeURIComponent(property)
      var encodedValue = encodeURIComponent(details[property])
      formBody.push(encodedKey + "=" + encodedValue)
    }

    // const url = new URL(this.readEndpoint);
    // url.searchParams.append('query', query);
    // url.searchParams.append('format', 'json');
    // let result = await fetch(url)

    // console.log('select body', formBody.join("&"))

    let result = await fetch(this.readEndpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type':'application/x-www-form-urlencoded',
        'Accept':'application/sparql-results+json'
      },
      body: formBody.join("&")
    })

    // console.log('SPARQL fetch result', result)
    
    if (result.status != 200)
      throw new Error(await result.text())
    let matches: Array<object> = []
    // of course, for big results this might be a issue, streaming is better
    // but improvement won't be much because ultimately this function
    // has to return an array
    let queryResult = await result.text()
    JSON.parse(queryResult)['results']['bindings'].forEach(binding => {
      matches.push(binding)
    })
    return matches
  }

  async update(query: string): Promise<object> {
    console.log(query)
    let result = await fetch(this.updateEndpoint, {
      method: 'post',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: query
    })
    let responseBody = await result.text()
    console.log(result, responseBody)
    if (result.status >= 400) // we don't know to handle redirects and such
      throw new Error(responseBody)
    return result
  }
}

export class SPARQLProtocolClient implements TripleStore, SPARQLEndpoint {

  client: SparqlClient
  graphs: Set<NamedNode>
  propertyFilter: ((n:NamedNode) => Boolean) = (n) => true
  valueFilter: ((l:Term) => Boolean) = (l) => true //  !l['language'] || l['language'] == 'en'
  
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

  jsonToTerm(x: object): Literal|NamedNode{
    if (x['type'] == 'uri')
      return rdfjs.named(x['value'])
    else {
      return rdfjs.literal(
        x['value'], 
        (x['datatype'] && x['datatype']) ? rdfjs.named(x['datatype']) : x['xml:lang'])
    } // if (x['type'] == 'literal')
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
            (${n3(quad.subject)}  ${n3(quad.predicate)} ${n3(quad.object)} ) } .
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
    
    let queryString = ` 
      SELECT * WHERE {
        ${subqueries.join("\n\tUNION\n")}
      }`
    let data = await this.client.select(queryString)
    const quads: Array<Quad> = []
    data.forEach( row => {      
      let subject = this.jsonToTerm(row['subject']) as NamedNode
      let prop = this.jsonToTerm(row['property']) as NamedNode
      let value = this.jsonToTerm(row['value'])
      if (row.hasOwnProperty("metaproperty")) {
        quads.push(rdfjs.metaQuad(rdfjs.quad(subject, prop, value), 
                   this.jsonToTerm(row["metaproperty"]) as NamedNode,
                   this.jsonToTerm(row["metavalue"])))
      }
      else if (self.propertyFilter.call(self, prop) &&
          self.valueFilter.call(self, value)) {
          quads.push(rdfjs.quad(subject, prop, value))
      }
    })
    return rdf.dataset(quads)
  }
  
  sparqlSelect(query: { queryString: string }): Promise<Array<object>> {
    return this.client.select(query.queryString)
  }

  async modify(changes: KBChange[]): Promise<{ok:boolean, error?:string}> {
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
      return {ok:false, error: String(err)}
    }
  }

}
export default SPARQLProtocolClient