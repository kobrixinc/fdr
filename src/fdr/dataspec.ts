/* eslint-disable no-prototype-builtins */
import { Dataset, Quad } from "@rdfjs/types"
import { asArray } from "../utils.js"
import { PropertyAdded, PropertyChange, PropertyRemoved, PropertyReplaced, QuadChange } from "./changemgmt.js"
import { LiteralValue } from "./fdr.js"
import { Graph, LocalGraph } from "./graph.js"
import { DatasetIngester } from "./triplestore-client.js"
import { Subject, RemoteDataSpec, DataSpec, SubjectChangeSynchronization, SubjectId, PropertyValueIdentifier, PropertyValue } from "./dataspecAPI.js"
import { Subscription } from "subscription"


/**
 * Base class for the concrete Subject implementation.
 * Encalpusaltes the basic logic for 
 * 1. read, edit, delete operations,
 * 2. change tracking
 * 3. working copy creation and management
 */
abstract class SubjectBase implements Subject, SubjectChangeSynchronization {
 
  protected properties: object | null = null
  /*
  The annotation object stores the annotations for a the values of this Subject's 
  properties. When a propety has multiple values, the annotation will contain under
  that property an array with the same number of items as the number of values set
  for that property, even though some or all of the values may not have annotations.
  Invariant for this class: the annotation object must always have the same shape
  as the properties object with the only difference that the annotation will not
  contain single values -- whenever a property in the object array has a single
  value, the annotation will contain under that property an array with a single 
  value.
  */
  protected annotation: object | null = null

  readonly changes: Array<PropertyChange> = []
  protected workingCopies : SubjectLightCopy[] = [] 

  constructor(readonly id: SubjectId) {}  

  protected abstract notifyGraphAboutPropertyChange(prop : string[]) : void
  protected abstract resolveName(name : string) : string
  abstract commit(): Promise<void>
  abstract syncFromUpstream(changes: PropertyChange[])
  abstract syncFromDownstream(changes: PropertyChange[])
  abstract workingCopy(reactivityDecorator?: (original: Subject) => Subject): Subject 
  abstract get ready(): boolean
  public onReferentsChanged : Subscription = new Subscription()
  protected onPropertyChanged : Subscription = new Subscription()

  propertyAsSubject(propertyName: string, value: PropertyValue): Subject {
    // TODO
    return new SubjectImpl(
      new PropertyValueIdentifier(this.id, propertyName, value), 
      (this as Object as SubjectImpl).graph)
  }

  getPropertyValueAnnotation(key: string) {
    return this.annotation![key]
  }

  setPropertyValueAnnotation(key: string, value: LiteralValue|Subject, annotation) : any {
    /*
    The annotation object has the exact same shape as the property object
    */
    if (!this.ready)
      throw new Error('Subject is not ready.')   
    
    let change : PropertyChange
    const values = this.properties![key]
    if (values instanceof Array) {
      const index = values.indexOf(value)
      if (index < -1) {
        throw new Error(`Cannot annotate value ${value} because it does not exist for key ${key}`)
      }
      else {
        const annotationsForThisValue = this.annotation![key] as any[]
        let newAnnotations = annotationsForThisValue.slice(0, annotationsForThisValue.length)
        newAnnotations[index] = annotation
        change = new PropertyReplaced(key, values, values, newAnnotations)
      }
    }
    else {
      if (values == value) {
        this.annotation![key] = [annotation]
        change = new PropertyReplaced(key, values, values, [annotation])
      }
      else
        throw new Error (`Cannot annotate value ${value} because it does not exist for key ${key}`)
    }
    this.apply([change])
    this.enqueueToChangeBuffer(change)
  }

  /**
   * Enqueue a change to the buffer which will be sent to upstream sources 
   * of truth for synchronization 
   * @param change the change to enqueue
   */
  protected enqueueToChangeBuffer(...change: PropertyChange[]) {
    this.changes.push(...change)
  }

  get(prop: string): Subject | LiteralValue | null {
    let res
    try {
      res = this.val(prop)
    } catch(error) {
      res = this.obj(prop)
    }
    if (res instanceof Array) {
      if (res.length > 0)
        return res[0]
      else
        return res[1]
    }
    else
      return res
  }

