import { Dataset, NamedNode, Quad } from "@rdfjs/types"
import { Restish } from "../rest"
import { QuadAdded, QuadChange } from "./changemgmt"
import { make } from "./fdr"
import datasetFactory from "@rdfjs/dataset"

export interface TripleStoreClient {
  /**
   * fetch the description of a named node
   * @param named 
   * @returns a dataset which contains all the quads which have this
   * named node as their subject
   */
  fetch(named: NamedNode): Promise<[Dataset, object]>

  /**
   * Query the triplestore. 
   * The idea is to have this accept a query of some sort (e.g. SPARQL) and return the NamedNodes which match it. 
   * 
   * TODO 
   *  the result set might be something other than array of IRIs and
   *  we must support that
   *  RDFJS has the query interface, consider implementing that
   *  
   * @param query the query to execute
   * @returns a promise which resolves with a value containing the result set of that query 
   */
  query(query: object): Promise<any>
  modify(changes: Array<QuadChange>): Promise<object>
  
}

export class RestBackedTriples implements TripleStoreClient {

  private restClient: Restish

  private ensureOk(r: { ok: boolean, error: string }, action: string) {
    if (!r.ok)
      throw new Error("While " + action + ": " + r.error)
  }

  constructor(readonly endpoint: string, readonly graphname: string) {
    this.restClient = new Restish(endpoint) 
  }

  /**
   * Fetch the description of a specific named node i.e. the dataset with
   * all quads which have the 
   * @param iri 
   * @returns A dataset with all the quads which have the given named node as 
   * a subject 
   */
  async fetch(node: NamedNode): Promise<[Dataset, object]> {
    const result = await this.restClient.get(
      "/" + this.graphname + 
      "/subjectProperties/" + encodeURIComponent(node.value))
    this.ensureOk(result, "fetching " + node.value)
    return this.readDataset(node, result.data, result.annotation)
  }

  /**
   * Read JSON triples into a Dataset object
   * @param node The 
   * @param data 
   * @param annotation 
   * @returns 
   */
  readDataset(node : NamedNode, data, annotation) : [Dataset, object] {
    const quads: Array<Quad> = []
    Object.keys(data).map(key => {
      const value = data[key]
      if (typeof value == "object" ) {
        // object relationship
        quads.push(make.quad(node, make.named(key), make.named(value['@id'])))
      }
      else {
        // literal value
        quads.push(make.quad(node, make.named(key), make.literal(value)))
      }
    })
    return [datasetFactory.dataset(quads), annotation]
  }

  async modify(changes: Array<QuadChange>): Promise<object> {
    const post: Array<object> = []
    changes.forEach( (change: QuadChange) => {      
      let x = { "subject": {'@id': change.quad.subject.value},
                "property": change.quad.predicate.value }
      if (change.quad.object.termType == "NamedNode")
        x['value'] = {'@id': change.quad.object.value}
      else
        x['value'] = change.quad.object.value
      if (change instanceof QuadAdded) {
        x['type'] = 'add'
        x['annotation'] = change.annotation
      }
      else {
        x['type'] = 'remove'
      }
      x['graphId'] = this.graphname
      post.push(x)
    })
    return this.restClient.post("/update", post)
  }

  /**
   * Fetch the result of a query 
   * @param query 
   * @returns The subjects which match the given query
   * TODO what is a set of iris? dataset? set<string>? how do we ingest that
   */
  async query(query: object): Promise<any> {    
      const response = await this.restClient.post(`/${this.graphname}/query`, query)
      const resultsetType = response.resultSetType
      switch (resultsetType) {
        case 'IRIS':
            return response.data
        case 'LITERALS':
          return response.data
        case 'DATASET' :
          return this.readDataset(make.named(response.about), response.data, response.annotation)
      }
  }
}

/**
 * Represents an object which can ingest a dataset and parse it into
 * its own state.
 * 
 * A dataset is either the RDFJS Dataset interface, array of IRIs, or
 * an array of literal values
 */
export interface DatasetIngester {
  
  /**
   * Ingest the dataset into the state of the object 
   * @param dataset 
   */
  ingest(dataset: Dataset|string[]): void
}
