import { Dataset, NamedNode, Quad} from "@rdfjs/types"
import { QuadChange } from "./changemgmt.js"


/**
 * <p>
 * Interacting with a remote RDF endpoint is accomplished through this interface.
 * This is typically a triplestore, but does not have to be. A custom REST
 * interface could be serving RDF data and answering queries through some 
 * non-standard (non-SPARQL) interface. 
 * </p>
 * 
 * <p>
 * The interface for fetching triples based on the subject as well as modifying
 * the graph through quad change objects is well-defined and the same for
 * different implementation. On the other hand, querying is open ended 
 * and depends entirely on the endpoint and therefore it is left to be specified, 
 * including at the interface level, to implementations.
 * </p>
 */
export interface TripleStore {
  /**
   * Retrieve all triples asserted for a given list of subjects. The subjects
   * can be regular `NamedNode` or a quad (triple in a named graph).
   * 
   * @param subjects The list of subjects of interest. 
   * @returns a dataset which contains all the quads with the passed in
   * subjects.
   */
  fetch(...subjects: Array<NamedNode | Quad>): Promise<Dataset>

  /**
   * Apply a set of changes to the remote data store. 
   * 
   * @param changes The changes will result in a SPARQL query where they are applied
   * in the passed in order.
   * @return An object with the `ok` boolean property indicating if the change
   * was successful or not and an `error` property containing the error in case
   * of failure.
   */
  modify(changes: Array<QuadChange>): Promise<{ok:boolean, error? : string }> 
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

export interface SPARQLEndpoint {
  /**
   * Run a SPARQL select query and return a list of matches in
   * the form of binding objects indexed by the variables in the
   * select clause.
   * 
   * @param query A valid SPARQL select query. For example
   * `select ?sub ?label where { ?sub rdfs:label ?label }`
   * @return An array of bindings, i.e. objects with properties
   * the SPARQL select variables. For example 
   * `[ {"sub":"http://dbpedia.org/resource/New_York_City", "label": "Mew York" } ]`
   */
  sparqlSelect(query: { queryString: string } ): Promise<Array<object>>
}

export type Quads = Dataset<Quad, Quad>