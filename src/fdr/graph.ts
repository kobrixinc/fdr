
import { QuadChange } from "./changemgmt.js"
import { AnnotatedDomainElement, DMEFactory, DMEFactoryConstructor, DMEFactoryImpl, DataSpec, DomainAnnotatedFactories, DomainElementId, IRISubjectId, Subject, SubjectId} from "./dataspecAPI.js"
import { SubjectImpl, type_guards, PropertyValueIdentifier, SubjectAnnotatedFactory } from "./dataspec.js"
import { TripleStore } from "./triplestore-client.js"
import { rdfjs, GraphEnvironment } from "./fdr.js"
import { Dataset, Quad } from "@rdfjs/types"
import { HashMap } from "@tykowale/ts-hash-map"
/**
 * A Graph is a collection of Subjects, each with their properties.
 * 
 */
export interface Graph {

  /**
   * Reference to the FDR environment which created this graph.
   */
  env: GraphEnvironment 
  
  factory: any

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
  // readonly factory: DataSpecFactory
  client: TripleStore

  // For a performant cache we can use something like this:
  // https://github.com/tykowale/ts-hash-map 
  // assuming it gets a hashCode+equals style support, in addition
  // to the clever stuff it's already doing with well-known JS types.
  private cache = new HashMap<DomainElementId<any>, DataSpec<any>>()

  private factory_functions = {
    'subject': this.factoryInGraphContext(new SubjectAnnotatedFactory(this))
  }

  private factories = { }

  private _reactivityDecorator : <T extends Subject>(T) => T = (x) => x

  private factoryInGraphContext(factory: DMEFactory<any, any>): Function {
    return (...args) => {
      let id = factory.identify(...args)
      let existing = this.cache.get(id)
      if (existing) {
        return existing
      }
      let newel: AnnotatedDomainElement<any, any> = factory.make(...args, this)
      this.cache.set(newel.id, newel.element)
      return newel.element          
    }
  }

  private initializeFactories(fmap: Map<string, DMEFactoryConstructor<any, any>>): void {
    fmap.forEach((cons, typename) => {
      let factory: DMEFactory<any, any> = cons(this)
      this.factories[typename] = factory
      this.factory_functions[typename] = this.factoryInGraphContext(factory)
    })
  }

  /**
   * This constructor is internal and should not be used directly
   */
  constructor(readonly env:GraphEnvironment, 
              client: TripleStore, 
              id : string,
              annotatedFactories: DomainAnnotatedFactories) {
    this.client = client
    // this.factory = new LocalGraph.factory_impl(this)
    this.id = id
    this.initializeFactories(annotatedFactories.factoryMap)
  }

  get factory() {
    return this.factory_functions
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
    this.cache = new HashMap<DomainElementId<any>, DataSpec<any>>() 
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

    let factory: DMEFactory<any, T> = this.factories[desc.typename]

    if (!desc.ready) {
      desc = await factory.tripler.fetch(this.client, desc)
    }
    return desc
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
