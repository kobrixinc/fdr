/* eslint-disable no-prototype-builtins */
import { BlankNode, Dataset, Literal, NamedNode, Quad, Quad_Object, Quad_Subject, Variable } from "@rdfjs/types"
import { asArray } from "../utils.js"
import { PropertyAdded, PropertyChange, PropertyRemoved, PropertyReplaced, QuadChange } from "./changemgmt.js"
import { LiteralStruct, LiteralValue, fdr, rdfjs } from "./fdr.js"
import { Graph, LocalGraph } from "./graph.js"
import { DatasetIngester, Quads, TripleStore } from "./triplestore-client.js"
import { Subject, DataSpec, SubjectChangeSynchronization, SubjectId, IRISubjectId, AnnotatedDomainElement, DMEFactory, DomainAnnotatedFactories, Tripler } from "./dataspecAPI.js"
import { Subscription } from "subscription"
import { getHashCode } from "@tykowale/ts-hash-map"

type _InternalPropertyValue = Literal | SubjectId

/**
 * Base class for the concrete Subject implementation.
 * Encalpusaltes the basic logic for 
 * 1. read, edit, delete operations,
 * 2. change tracking
 * 3. working copy creation and management
 */
abstract class SubjectBase implements Subject, SubjectChangeSynchronization {
 
  protected properties: object | null = null

  readonly changes: Array<PropertyChange> = []
  protected workingCopies : SubjectLightCopy[] = [] 

  constructor(readonly id: SubjectId) {}  

  get typename(): string { return "subject" }
  abstract getGraph() : Graph
  protected abstract notifyGraphAboutPropertyChange(prop : string[]) : void
  protected abstract resolveName(name : string) : string
  abstract commit(): Promise<void>
  abstract syncFromUpstream(changes: PropertyChange[])
  abstract syncFromDownstream(changes: PropertyChange[])
  abstract workingCopy(reactivityDecorator?: (original: Subject) => Subject): Subject 
  abstract get ready(): boolean
  public onReferentsChanged : Subscription = new Subscription()
  protected onPropertyChanged : Subscription = new Subscription()

  propertyAsSubject(propertyName: string, value: LiteralValue|Subject|LiteralStruct, lang? : string): Subject {
    const object = type_guards.isSubjectValue(value) ? value.id 
                    : type_guards.isLiteralStruct(value) ?
                      rdfjs.literal(value.value, value.language) 
                    : rdfjs.literal(value, this.parseLangString(lang).language)
    const id = new PropertyValueIdentifier(this.id, propertyName, object)      
    const subject = (this as unknown as SubjectBase).getGraph().factory.subject(id)
    return subject
  }

  /**
   * Enqueue a change to the buffer which will be sent to upstream sources 
   * of truth for synchronization 
   * @param change the change to enqueue
   */
  protected enqueueToChangeBuffer(...change: PropertyChange[]) {
    this.changes.push(...change)
  }

  protected onlyWithLanguage(values: Array<Literal>, lang: string): Literal[] {
    return values.filter(value => value.language == lang)
  }

  /**
   * Parse the language string or if not set, parse the environment's default language setting
   * @param lang 
   * @returns 
   */
  protected parseLangString(lang?: string): {language?: string, languageIsOptional: boolean}
  {
      let language : string|undefined = lang
      let languageIsOptional : boolean = false
      if (!language)
        language = this.getGraph().env.config.lang
      if (language && language.endsWith("?")) {
        language = language.replace("?", "")
        languageIsOptional = true
      }
      return {language, languageIsOptional}
  }

  /**
   * parse a literal into a js value accordig to the datatype property
   * @param literal 
   * @returns 
   */
  private makeValueFromLiteral(literal: Literal) : LiteralValue {
    switch(literal.datatype.value) {
      case "http://www.w3.org/2001/XMLSchema#int" : {
        Number.parseInt(literal.value)
      }
      case "http://www.w3.org/2001/XMLSchema#decimal" : {
        Number.parseFloat(literal.value)
      }
      case "http://www.w3.org/2001/XMLSchema#boolean" : {
        return literal.value === "true"
      }
      default : {
        return literal.value
      }
    }

  }