  getAll(prop: string): Subject[] | LiteralValue[] {
    let res
    try {
      res = this.val(prop)
    } catch(error) {
      res = this.obj(prop)
    }
    if (res instanceof Array)
      return res
    else
      return [res]

  }

  set(prop: string, ...object: Subject[] | LiteralValue[]): Subject {
    let res : any
    if (type_guards.isSubjectValue(object))
      res = this.setObj(prop, ...object)
    else if (type_guards.isLiteralValue(object))
      res = this.setVal(prop, ...object)
    else throw new Error(`${object} should be either Subject or LiteralValue`)

    return res
  }

  setMore(prop: string, ...object: Subject[] | LiteralValue[]): Subject {
    let res : any

    if (type_guards.isSubjectValue(object))
      res = this.setMoreObjects(prop, ...object)
    else if (type_guards.isLiteralValue(object))
      res = this.setMoreValues(prop, ...object)
    
    return res
  }

  delete(prop: string, ...val: Subject[] |LiteralValue[]): Subject {
    let res : any

    if (type_guards.isSubjectValue(val))
      res = this.deleteObject(prop, ...val)
    else if (type_guards.isSubjectValue(val))
      res = this.deleteValue(prop, ...val)
    else throw new Error(`${val} should be either Subject or LiteralValue`)

    return res
  }

  propertyNames(): string[] {
    return Object.keys(this.properties || {})
  }

  // return the stored value as it is
  private obj(prop: string): Subject[] | null {
    prop = this.resolveName(prop)
    
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    const x = this.properties[prop]
    if (x) {
      if (type_guards.isSubjectValue(x)) {
        if (x instanceof Array)
        {
          if (x.length == 0) return null
          else if (x.length == 1) return x
          else return x
        } 
        else {
          return [x]
        }       
      }
      else {
        throw new Error(`property ${prop} requested as an object property but is
        data property with value ${x}`)
      }

    }
    else {
      return null
    }
  }

