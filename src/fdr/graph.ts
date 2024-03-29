
import { QuadChange } from "./changemgmt.js"
import { DataSpec, DataSpecFactory, IRISubjectId, Subject, SubjectId} from "./dataspecAPI.js"
import { SubjectImpl, type_guards, PropertyValueIdentifier } from "./dataspec.js"
import { TripleStore } from "./triplestore-client.js"
import { rdfjs, GraphEnvironment } from "./fdr.js"
import { Dataset, Quad } from "@rdfjs/types"

/**
 * A Graph is a collection of Subjects, each with their properties.
 * 
 */
export interface Graph {

  /**
   * Reference to the FDR environment which created this graph.
   */
  env: GraphEnvironment 
  
  factory: DataSpecFactory

  /**
   * Intending to use the specified data, make sure it is 
   * available.
   * 
   * Note that this function is expected to be async
   * 
   * @param desc The description of the data to materialize. Must be a 
   * supported DataSpec implementation.
   * @returns A promise which resolves with the parameter DataSpec object which 
   * is filled with the necessary data and is ready to use.
   * 
   */
  use<T extends DataSpec<any>>(desc: T): Promise<T>

  /**
   * Declare that the DataSpec is no longer in use
   * 
   * @param desc the DataSpec to be disposed of
   */
  close(desc: DataSpec<any>): void  

  id : string  
} 

/**
 * A graph implementation which is a local cache of a remote graph
 */
export class LocalGraph implements Graph { 

  public id : string
  public label : string
  readonly factory: DataSpecFactory
  client: TripleStore
  private cache = { 
    subjects: new Map<SubjectId, SubjectImpl>()
  } 
  private _reactivityDecorator : <T extends Subject>(T) => T = (x) => x

  private static factory_impl = class implements DataSpecFactory {
    
    constructor(readonly graph: LocalGraph) { }

    subject(id: SubjectId): SubjectImpl {
      const resolver = this.graph.env.resolver
      
      function resolve(id : SubjectId) : SubjectId {
        if (id  instanceof PropertyValueIdentifier) {
          return new PropertyValueIdentifier(
            resolve(id.subject),
            resolver.resolve(id.property),
            id.value) 
        } 
        else if (id instanceof IRISubjectId) {
          return new IRISubjectId(resolver.resolve(id.iri))
        }
        throw new Error(`Subject id ${id} is unsupported`)
      }
      const resolved = resolve(id)
      /*
      TODO 
      we need a better (O(1)) retrieval of existing subjects
      from the map; the key is not a primitive value, so subjects.get()
      does not work 
      */
      for (const entry of this.graph.cache.subjects.entries()) {
        if (entry[0].equals(resolved)) {
          return entry[1] 
        }
        this.graph.cache.subjects.get(resolved)
      }
      const res = new SubjectImpl(resolve(id), this.graph)
      this.graph.cache.subjects.set(resolved, res)
      return res 
    
    }
  }

  //TODO consider this as public graph creation factory to discourage direct calls to the constructor
  // static _make(env:GraphEnvironment, client: TripleStore, id : string, label : string = id)
  // {
  //   return new LocalGraph(env, client, id, label)
  // }

  /**
   * This constructor is internal and should not be used directly
   */
  constructor(readonly env:GraphEnvironment, client: TripleStore, id : string, label : string = id) {
    this.client = client
    this.factory = new LocalGraph.factory_impl(this)
    this.id = id
    this.label = label
  }

  /**
   * Set the reactivity decorators for all working copies created from subjects
   * in this graph.
   * 
   * The reactivity decorator is called by the Subject.workingCopy() constructor function.
   * It should wrap the working copy in whatever reactivity proxy is needed and
   * return the proxy so that the wrapped working copy can be used whenever changes
   * to the copy have to be propagated. That way the reactive layer will be 
   * notified correctly.
   * 
   * This property can be overriden in every invocation of Subject.workingCopy()
   */
  set reactivityDecorator(decorator : <T extends Subject>(T) => T) {
    this._reactivityDecorator = decorator
  }

  get reactivityDecrator() {
    return this._reactivityDecorator
  }

  
  clear() {
    this.cache = { 
      subjects: new Map<SubjectId, SubjectImpl>() 
    }
  }

  /**
   * Called by the subjects in this graph when their properties change.
   * A change is defined as a call to the Subject.apply() method. 
   * This callback should modify any internal Graph state so that its state is consistent
   * with the changes made to the Subject
   * @param subject 
   * @param key /
   */
  subjectPropertyChangeCallback(
    subject: Subject, 
    modifiedKeys: string[]) {

    for (const modifiedKey of modifiedKeys) {
      const value = subject.getAll(modifiedKey)
      if (type_guards.isSubjectValue(value)) {
        for (const referredSubject of value) {
          /* This graph produces only SubjectImpl, so the cast is safe */
          (referredSubject as SubjectImpl).onReferentsChanged.dispatch(this, modifiedKey)
        }
      }
    }
  }


  async use<T extends DataSpec<any>>(desc: T): Promise<T> {
    //local graph only uses RemoteDataSpecs
    let result = desc  
    if (!type_guards.isRemoteDataSpec(desc))
      throw new Error(`${desc} is expected to be a RemoteDataSpec`)
    if (!desc.ready) {
      let data : Dataset<Quad, Quad>
      if (type_guards.isSubjectValue(desc)) {
        const id = (desc as Subject).id 
        if (id instanceof PropertyValueIdentifier) {
          data = await this.client.fetch(id.toQuad()) 
        }
        else if (id instanceof IRISubjectId){
          data = await this.client.fetch(rdfjs.named(id.iri)) 
        }
        else {
          throw new Error(`${id} is neither IRI, nor property value identifier`)
        }
      }
      else {
        throw new Error(`Fetching non subject dataspecs is not supported`)
      }
      if (data != null) {
        desc.ingest(data)
      }
      result = desc
    }
    return result    
  }
  

  close(desc: DataSpec<any>): void {
    //TBD: should this remove the data spec from?
    throw new Error("Method not implemented.")
  }


  /**
   * Accept quad changes pushed from a remote source (e.g. BE triplestore)
   * @param changes 
   */
  acceptChanges(changes : QuadChange[]) {
    //TODO
    console.log('not implemented')
  }

}