  /**
   * 
   * @param prop 
   * @param lang the language of the requested values. If set, only values with the given
   * language will be returned. If no values of the given language are present and the 
   * language is optional (lang ends with '?'), all the values will be returned. If not set,
   * all the values will be returned
   * @returns an array consisting of all the values of the given property. If the values
   * are string literals only values with the specified language are returned. Non
   * string literals are transformed into js objects according to their set datatype.
   * If threre are no values with the given language and teh 
   */
  getAll(prop: string, lang?: string): Subject[] | LiteralValue[] {
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')
    
    let {language, languageIsOptional} = this.parseLangString(lang)
    prop = this.resolveName(prop)
    let raw = this.properties[prop]    
    if (!raw || raw.length == 0) return [] as any[]

    let values : Literal[]|Subject[]
    if (raw instanceof Array)
      values = raw
    else
      values = [raw]

    //we've ensured values is a non empty array
    if(type_guards.isLiteral(values[0])) {
      let filtered : Literal[]
      if (language) {
        filtered = this.onlyWithLanguage(values as Literal[], language)
        if (filtered.length == 0 && languageIsOptional) {
          filtered = values as Literal[]
        }
      }
      else {
        filtered = values as Literal[] 
      }
      return filtered.map(this.makeValueFromLiteral)
    }
    else if (type_guards.isSubjectValue(values[0])) {
      return values as Subject[]
    }
    else {
      throw new Error("Type mismatch - a property in a subject is of no recognizable JavaScript type.")
    }
  }
  

  /**
   * 
   * @param prop 
   * @param lang the language of the requested values. If set, only values with the given
   * language will be returned. If no values of the given language are present and the 
   * language is optional (lang ends with '?'), all the values will be returned. If not set,
   * all the values will be returned
   * @returns the (first) value of the given property with the given language (if set) or if 
   * no language is set or the language is optional and no values with the given language are present, 
   * the first value present
   */

  get(prop: string, lang?: string): Subject|LiteralValue|null {
    let res = this.getAll(prop, lang)
    if (res.length == 0) return null
    else return res[0]
  }
  

  set(prop: string, ...object: Subject[] | LiteralValue[]|Literal[]): Subject {
    let res : any
    prop = this.resolveName(prop)    
    if (type_guards.isSubjectValue(object))
      res = this.setObj(prop, ...object)
    else if (type_guards.isLiteralValue(object) || type_guards.isLiteral(object))
      res = this.setVal(prop, ...object)
    else throw new Error(`${object} should be either Subject or LiteralValue`)

    return res
  }

  setMore(prop: string, ...object: Subject[] | LiteralValue[] | Literal[]): Subject {
    let res : any

    if (type_guards.isSubjectValue(object))
      res = this.setMoreObjects(prop, ...object)
    else if (type_guards.isLiteralValue(object) || type_guards.isLiteral(object))
      res = this.setMoreValues(prop, ...object)
    
    return res
  }

  delete(prop: string, ...val: Subject[] |LiteralValue[] | Literal[]): Subject {
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

    const propEntry = this.properties[prop]
    let single: Subject | Literal | null
    if (propEntry instanceof Array) {
      if (propEntry.length == 0)
        single = null
      else // if (propEntry.length >= 1)
        single = propEntry[0]
    }
    else 
      single = propEntry
    
    if (single == null)
      return null
    else if (!type_guards.isSubjectValue(single))
      throw new Error(`property ${prop} requested as an object property but is
         data property with value ${single}`)    
    else 
      return propEntry as Subject[]
  }