  private setObj(prop: string, ...object: Subject[]): Subject {
    prop = this.resolveName(prop)
    let change : PropertyChange|undefined
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      change = new PropertyReplaced(prop, asArray(this.obj(prop)), object)
    }
    else {
      change = new PropertyAdded(prop, object)
    }
    this.enqueueToChangeBuffer(change)
    this.apply([change])
    return this
  }

  private setMoreObjects(prop: string, ...objects: Subject[]): Subject {
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')  

    let change
    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]
      let oldAnnotation = this.annotation![prop] as any[]
      if (type_guards.isSubjectValue(oldval)) {
        const oldValAsArray = oldval instanceof Array ? oldval : [oldval]        
        
        const u = union(oldValAsArray, objects)
        if (u.length > oldAnnotation.length) {
          //expand the annotation array to the length of the new value array
          oldAnnotation.splice(oldAnnotation.length, 0, ...new Array(u.length - oldAnnotation.length))
        }
        change = new PropertyReplaced(prop, oldValAsArray, u, oldAnnotation)
        
      }
      else {
        throw new Error(`Trying to add subject into a property which contains
        non subjects ${oldval}`)
      }
    }
    else {
      change = new PropertyAdded(prop, objects)
    }
    this.enqueueToChangeBuffer(change)
    this.apply([change])
    return this    
  }

  private deleteObject(prop: string, ...object: Subject[]): Subject {
    // const resolver = this.graph.nameResolver
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]      
      const oldValAsArray = oldval instanceof Array ? oldval : [oldval]
      const removed = intersect(oldValAsArray, object)
      const updatedAnnotation = []

      const change = new PropertyRemoved(prop, removed, updatedAnnotation)
      this.apply([change])
      this.enqueueToChangeBuffer(change)
    }
    return this    
  }
  
  private val(prop: string): LiteralValue[] | null {
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    const x = this.properties[prop]
    if (x) {
      if (type_guards.isLiteralValue(x)) {
        if (x instanceof Array) {
          if (x.length == 0) return null
          else if (x.length == 1) return x
          else return x
        }
        else {
          return [x]
        }
      }
      else {
        throw new Error(`property ${prop} requested as a literal value but is
          object property with value ${x}`)
      }
    }
    else {
      return null
    }
        
  }

  /**
   * Set some specific literal values for a key on the object. 
   * If there are already some values, replace them
   * 
   * @param prop 
   * @param val 
   * @returns 
   */
  private setVal(prop: string, ...val: LiteralValue[]): Subject {
    prop = this.resolveName(prop)
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    let change : PropertyChange|null = null
    if (this.properties.hasOwnProperty(prop)) {
      change = new PropertyReplaced(prop, asArray(this.val(prop)), val)
    }
    else {
      change = new PropertyAdded(prop, val)
    }  
    this.enqueueToChangeBuffer(change)

    this.apply([change])
    return this
  }

  /**
   * Add some literal values for a key on the object.
   * 
   * @param prop 
   * @param val 
   * @returns 
   */
  private setMoreValues(prop: string, ...val: LiteralValue[]): Subject {
    // const resolver = this.graph.nameResolver
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')
    let change
    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]
      let oldAnnotation = this.annotation![prop] as any[]
      if (type_guards.isLiteralValue(oldval)) {
        const oldValAsArray = oldval instanceof Array ? oldval : [oldval]
        /*
        we assume that union adds the new values after the old and that it preserves the order of the old values
        TODO check if we actually do that! 
        */
        const inserted = union(oldValAsArray, val)
        if (inserted.length > oldAnnotation.length) {
          //expand the annotation array to the length of the new value array
          oldAnnotation.splice(oldAnnotation.length, 0, ...new Array(inserted.length - oldAnnotation.length))
        }
        change = new PropertyReplaced(prop, oldValAsArray, inserted, oldAnnotation)
        
      }
      else {
        throw new Error(`Trying to add literal into a property which contains
        non literals ${oldval}`)
      }
    }
    else {
      change = new PropertyAdded(prop, val)
    }
    this.enqueueToChangeBuffer(change)
    this.apply([change])
    return this
  }

  private deleteValue(prop: string, ...val: LiteralValue[]): Subject {
    // const resolver = this.graph.nameResolver
    prop = this.resolveName(prop)
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]
      const oldValAsArray = oldval instanceof Array ? oldval : [oldval]      
      const removed = intersect(oldValAsArray, val)
      const change = new PropertyRemoved(prop, removed)
      this.enqueueToChangeBuffer(change)
      this.apply([change])
    }
    return this   
  }

  /**
   * Apply a change to the subject
   * 
   * @param changes 
   */
  apply(changes : PropertyChange[]) {
    
    for (const change of changes) {
      if (change instanceof PropertyAdded) {
        if (change.annotation && change.value.length != change.annotation.length) {
          throw new Error(`Annotation and value arrays have different shapes.`)
        }
        this.properties![change.name] = change.value
        this.annotation![change.name] = change.annotation || (change.value instanceof Array 
          ? new Array(change.value.length) 
          : new Array[1])
      }
      else if (change instanceof PropertyReplaced) {
        if (change.annotation && change.newvalue.length != change.annotation.length) {
           throw new Error(`Annotation and value arrays have different shapes.`)
        }
        this.properties![change.name] = change.newvalue
        this.annotation![change.name] = change.annotation || (change.newvalue instanceof Array 
          ? new Array(change.newvalue.length) 
          : new Array[1])
      }
      else if (change instanceof PropertyRemoved) {
        /*
        TODO PropertyRemoved deletes specific values, not the entire property!
        */
        delete this.properties![change.name]
        delete this.annotation![change.name]
      }
    }    
  }

  notifyReferentsChanged(referent, key) {
    this.onReferentsChanged.dispatch(referent, key)
  }

  addReferentsChangedCallback(callback: (referent: Subject, key: string) => void) {
    this.onReferentsChanged.add(callback)
  } 
  
  removeReferentsChangedCallback(callback: (referent: Subject, key: string) => void) {
    this.onReferentsChanged.remove(callback)
  }

  addPropertyChangedCallback(callback: (key: string) => void) {
    this.onPropertyChanged.add(callback)
  }

  removePropertyChangedCallback(callback: (key: string) => void) {
    this.onPropertyChanged.remove(callback)
  }

}


