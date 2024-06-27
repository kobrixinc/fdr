import { Dataset, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import datasetFactory from "@rdfjs/dataset"
import rdf from 'rdf-ext'
import { fdr, rdfjs } from "./fdr.js"
import { SPARQLEndpoint, TripleStore } from "./triplestore-client.js"
import { KBChange, NoChange, QuadAdded, QuadChange, QuadRemoved } from "./changemgmt.js"
import fetch from "isomorphic-fetch"
import { SubjectId } from "./dataspecAPI.js"

export class Var {
  constructor(readonly name: string) { }

  private static sequence: number = 0
  /**
   * 
   * @returns Newly generated variables look like "?v_nnn" where
   * nnn is a sequence starting from 1.
   */
  static make(): Var { 
    return new Var("v_" + (++Var.sequence))
  }

  equals(other: any): boolean {
    return other instanceof Var && other.name == this.name
  }

  toString(): string {
    return "?" + this.name
  }
}

export class QuerySubject {
  constructor(readonly iri: string) { }
  equals(other: any): boolean {
    return other instanceof QuerySubject && other.iri == this.iri
  }

  toString(): string {
    return "<" + this.iri + ">"
  }

  static make(shortname: string): QuerySubject {
    return new QuerySubject(rdfjs.named(shortname).value)
  }
}

type Node = QuerySubject | Var | Literal

function nodeEquals(x: Node, y: Node): boolean {
  if (x instanceof Var) return (x as Var).equals(y)
  else if (x instanceof QuerySubject) return (x as QuerySubject).equals(y)
  else return x.value == (y as Literal).value
}

/**
 * For testing purpose, like nodeEquals, but will return true also
 * if both are falsy (i.e. undefined or null) or if both are variables
 * possibly with different names
 */
function nodeSimilar(x: Node, y: Node): boolean {
  if (!x) return !y
  else if (x instanceof Var) return (y instanceof Var)
  else if (x instanceof QuerySubject) return (x as QuerySubject).equals(y)
  else return x.value == (y as Literal).value
}

function nodeToString(x: Node): string {
  if (x instanceof Var)
    return x.toString()
  else if (x instanceof QuerySubject)
    return x.toString()
  else
    return '"' + x.value + '"'
}

export class Triple {
  constructor(readonly sub: Node, 
              readonly pred: Node, 
              readonly obj: Node)
  {}

  like(other: Triple): boolean {
    return nodeSimilar(this.sub, other.sub) &&
           nodeSimilar(this.pred, other.pred) &&
           nodeSimilar(this.obj, other.obj)
  }

  equals(other: any): boolean {
    return other instanceof Triple &&
          nodeEquals(this.sub, other.sub) &&
          nodeEquals(this.pred, other.pred) &&
          nodeEquals(this.obj, other.obj)
  }

  /**
   * Return a string suitable for Turtle/SPARQL output.
   */
  toString(): string {
    return nodeToString(this.sub) + " " + 
           nodeToString(this.pred) + " " + 
           nodeToString(this.obj) + " ."
  }
}


export class QueryPattern {
  subject: Node
  triples: Array<Triple> = []
  related: Record<string, QueryPattern> = {}

  constructor(readonly struct: object) { 
    this.subject = this.struct.hasOwnProperty('@id') && this.struct['@id']
    ? new QuerySubject(rdfjs.named(this.struct['@id']).value)
    : Var.make()
  }

  patternFromStructure(): QueryPattern {
    Object.keys(this.struct).forEach(key => {
      if ("@context" == key || "@id" == key) {
        // ignore for now, we assume context is globally set      
        return
      }
      let value = this.struct[key]
      let obj: Node | null = null
      let pred: Node | null = null
      if ("@type" == key) {
        pred = new QuerySubject(rdfjs.named("rdf:type").value)
        obj = value ? new QuerySubject(rdfjs.named(value).value) : Var.make()
      }
      else {
        // need to deal with operators here eventually
        pred = new QuerySubject(rdfjs.named(key).value)
        if (value == null) {
          obj = Var.make()
        }
        else if (typeof value == "object") {
          obj = Var.make()
          let nestedPattern = new QueryPattern(value)
          nestedPattern.subject = obj
          nestedPattern.patternFromStructure()
          this.related[pred.iri] = nestedPattern          
        }
        else
          obj = rdfjs.literal(value)
      }
      this.addTriple(this.subject, pred, obj)
    })
    return this
  }

  addTriple(sub: Node, pred: Node, obj: Node): QueryPattern {
    this.triples.push(new Triple(sub, pred, obj))
    return this
  }

  bindingsToMatch(bindings: object): object {
    let result = {}
    if (this.subject instanceof QuerySubject) {
      result['@id'] = this.subject.iri
    }
    else { // var 
      result['@id'] = bindings[(this.subject as Var).name].value
    }
    this.triples.forEach(t => {
      if (!nodeEquals(t.sub, this.subject)) {
        throw new Error("Unexpected triple with different subject: " + t.sub)
      }
      let predicateIri = (t.pred as QuerySubject).iri
      let nestedPattern = this.related[predicateIri]
      let propname = fdr.resolver.inverse().resolve(predicateIri)
      let propvalue 
      if (t.obj instanceof Var) {
        if (nestedPattern) {
          propvalue = nestedPattern.bindingsToMatch(bindings)
        }
        else {
          propvalue = bindings[t.obj.name] 
          if (propvalue.type == "literal")
            propvalue = propvalue.value
          else if (propvalue.type == "uri")
            propvalue = fdr.resolver.inverse().resolve(propvalue.value)
        }
      }
      else if (t.obj instanceof QuerySubject)
        propvalue = fdr.resolver.inverse().resolve((t.obj as QuerySubject).iri)
      else 
        propvalue = (t.obj as Literal).value
      result[propname] = propvalue
    })

    return result
  }

  get allTriples(): Array<Triple> {
    let result = [...this.triples]
    Object.values(this.related).forEach(nested => {
      result.push.apply(result, nested.allTriples)
    })
    return result
  }

  toSparql(): string {
    let query = "select * where { \n "
    this.allTriples.forEach(t => {
      query += t.toString() + "\n"
    })
    query += "}"
    return query
  }
}


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
  
  async match(queryPattern: object): Promise<Array<object>> {
    let pattern = new QueryPattern(queryPattern)
    pattern.patternFromStructure()
    // console.log(pattern)    
    let bindings = await this.sparqlSelect({queryString: pattern.toSparql()})
    let result: Array<object> = []
    bindings.forEach(binding => {
      let match = pattern.bindingsToMatch(binding)
      // console.log(match)
      result.push(match)
    })
    return result
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