  private setObj(prop: string, ...object: Subject[]): Subject {
    let change : PropertyChange|undefined
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      let subid: SubjectId[] = this.obj(prop)?.map(s=>s.id) || []
      change = new PropertyReplaced(prop, subid, object.map(s=>s.id))
    }
    else {
      change = new PropertyAdded(prop, object.map(s=>s.id))
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
      if (type_guards.isSubjectValue(oldval)) {
        const oldValAsArray = oldval instanceof Array ? oldval : [oldval]        
        const u = union(oldValAsArray, objects).map(s=>s.id)
        change = new PropertyReplaced(prop, oldValAsArray.map(s=>s.id), u)
        
      }
      else {
        throw new Error(`Trying to add subject into a property which contains
        non subjects ${oldval}`)
      }
    }
    else {
      change = new PropertyAdded(prop, objects.map(s=>s.id))
    }
    this.enqueueToChangeBuffer(change)
    this.apply([change])
    return this    
  }

  private deleteObject(prop: string, ...object: Subject[]): Subject {
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]      
      const oldValAsArray = oldval instanceof Array ? oldval : [oldval]
      // const removed = intersect(oldValAsArray, object)

      const change = new PropertyRemoved(prop, object.map(s=>s.id))
      this.apply([change])
      this.enqueueToChangeBuffer(change)
    }
    return this    
  }
  
  /**
   * Return the set of values of a data property. Throw an exception if 
   * the values are not RDF literals.
   * @param prop The name of the property.
   */
  private val(prop: string): Literal[] | null {
    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    const propEntry = this.properties[prop]
    if (!propEntry)
      return []
    if (propEntry instanceof Array) {
      if (propEntry.length > 0 && !type_guards.isLiteral(propEntry[0]))
        throw new Error(`property ${prop} requested as a literal value but is
          object property with value ${propEntry[0]}`)
      return propEntry
    }
    else if (!type_guards.isLiteral(propEntry))
      throw new Error(`property ${prop} requested as a literal value but is
      object property with value ${propEntry}`)
    else
      return [propEntry as Literal]
  }

  /**
   * Set some specific literal values for a key on the object. 
   * If there are already some values, replace them
   * 
   * @param prop 
   * @param val 
   * @returns 
   */
  private setVal(prop: string, ...val: LiteralValue[]|Literal[]): Subject {
    // let parsedLang = this.parseLangString(lang)
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    let language = this.parseLangString(undefined).language
    let values = type_guards.isLiteral(val) ? val as Literal [] :
              val.map(x => rdfjs.literal(x, language))
    let change : PropertyChange|null = null
    if (this.properties.hasOwnProperty(prop)) {
      change = new PropertyReplaced(
        prop, asArray(this.val(prop)), values)
    }
    else {
      change = new PropertyAdded(prop, values)
    }  
    this.enqueueToChangeBuffer(change)

    this.apply([change])
    return this
  }

  /**
   * Add some literal values for a key on the object.
   * 
   * @param prop 
   * @param lang 
   * @param val 
   * @returns 
   */
  private setMoreValues(prop: string, ...val: LiteralValue[]|Literal[]): Subject {

    prop = this.resolveName(prop)

    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    let language = this.parseLangString(undefined).language

    let newval = type_guards.isLiteral(val) ? val as Literal [] :
              val.map(x => rdfjs.literal(x, language))

    let change

    if (this.properties.hasOwnProperty(prop)) {
      let oldval: Literal[] | Literal = this.properties[prop]
      if (!oldval)
        oldval = []
      else if (! (oldval instanceof Array))
        oldval = [oldval]
      
      if (oldval.length > 0) {
        if (!type_guards.isLiteral(oldval[0]))
          throw new Error(`Trying to add literal into a property which contains
          non literals ${oldval}`)      
        const inserted = union(oldval, newval)
        change = new PropertyReplaced(prop, oldval, inserted)        
      }
      else
        return this
    }
    else {
      change = new PropertyAdded(prop, newval)
    }
    this.enqueueToChangeBuffer(change)
    this.apply([change])
    return this
  }

  private deleteValue(prop: string, ...val: LiteralValue[]|Literal[]): Subject {
    
    prop = this.resolveName(prop)
    if (!this.ready || this.properties == null)
      throw new Error('Object not ready')

    if (this.properties.hasOwnProperty(prop)) {
      let oldval = this.properties[prop]
      const oldValAsArray = oldval instanceof Array ? oldval : [oldval]      
      // const removed = intersect(oldValAsArray, val)
      let language = this.parseLangString(undefined).language
      let toremove = type_guards.isLiteral(val) ? val as Literal [] :
                val.map(x => rdfjs.literal(x, language))  
      const change = new PropertyRemoved(prop, toremove)
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
        this.properties![change.name] = change.value
      }
      else if (change instanceof PropertyReplaced) {
        this.properties![change.name] = change.newvalue
      }
      else if (change instanceof PropertyRemoved) {
        let oldValues = asArray(this.properties![change.name] as Literal|Literal[]|Subject|Subject[])
        for (let toRemove of change.value) {
          if (toRemove instanceof SubjectImpl) {
            const asSubject = toRemove
            const index = oldValues.findIndex(v => (v as SubjectImpl).id.equals(asSubject.id))
            if (index >= 0) {
              oldValues.splice(index, 1)
            }
          }
          else {
            const asLiteral = toRemove as Literal
            const index = oldValues.findIndex(v => (v as Literal).equals(asLiteral))
            if (index >= 0) {
              oldValues.splice(index, 1)
            }
          }
        }
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
export class SubjectImpl extends SubjectBase  {

  get typename(): string { return 'subject' }

  getGraph(): Graph {
    return this.graph
  }
    
  protected resolveName(name: string): string {  
    return this.graph.env.resolver.resolve(name)
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
    if (this.id instanceof PropertyValueIdentifier) {
      return {
        type: 'Subject',
        propertyValueIdentifier : {
          ontologyId: this.getGraph().id,
          subject: {id: this.id.subject},
          predicate: this.id.property,
          object: (this.id.value as SubjectId) ? {id: (this.id.value as SubjectId)} : this.id.value,
        }
      }
    }
    else {
      return {
        type: 'Subject',
        id : this.id.toString()
      }

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

  workingCopy(reactivityDecorator?: <T extends Subject>(original: T) => T): Subject {
    const handler: ProxyHandler<Subject> = {
      get(target, prop /*, receiver */) {
        let s = target as Subject
        // Here we are treating RDF properties (full IRIs) the same as JavaScript
        // properties (that certainly don't look like URI). Maybe a better approach
        // would be to inspect the name of the property and separate RDF from JavaScript (e.g. function calls)
        let x = target.get(prop.toString())
        return x || target[prop] 
      },
      set(target, prop, value) {
        let s = target as Subject
        target.set(prop.toString(), value)
        return true
      }
    }
    let result = new SubjectLightCopy(
      this, 
      () => this.graph, 
      (name) => this.graph.env.resolver.resolve(name))

    result.hydrate(this.properties||{})

    result = new Proxy<SubjectLightCopy>(result, handler)
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
      const quadchanges = change.toQuadChanges(this.id)
      changes = changes.concat(quadchanges)
    })
    try {
      const result = await this.graph.client.modify(changes)
      if (!result.ok) {
        throw new Error(`Could not commit changes ${changes}`)
      }
    }
    finally {
      this.changes.splice(0, this.changes.length)
    }
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
   * @param getGraph 
   * @param resolver 
   */
  constructor(original : Subject, 
              public getGraph : () => Graph, 
              private resolver : (string) => string) {
    super(original.id)
    this.properties = {}
  }

  public hydrate(properties: object) {
    for (const property of Object.keys(properties || {})) {
      const values = properties![this.resolveName(property)]
      if (values instanceof Array) 
        this.properties![property] = values.slice()     
      else {
        this.properties![property] = values 
      }
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
    const graph = this.getGraph()
    const original = await graph.use(graph.factory.subject(this.id) as SubjectImpl)
    return original
  }

  async commit(): Promise<void> {
    const graph = this.getGraph()
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

function compareQuads(q1:Quad, q2:Quad) {
  function compareSubjects(s1: Quad_Subject, s2: Quad_Subject) {
    if (type_guards.isNamedNode(s1)) {
      if (type_guards.isNamedNode(s2)) {
        return s1.value == s2.value
      }
      else return false
    }
    else if (type_guards.isQuad(s1)) {
      if (type_guards.isQuad(s2)) {
        return compareQuads(s1, s2)
      }
      else return false
    }
    else {
      throw new Error(`${q1.subject} is neither named node, nor quad`)
    }
  } 
  function compareObjects(s1: Quad_Object, s2: Quad_Object) {
    if (type_guards.isNamedNode(s1)) {
      if (type_guards.isNamedNode(s2)) {
        return s1.value == s2.value
      }
      else return false
    }
    else if (type_guards.isQuad(s1)) {
      if (type_guards.isQuad(s2)) {
        return compareQuads(s1, s2)
      }
      else return false
    }
    else if (type_guards.isLiteral(s1)) {
      if (type_guards.isLiteral(s2)) {
        return s1.value == s2.value
      }
      else return false
    }
    else {
      throw new Error(`${q1.subject} is neither named node, nor quad`)
    }
  } 
  return compareSubjects(q1.subject, q2.subject) 
    && compareObjects(q1.object, q2.object)
    && q1.predicate.value == q2.predicate.value

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

  isSubjectId(value): value is SubjectId|SubjectId[] {
    let pred = (x) => x instanceof IRISubjectId || x instanceof PropertyValueIdentifier
    return pred(value) || (value instanceof Array && 
                   (value.length == 0 ||  pred(value[0])))
  },

  isLiteralValue(literal): literal is LiteralValue|LiteralValue[] {
    return literal instanceof String || 
           typeof literal == "string" || 
           literal instanceof Boolean || 
           typeof literal == "boolean" || 
           literal instanceof Number || 
           typeof literal == "number" || 
           (literal instanceof Array && (literal.length == 0 || 
            typeof literal[0] === 'string' || 
            typeof literal[0] === 'boolean' || 
            typeof literal[0] === 'number'))
  },

  isSubjectChangeSynchronization(subject): subject is SubjectChangeSynchronization {
    return (subject as SubjectChangeSynchronization).syncFromUpstream != undefined
    &&
    (subject as SubjectChangeSynchronization).syncFromDownstream != undefined
  },

  isNamedNode(entity: NamedNode | BlankNode | Quad | Variable | Literal): entity is NamedNode {
    return (entity as NamedNode).termType == 'NamedNode'   
  },

  isQuad(entity: NamedNode | BlankNode | Quad | Variable | Literal): entity is Quad {
    return (entity as Quad).termType == 'Quad'   
  },
  
  isLiteral(entity: any): entity is Literal { 
    let pred = (x) => 
      typeof x === "object" && 
      x !== null && 
      "termType" in x && 
      x['termType'] == 'Literal'
    return pred(entity) ||
      (entity instanceof Array && 
       (entity.length == 0 || (pred(entity[0]))))
  },

  isLiteralStruct(entity: any): entity is LiteralStruct { 
    let pred = (x) => typeof x === "object" && x !== null && "value" in x
    return pred(entity) || (entity instanceof Array && 
                           (entity.length == 0 || pred(entity[0])))
  }

  // isThatLiterals(entity: NamedNode | BlankNode | Quad | Variable | Literal | Array<Literal>): entity is Literal|Literal[]{ 
  //   if (something instanceof Array)
  //     return (something as Literal).termType == 'Literal'   
  // }
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
      }    }
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
    for (const el of a) {
      res.push(el)
    }

    for (const el of b) {
      const index = res.findIndex(element => {
        if (type_guards.isLiteral(element)) {
          return (element as Literal).equals(el as Literal)
        }
        else if (type_guards.isSubjectValue(element)) {
          return (element as Subject).id.equals((el as Subject).id)
        }
      })

      if (index < 0) {
        res.push(el)
      }
    }
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

/**
 * A Property value identifier is an identifier of a specific value of a
 * specific property on a subject.
 * This is the Object based equivalent of an RDF triple
 */
export class PropertyValueIdentifier implements SubjectId {
  private hash: number = 0

  constructor(readonly subject: SubjectId, 
              readonly property: string,
              readonly value: _InternalPropertyValue) { }
  
  hashCode(): number {
    if (this.hash)
      return this.hash
    this.hash = this.subject.hashCode()
    this.hash ^= (this.hash * 31) + getHashCode(this.property);
    this.hash |= 0;    
    return this.hash
  }

  equals(other: SubjectId) {
    if (! (other instanceof PropertyValueIdentifier) )
        return false
    const pvi =  other as PropertyValueIdentifier
    if (pvi.subject) {
      if (this.subject.equals(pvi.subject) && this.property == pvi.property) {
        if (type_guards.isSubjectId(this.value)) {
          if (type_guards.isSubjectId(pvi.value)) {
            return this.value.equals(pvi.value)
          }
          else {
            return false
          } 
        }
        else if (type_guards.isSubjectId(pvi.value))
          return false
        else {
          return this.value.value == pvi.value.value
        }
      }
      else {
        return false
      }  
    }
    else {
      return false
    }
  }

  
  /**
   * Transform the property
   * @returns 
   */
  toQuad() : Quad {
    /**
     * recursively convert a property of a specific suject to a Quad 
     * @param subject 
     * @param property 
     * @param value 
     * @returns 
     * TODO the value could be a meta subject which should be serialized as such as well
     */
    const makeQuad = (subject : SubjectId, property: string, value: SubjectId|Literal) => {
      
      let subjectInQuad : Quad|NamedNode
      let propertyInQuad : NamedNode 
      let objectInQuad : Quad|NamedNode|Literal
      propertyInQuad = rdfjs.named(property)
      if (subject instanceof PropertyValueIdentifier) {
        const pvi = subject as PropertyValueIdentifier
        subjectInQuad = makeQuad(pvi.subject, pvi.property, pvi.value)
      }
      else if (subject instanceof IRISubjectId) {
        subjectInQuad = rdfjs.named(subject.iri) 
      }
      else {
        throw new Error(`${subject} is an unsupported type of subject`)
      }
     
      if (type_guards.isLiteral(value)) {
        objectInQuad = value // rdfjs.literal(value)
      } 
      else if (value instanceof IRISubjectId) {
        objectInQuad = rdfjs.named(value.iri)
      }
      else if (value instanceof PropertyValueIdentifier) {
        objectInQuad = makeQuad(value.subject, value.property, value.value)
      }
      else {
        throw new Error (`${value} is not supported object value`)
      }

      return subjectInQuad.termType == 'NamedNode'
        ? rdfjs.quad(subjectInQuad, propertyInQuad, objectInQuad) 
        : rdfjs.metaQuad(subjectInQuad, propertyInQuad, objectInQuad) 
    }
    const newQuad = makeQuad(this.subject, this.property, this.value)
    return newQuad    
  }

  toString() : string {
    return JSON.stringify(
      {
        subject : this.subject.toString(), //recursively serialize the subject ID -- this could be another PropertyValueIdentifier
        property: this.property,
        value: this.value as SubjectId || this.value //TODO this could be another property value id, so needs to be recursively 
      }
    )
  }
}

class SubjectTripler implements Tripler<Subject, Dataset> {

  constructor(readonly graph: Graph) { }

  async fetch(client: TripleStore, element: Subject): Promise<Subject> {
    let quads = await client.fetch(rdfjs.named((element.id as IRISubjectId).iri))
    this.ingest(element, quads)
    return element
  }

  /**
   * parse a dataset into individual's properties
   * @param graph TODO only the factory is needed and it probably shouldn't be passed as parameter
   * @param subjectId The subject whose properties we are constructing
   * @param dataset The dataset to parse
   * @returns 
   */
  private parseDataset(subjectId : SubjectId, dataset: Quads): object  {

    const props = {} 
    const quads: Array<Quad> = Array.from(dataset['_quads'].values())
    // This dataset.filter method is documented as part of the DatasetCore interface
    // but it seems like it's not implemented yet. Need to reach out to that rdfjs community
    // and maybe get implicated, help or whatever...
    // dataset.filter
    
    quads.filter( (quad:Quad) => {
        if (subjectId instanceof PropertyValueIdentifier) {
          const asQuad = subjectId.toQuad()
          return compareQuads(asQuad, quad.subject as Quad)
        }
        else {
          // compare as normal IRI subjects
          return (subjectId as IRISubjectId).iri == quad.subject.value
        }
      })
      .forEach( quad => {
        // console.log(quad)
      let newVal
      if (quad.object.termType == "NamedNode") {
        newVal = this.graph.factory.subject(new IRISubjectId(quad.object.value))
      }
      else if (quad.object.termType == "Literal") {
        newVal = quad.object //.value
      }
      if (props[quad.predicate.value] instanceof Array) {
        props[quad.predicate.value].push(newVal)
      }
      else if (props[quad.predicate.value]) {
        props[quad.predicate.value] = [props[quad.predicate.value], newVal]
      }
      else {
        props[quad.predicate.value] = newVal
      }    
    })
    return props
  }

  ingest(element: Subject, rawdata: Quads): Subject {    
    const impl = element as SubjectImpl
    const props =this.parseDataset(impl.id, rawdata);
    impl['properties'] = props    
    //TODO ingest annotation data from the dataset 
    // for (const entry of Object.entries(annotation)) {
    //   this.annotation[entry[0]] = entry[1]
    // }
    return element
  }
}


export class SubjectAnnotatedFactory implements DMEFactory<SubjectId, Subject> {
  
  private triplerImpl: Tripler<Subject, Quads>

  constructor(readonly graph: Graph) {
    this.triplerImpl = new SubjectTripler(graph)
  } 

  get elementType() {  return SubjectImpl }

  identify(...args): SubjectId {
    return args[0]  
  }

  make(...args): AnnotatedDomainElement<SubjectId, Subject> {
    const id = args[0] as SubjectId
    const graph = args[1]
    const element = new SubjectImpl(id, graph)
    let res = new AnnotatedDomainElement(id, element)
    // no mentions for a subject....
    return res
  }

  get tripler(): Tripler<Subject, Quads> {
    return this.triplerImpl
  }
}

export let basicDomainFactories = {
  "subject" : (graph:Graph) => new SubjectAnnotatedFactory(graph)
}