/**
 * The main subject implementation of the Subject interface which works with the LocalGraph
 * 
 * This class is only exported so that it's accessible to the `graph.ts` module.
 */
export class SubjectImpl extends SubjectBase implements RemoteDataSpec<Subject> {
    
  protected resolveName(name: string): string {  
    return this.graph.nameResolver.resolve(name)
  }
  
  /**
   * Notify the graph that some properties have changed
   * @param changedProperties the changed properties 
   */
  protected notifyGraphAboutPropertyChange(changedProperties : string[]) {
    this.graph.subjectPropertyChangeCallback(this, changedProperties)
  }
  
  public graph: LocalGraph  

  constructor(readonly id:SubjectId, graph: LocalGraph) {
    super(id)
    this.graph = graph
  }
  
  get query() { 
    return {
      type: 'Subject',
      id: this.id
    }
  }

  get ready(): boolean {
    return this.properties == null ? false : true
  }

  use(): Promise<Subject> {
    return this.graph.use(this)
  }

  apply(changes: PropertyChange[]): void {
    super.apply(changes)
    this.onPropertyChanged.dispatch(changes.map((ch) => ch.name))
    this.notifyGraphAboutPropertyChange(changes.map((ch) => ch.name))
    for (const wc of this.workingCopies){
      wc.syncFromUpstream(changes)
    }
  }

  /**
   * Ingest the quads from a dataset which are relevant to this Subject into 
   * this Subject's properties
   * 
   * @param dataset 
   */
  ingest(annotatedDataset : [Dataset<Quad, Quad>, object]): void {
    const dataset = annotatedDataset[0]
    const annotation = annotatedDataset[1]
    //isn't parseDataset and the logic after it duplicate?
    const props = parseDataset(this.graph, this.id as string, dataset)
    const quads: Array<Quad> = Array.from(dataset['_quads'].values())
    // This dataset.filter method is documented as part of the DatasetCore interface
    // but it seems like it's not implemented yet. NEed to reach out to that rdfjs community
    // and maybe get implicated, help or whatever...
    // dataset.filter
    // quads.filter( (quad:Quad) => quad.subject.value == this.id).forEach( quad => {
    //   if (quad.object.termType == "NamedNode")
    //     props[quad.predicate.value] = this.graph.factory.subject(quad.object.value)
    //   else if (quad.object.termType == "Literal")
    //     props[quad.predicate.value] = quad.object.value
    // })
    // should we merge here instead? what are different kinds of ingestion of triples about this subject?    
    this.properties = props    
    //TODO ingest annotation data from the dataset 
    this.annotation = copyShape(props)
    for (const entry of Object.entries(annotation)) {
      this.annotation[entry[0]] = entry[1]
    }
  }

  workingCopy(reactivityDecorator?: <T extends Subject>(original: T) => T): Subject {
    let result = new SubjectLightCopy(this, () => this.graph, (name) => this.graph.nameResolver.resolve(name))
    if (reactivityDecorator)
      result = reactivityDecorator(result)
    else if (this.graph.reactivityDecorator)
      result = this.graph.reactivityDecorator(result)
   
    this.workingCopies.push(result)
    return result
  }

  /*
  push the changes to the BE
  */
  async commit(): Promise<void> {
    let changes : QuadChange[] = []
    this.changes.forEach(change =>  {
      const quadchanges = change.toQuadChanges(this)
      changes = changes.concat(quadchanges)
    })
    await this.graph.client.modify(changes)
    this.changes.splice(0, this.changes.length)
  }

  /*
  this will be called by the mechanism which propagates changes coming from 
  a backend process.
  */  
  
  syncFromUpstream(changes: PropertyChange[]): Promise<void> {
    throw new Error("Method not implemented.")
  }

