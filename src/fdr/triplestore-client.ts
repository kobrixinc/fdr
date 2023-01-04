import { Dataset, NamedNode, Quad} from "@rdfjs/types"
import { QuadChange } from "./changemgmt.js"

export interface TripleStoreClient {
  /**
   * fetch the description of a named node
   * @param named 
   * @returns a dataset which contains all the quads which have this
   * named node as their subject
   */
  fetch(...subjects: Array<NamedNode | Quad>): Promise<Dataset>
  // fetch(named: NamedNode): Promise<[Dataset, object]>

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
