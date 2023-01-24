import { Quad } from "@rdfjs/types"
import { PropertyChange } from "./changemgmt.js"
import { LiteralValue } from "./fdr.js"

/*
This module contains all the types the user needs in order to interact with
FDR. 
*/

/**
 * A description of some data. Could be simply a reference, e.g. URI
 * or a query or some other form of a specification what the data is. 
 * In this context, data is its own description.
 * 
 * 
 * The main inspiration for this concept (which probably needs a better
 * name) is the fact that data may not be available locally. We want to
 * have an interface, something that represents some data, but without
 * necessarily having it ready for use yet. A resource in RDF, described
 * via triples where it appears as subject, is the main, basic example
 * of this - having the IRI is in a sense a specification of what data
 * we want to use (all triples with subject that IRI). 
 * 
 * The DataSpec interface is a base interface for the different user-facing
 * types e.g. Subject
 * 
 * 
 * The SELF type parameter is a simulated self type i.e. the user facing types
 * should set this parameter to that specific type so that the DataSpec methods 
 * will return the user-facing type
 */
export interface DataSpec<SELF extends DataSpec<SELF>> {
  /**
   * Construct a working copy of this dataspec.
   * 
   * Changes to a working copy will not be automatically applied to its 
   * backing object. In order to propagate the changes, the user needs to 
   * explicitly call WorkingCopy.commit()
   * 
   * When changes are applied to this object, they are automatically propagated
   * to its working copies
   *  
   * 
   * @param reactivityDecoratorFunction optional function which will apply reactivity to the working copy. 
   * The function is expected to take the working copy, wrap it in a reactive proxy and return the wrapper. 
   * If specified, it will be invoked with the created working copy and the resulting object will be stored as a working copy. 
   * Alternatively the graph itself could allow for setting of a reactivity decorator with the same function 
   */
  workingCopy(reactivityDecoratorFunction? : <T extends SELF>(T) => T) : SELF
  
  /**
   * Commit changes performed to this DataSpec object to its
   * source of truth
   */
  commit() : Promise<void>  
   
   /**
   * Whether this dataspec is ready to use
   */
  ready:boolean
}

/**
 * Objects of this type can be part of a subject change synchronization network.
 * I.e. they support the operations which allow a subject to receive updates
 * coming from other subjects which are copies/sources to this one
 */
export interface SubjectChangeSynchronization {
  /**
   * Synchronize with changes coming from an upstream source of truth
   * @param changes the incoming changes
   */
   syncFromUpstream(changes : PropertyChange[])

   /**
    * Synchronize with changes commited by a downstream copy of this
    * object 
    * @param changes 
    */
   syncFromDownstream(changes : PropertyChange[])

}

/**
 * A dataspec which is part of a remote graph i.e. is a local copy of a remote object.
 * A RemoteDataSpec's definition can be represented like a serializable query which
 * can be sent to the remote graph.
 * The result returned by the remote graph can then be ingested in the RemoteDataSpec
 * state.
 */
export interface RemoteDataSpec<SELF extends DataSpec<SELF>> extends DataSpec<SELF> {
  
  /*
  query and ingest do not need to be separate parts of the public api.
  we could replace them with a separate void method which performs the data
  fetch and ingest. we do not need the raw data at any point in the external
  API
  */

  /**
   * The wire format of this data spec's definition which is to be sent to the
   * remote graph in order to query the dataspec's backing data
   * 
   * This is transport specific and we aim to support different backends so we should
   * leave it to the transport implementation to serialize the DataSpecs
  */

  //query : any

  /**
   * Ingest the result set of running the query into this dataspec's state
   * @param result 
   */
  ingest(result : any)
}

export type PropertyValue = LiteralValue | Subject


/**
 * The identifier of a subject
 * 
 * All implementations of this interface need to be immutable
 * 
 */
export interface SubjectId {
  toString()
  equals(other : SubjectId)
} 

export class IRISubjectId implements SubjectId {
  
  constructor(readonly iri: string){}

  toString() {
    return this.iri
  }
  equals(other: SubjectId) {
    return (other as IRISubjectId).iri == this.iri
  }

}


/**
 * A subject is roughly the same thing as a "resource" in
 * RDF, except the term resource is no longer appropriate given
 * the ontological bent that RDF has taken. 
 * 
 * This is the basic user-facing type.
 * 
 * All the named entities returned by methods in this type 
 * are fully resolved.
 * 
 * All the named entities passed as arguments to methods in this
 * type can be shortened and are resolved against ...
 * TODO how is the resolution service set
 */
export interface Subject extends DataSpec<Subject> {
  /**
   * The identifier of the subject - the IRI/URI. Not
   * sure if we need a separate abstraction for that or a
   * string will suffice. We have to have a string version of
   * it either way. 
   */
  readonly id:SubjectId

  /**
   * The names of all set properties in this subject
   */
  propertyNames() : string[]
  /**
   * Get the value of a specific property. If there are multiple values, 
   * retrieve only the first one
   * @param prop 
   */
  get(prop: string): Subject | LiteralValue | null 
  
  /**
   * Get all the values of a specific property 
   * @param prop 
   */
  getAll(prop: string): Subject[] | LiteralValue[] 

  /**
   * Set the value of a property; If the previous value of the property was annotated, this will remove the annotation
   * @param prop 
   * @param object the new property value 
   * TODO the object could be actually be a working copy of a subject; is this a valid operation?
   */
  set(prop: string, ...object: Subject[]|LiteralValue[]) : Subject

  /**
   * Add more values of a property; The annotations of the old values are preserved
   * @param prop 
   * @param object the new property value 
   * TODO the object could be actually be a working copy of a subject; is this a valid operation?
   */
  setMore(prop: string, ...object: Subject[]|LiteralValue[]) : Subject

  /**
   * delete some values from a property
   * @param prop the property whose values are to be deleted
   * @param val the values to delete
   */
  delete(prop: string, ...val: Subject[] |LiteralValue[]) : Subject


  /**
   * Apply a list of property changes to the subject
   * @param changes 
   */
  apply(changes : PropertyChange[])
  
  /**
   * Add a callback which will be called when the referents pointing to this 
   * subject change
   * @param callback 
   */
  addReferentsChangedCallback(callback: (referent: Subject, key: string) => void )  
  
  /**
   * Remove a ReferentsChangedCallback
   * @param callback the callback to remove
   */
  removeReferentsChangedCallback(callback: (referent: Subject, key: string) => void )
  
  /**
   * Add a callback to be called when the subject changes
   * @param callback 
   */
  addPropertyChangedCallback(callback: (key: string) => void )   

  /**
   * Remove a PropertyChangedCallback
   * @param callback 
   */
  removePropertyChangedCallback(callback: (key: string) => void )

  /**
   * Return a `Subject` instance which represents a particular property
   * value set on this subject. This allows the manipulation of meta
   * data on specific property statements (or triples) at any (meta) level.
   * 
   * @param propertyName The property name.
   * @param value The property value - a literal or another subject.
   */
  propertyAsSubject(propertyName: string, value: LiteralValue|Subject): Subject

}


/**
 * TODO:
 * The LocalGraph.factory implementation enforces the invariant
 * that each time we create a DataSpec with the same definition,
 * we are returning the same object.
 * 
 * Should that be the contract for the interface?
 */
 export interface DataSpecFactory {
  /**
   * Create a subject from a subject identifier;
   * @param id 
   */
  subject(id: SubjectId): Subject
}