  /*
  This is called by the copies of this subject 
  */
  syncFromDownstream(changes: PropertyChange[]) {
    this.apply(changes)
    this.enqueueToChangeBuffer(...changes)
  }  
}


/**
 * A buffer for changes to another subject
 */
class  SubjectLightCopy extends SubjectBase {
  
  get ready(): boolean { return true }

  /**
   * 
   * @param original 
   * @param graph 
   * @param resolver 
   */
  constructor(original : Subject, 
              private graph : () => Graph, 
              private resolver : (string) => string) {
    super(original.id)
    this.properties = {}
    this.annotation = {}
    for (const property of original.propertyNames()) {
      this.properties[property] = original.get(property)
      this.annotation[property] = original.getPropertyValueAnnotation(property)
    }
  }

  protected notifyGraphAboutPropertyChange(prop: string[]): void {
    //noop
  }

  protected resolveName(name: string): string {
    return this.resolver(name)
  }

  workingCopy(reactivityDecorator?: ((original: Subject) => Subject) ): Subject {
    throw new Error("Can not create a working copy of a working copy")
  }

  
  private async originial() : Promise<SubjectImpl> {
    const graph = this.graph()
    const original = await graph.use(graph.factory.subject(this.id) as SubjectImpl)
    return original
  }

  async commit(): Promise<void> {
    const graph = this.graph()
    const original = await this.originial()
    /*
    this is a copy, so its original is a Subje
    */
    if (type_guards.isSubjectChangeSynchronization(original))
      original.syncFromDownstream(this.changes)
    else
      throw new Error("The original for this copy could not accept changes")
    this.changes.splice(0, this.changes.length)
  }

  syncFromDownstream(changes: PropertyChange[]) {
    throw new Error("Changes coming from a copy of a copy are not supported. This is a programming error.")
  }
  
  syncFromUpstream(changes: PropertyChange[]) {
    this.apply(changes)
  }

  apply(changes: PropertyChange[]): void {
    super.apply(changes)
    this.onPropertyChanged.dispatch(changes.map((ch) => ch.name))  
  }

  
}

/**
 * parse a dataset into individual's properties
 * @param graph TODO only the factory is needed and it probably shouldn't be passed as parameter
 * @param subjectId The subject whose properties we are constructing
 * @param dataset The dataset to parse
 * @returns 
 */
function parseDataset(graph : Graph, subjectId : string, dataset: Dataset<Quad, Quad>): object {
  const props = {} 
  const quads: Array<Quad> = Array.from(dataset['_quads'].values())
  // This dataset.filter method is documented as part of the DatasetCore interface
  // but it seems like it's not implemented yet. Need to reach out to that rdfjs community
  // and maybe get implicated, help or whatever...
  // dataset.filter
  quads.filter( (quad:Quad) => quad.subject.value == subjectId).forEach( quad => {
    if (quad.object.termType == "NamedNode")
      props[quad.predicate.value] = graph.factory.subject(quad.object.value)
    else if (quad.object.termType == "Literal")
      props[quad.predicate.value] = quad.object.value
  })
  // should we merge here instead? what are different kinds of ingestion of triples about this subject?    
  return props
}

export const type_guards = {
  /**
   * Type quard for the DatasetIngeste type
   * @param dataSpec 
   * @returns 
   */
  isIngester(dataSpec): dataSpec is DatasetIngester {
    return (dataSpec as DatasetIngester).ingest !== undefined;
  },

  /**
   * 
   * @param subject 
   * @returns 
   */
  isSubjectValue(subject): subject is Subject|Subject[] {
    return subject instanceof SubjectImpl 
    || (subject instanceof Array && (subject.length == 0 || subject[0] instanceof SubjectImpl))
  },

  isLiteralValue(literal): literal is LiteralValue|LiteralValue[] {
    return literal instanceof String || typeof literal == "string" || literal instanceof Boolean || typeof literal == "boolean" || literal instanceof Number || typeof literal == "number"
    || (literal instanceof Array && (literal.length == 0 || (typeof literal[0] === 'string' || typeof literal[0] === 'boolean' || typeof literal[0] === 'number')))
  },

  isRemoteDataSpec(dataSpec : DataSpec<any>) : dataSpec is RemoteDataSpec<any> {
    const asRemote = dataSpec as RemoteDataSpec<any>
    return asRemote.ingest !== undefined && asRemote.query !== undefined && asRemote.ready !== undefined
  },
  isSubjectChangeSynchronization(subject): subject is SubjectChangeSynchronization {
    return (subject as SubjectChangeSynchronization).syncFromUpstream != undefined
    &&
    (subject as SubjectChangeSynchronization).syncFromDownstream != undefined
  }
}

/**
 * Compute the set teorethical union between two arrays by modifying the original array
 * @param oldValues 
 * @param newValues 
 * @returns the values which were actually added in the original array
 */
function setUnion(oldValues : LiteralValue[]|Subject[], newValues :LiteralValue[]|Subject[]) : LiteralValue[]|Subject[] {
  if (type_guards.isSubjectValue(oldValues) && type_guards.isSubjectValue(newValues)) {
    const added = [] as Subject[]
    for (const newvalue of newValues) {
      if(!(oldValues).some(old => old.id == newvalue.id)) {
        //this is actually a new value
        oldValues.push(newvalue)
        added.push(newvalue)
      }
    }
    return added
  }
  else if (type_guards.isLiteralValue(oldValues) && type_guards.isLiteralValue(newValues)) {
    const added = [] as LiteralValue[]
    for (const newvalue of newValues) {
      if(oldValues.indexOf(newvalue) < 0) {
        //this is actually a new value
        oldValues.push(newvalue)
        added.push(newvalue)
      }
    }
    return added
  }
  else throw new Error(`${oldValues} and ${newValues} are expected to be both
  arrays of LiteralValues or Subjects`)
}

/**
 * Compute the set teorethical difference between two arrays by modifying the original array
 * @param oldValues 
 * @param toRemoveValues the values to remove
 * @returns the elements which were actually removed from the oldValues array
 * @deprecated
 */
function setDiff(
  oldValues : LiteralValue[]|Subject[], 
  toRemoveValues :LiteralValue[]|Subject[]) : LiteralValue[]|Subject[] {
  if (type_guards.isSubjectValue(oldValues) && type_guards.isSubjectValue(toRemoveValues)) {
    const removed = [] as Subject[]
    for (const toRemove of toRemoveValues) {
      const index = oldValues.findIndex(old => old.id == toRemove.id)
      if (index >= 0) {
        oldValues.splice(index, 1)
        removed.push(toRemove)
      }
    }
    return removed
  }
  else if (type_guards.isLiteralValue(oldValues) && type_guards.isLiteralValue(toRemoveValues)) {
    const removed = [] as LiteralValue[]
    for (const toRemove of toRemoveValues) {
      const index = oldValues.findIndex(old => old == toRemove)
      if (index >= 0) {
        oldValues.splice(index, 1)
        removed.push(toRemove)
      }
    }
    return removed
  }
  else throw new Error(`${oldValues} and ${toRemoveValues} are expected to be both
  arrays of LiteralValues or Subjects`)
}

/**
 * Compute set difference between two arrays
 * @param oldValues 
 * @param toRemoveValues 
 * @returns 
 */
function diff<T>(
  big : T[], 
  small :T[]) : T[] {
    return big.filter((el) => small.indexOf(el) < 0 )
}
function intersect<T>(
  a : T[], 
  b : T[]) : T[] {
    return a.filter((el) => b.indexOf(el) > -1 )
}
function union<T>(
  a : T[], 
  b : T[]) : T[] {
    const res = [] as T[]
    for (const el of a)
      res.push(el)

    for (const el of b)
      res.push(el)
    return res
}

/**
 * Construct an object with the same shape as the given one
 * i.e. with the same keys and the values will be arrays of the same size
 * @param from 
 * @returns 
 */
function copyShape(from: object) : object {
  const result = {}
  for (const key in from) {
    result[key] = from[key] instanceof Array ? new Array(from[key].length) : new Array(1)
  }
  return result
}



