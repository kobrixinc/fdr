import "reflect-metadata"
import { PropertyChange, PropertyReplaced, QuadChange } from "./changemgmt.js"
import { AnnotatedDomainElement, Constructor, DMEFactory, DMEFactoryConstructor, DMEFactoryImpl, DataSpec, IRISubjectId, Tripler } from "./dataspecAPI.js"  
import { rdfjs } from "./fdr.js"
import { Graph, LocalGraph } from "./graph.js"
import { Quads, TripleStore } from "./triplestore-client.js"
class AttributeModel {
  constructor(readonly name: string, 
              readonly datatype: string,
              readonly iri: string,
              readonly runtimeType?: object) {
    // console.log('created an attribute', name, iri)
  }
}

class RelationModel {
  constructor(readonly name: string, 
              readonly entityType: string, 
              readonly iri: string,
              readonly runtimeType?: object) {
    // console.log('created a relation', name, iri)
  }
}

/**
 * The semantic model of a TypeScript class is build out of
 * attributes (equivalently "data properties") and relations
 * (equivalently "object properties")
 */
class ClassModel {
  private static object_class = new Function()
  private static internal_iri_property = '__fdr__assigned_iri'
  private _attributes: Record<string, AttributeModel> = {}
  private _relations : Record<string, RelationModel> = {}

  typeIri: string | undefined
  idProperty: string | undefined
  iriFactory: Function | undefined 
  
  javascriptClass: Function = ClassModel.object_class
 
  get classname() { 
    return this.javascriptClass.prototype.constructor.name.replace('_as_FDR_Entity', '') 
  }

  set attributes(attributeList: AttributeModel[]) {
    attributeList.forEach(a => this._attributes[a.name] = a)
  }

  set relations(relationList: RelationModel[]) {
    relationList.forEach(a => this._relations[a.name] = a)
  }

  get propertiesWithAttributes(): Array<string> {
    return Object.keys(this._attributes)
  }

  get propertiesWithRelations(): Array<string> {
    return Object.keys(this._relations)
  }

  /**
   * Return the IRI of the property corresponding to a given
   * JavaScript property, assuming that property is an attribute. 
   * @param name 
   */
  attributeFor(name: string): AttributeModel | undefined {
    return this._attributes[name]
  }

  nameForIRI(iri: string): string | undefined {
    let attr = Object.values(this._attributes).find(a => a.iri == iri)
    if (attr) return attr.name
    let rel =  Object.values(this._relations).find(r => r.iri == iri)
    if (rel) return rel.name    
  }

  relationFor(name: string): RelationModel | undefined {
    return this._relations[name]
  }

  relatedModel(prop: string): ClassModel | undefined {
    // Need a more solid and a better defined version of this
    // Might need an extra attribute of the @relation deocarator
    // to specify the typename
    let rel = this.relationFor(prop)
    let result: ClassModel | undefined
    Object.values(types).forEach(m => {
      if (m.typeIri == rel?.entityType)
        result = m
    })
    return result
  }

  produceIri(entity: object): string {
    if (this.idProperty) {
      let iri = entity[this.idProperty]
      if (!iri) {
        if (this.iriFactory) {
          iri = this.iriFactory(entity)
          entity[this.idProperty] = iri
        }
        else 
          new Error("IRI attribute of entity + " + entity + " of type " + this.classname
              + " expected to have an IRI assigned to property " + this.idProperty +
            ", but that property is empty and there is no iriFactory provided in the class annotation.")
      }
      return iri
    }
    else if (entity.hasOwnProperty(ClassModel.internal_iri_property)) {
      return entity[ClassModel.internal_iri_property]
    }
    else if (this.iriFactory) {
      let iri = this.iriFactory(entity)
      entity[this.idProperty ? this.idProperty : ClassModel.internal_iri_property] = iri
      return iri
    }
    else 
      throw new Error("Class " + this.classname + 
        " has no IRI factory or property name specified")
  }

  semanticPropertyFor(key: string) {
    let amodel = this.attributeFor(key)
    return amodel && amodel.iri
  }
}

enum EntityLifecycle {
  constructed = 0, populating, populated // maybe others down the road
}

function WithEntityDataSpec<TBase extends Constructor>(Base: TBase) {
  const custom = Base.name + "_as_FDR_Entity"
  type NewType = Constructor & DataSpec<NewType>
  // the following construct for creating the new class is a trick
  // i found on StackOverflow to create a class with a dynamically
  // generated name and assign it to a variable called MixedClass
  const { [custom]: MixedClass } = { [custom]: 
  class extends Base implements DataSpec<NewType> {

    protected __fdr__model: ClassModel
    protected __fdr__super_args: Array<any>    
    protected __fdr__changes: Array<PropertyChange> = []
    protected __fdr__lifecycle: EntityLifecycle = EntityLifecycle.constructed

    protected __track_changes(key: string) {
      let self = this
      const property = Object.getOwnPropertyDescriptor(this, key)
      if (!property) return
      if (property.configurable === false) return

      const propIri = this.__fdr__model.semanticPropertyFor(key)

      if (!propIri) {
        return
      }

      let val = self[key]

      const getter = property.get
      const setter = property.set

      let def = {
        enumerable: true,
        configurable: true,
        get: function() {
          if (!self.ready)
            throw new Error("Entity " + self.toString() + " not ready for us, please call `Graph.use()` beforehand.")
          return getter ? getter.call(this) : val
        },
        set: function fdrTrackingSetter(newVal) {
          if (!self.ready && self.__fdr__lifecycle != EntityLifecycle.populating)
            throw new Error("Entity " + self.toString() + " not ready for us, please call `Graph.use()` beforehand.")
          let oldVal = getter ? getter.call(this) : val
          if (setter) setter.call(this, newVal)
          else val = newVal
          if (self.__fdr__lifecycle == EntityLifecycle.populated) {
            let change = new PropertyReplaced(propIri, oldVal, newVal)
            self.__fdr__changes.push(change)
          }
        }
      }
      Object.defineProperty(this, key, def)
    }

    private __fdr__prepare() {
      const keys = Object.keys(this)
      for (let i = 0; i < keys.length; i++) {
        if (this.__fdr__model.attributeFor(keys[i]))
          this.__track_changes(keys[i])
      }
    }

    private get graph(): LocalGraph {
      return this.__fdr__model['graph']
    }

    protected __fdr__applyChanges(changes: Array<PropertyChange>) {
      let self = this
      function applyOne(change: PropertyChange) {
        if (change instanceof PropertyReplaced) {
          let name = self.__fdr__model.nameForIRI(change.name)
          if (name)
            self[name] = change.newvalue
          else {
            console.log('No entity property for IRI in change object', change)
            throw new Error("Cannot find property for IRI " + change.name)
          }
        }
        else {
          console.log("Unexpected property change.", change)
          throw new Error("Unexpected property change for a strongly typed entity: " + change)
        }
      }
      changes.forEach(applyOne)
    }

    // Fist argument is the model (ClassModel) and therest
    // is whatever the base class needs, however it's defined
    constructor(...args: any[]) {
      super(...args.slice(1))
      this.__fdr__super_args = args.slice(1)
      this.__fdr__model = args[0]
      this.__fdr__prepare()
    }

    get typename(): string {
      return this.__fdr__model.classname
    }

    workingCopy(reactivityDecoratorFunction? : <T extends NewType>(T) => T) : NewType {
      // console.log('creating a working copy')
      let copy = new WorkingCopy(this) //new (<any>MixedClass)(this.__fdr__model, this.__fdr__super_args)
      copy.__fdr__lifecycle = EntityLifecycle.populating
      const keys = Object.keys(this)
      for (let i = 0; i < keys.length; i++) {
        if (this.__fdr__model.attributeFor(keys[i]))
          copy[keys[i]] = this[keys[i]]
      }
      copy.__fdr__lifecycle = EntityLifecycle.populated
      return copy as unknown as NewType
    }

    /**
     * Commit changes performed to this DataSpec object to its
     * source of truth
     */
    async commit() : Promise<void>  {  
      // console.log('committing!')

      let changes : QuadChange[] = []
      this.__fdr__changes.forEach(change =>  {
        const quadchanges = change.toQuadChanges(
          new IRISubjectId(this.__fdr__model.produceIri(this)))
        changes = changes.concat(quadchanges)
      })

      try {
        const result = await this.graph.client.modify(changes)
        if (!result.ok) {
          throw new Error(`Could not commit changes ${changes}`)
        }
      }
      finally {
        this.__fdr__changes.splice(0, this.__track_changes.length)
      }      
    }
     
     /**
     * Whether this dataspec is ready to use
     */
    get ready(): boolean {
      return this.__fdr__lifecycle != EntityLifecycle.constructed
    }
  }}

  class WorkingCopy extends MixedClass  {

    private readonly __fdr__parent

    constructor(...args: any[]) {
      let parent = args[0]
      super(parent['__fdr__model'], parent['__fdr__super_args'])
      this.__fdr__parent = parent
    }

    workingCopy(reactivityDecoratorFunction? : <T extends NewType>(T) => T) : NewType {
        return new WorkingCopy(this) as unknown as NewType
    }
    
    get ready() { return true }

    async commit() : Promise<void>  {
      this.__fdr__parent.__fdr__applyChanges(this.__fdr__changes)
    }
  }

  return MixedClass
}

 
let metadata: { 'undefined': any} = {'undefined': null}
let make: Record<string, DMEFactoryConstructor<any, any>> = {}
let types: Record<string, ClassModel> = {}

function nextClass() {
  metadata['undefined'] = { 'attributes': [], 'relations' : []}
}
nextClass()

class EntityTripler implements Tripler<object> {

  private formulatePattern(model: ClassModel, pattern: object): void {
    model.propertiesWithAttributes.forEach(prop => {
      let attr = model.attributeFor(prop)
      if (!attr) {
        throw new Error("No attribute found for property " + prop + " of " + model.classname)
      }
      pattern[attr.iri] = null
    })

    model.propertiesWithRelations.forEach(prop => {
      // let rel = this.classModel.relationFor(prop)
      let nestedModel = model.relatedModel(prop)
      let rel = model.relationFor(prop)
      if (!nestedModel || !rel) {
        throw new Error("No ClassModel found for property " + prop + " of " + model.classname)
      }
      let nestedPattern = {
        "@type": nestedModel?.typeIri,
        "@id": null
      }      
      this.formulatePattern(nestedModel!, nestedPattern)
      pattern[rel?.iri] = nestedPattern
    })    
  }

  private populateFromResult(element: object, model: ClassModel, data: object): void {
    element['__fdr__lifecycle'] = EntityLifecycle.populating        
    model.propertiesWithAttributes.forEach(prop => {
      let attr = model.attributeFor(prop)
      element[prop] = data[attr!.iri]
    })
    model.propertiesWithRelations.forEach(prop => {
      let rel = model.relationFor(prop)!
      let nested = data[rel.iri]
      let nestedId = data[rel.iri]['@id'] 
      let typename = types[rel.entityType].classname // Object.keys(types).find(key => types[key].typeIri == rel.entityType)     
      let nestedElement = this.graph.factory[typename!](nestedId)
      if (nestedElement.ready) {
        // do we skip populating here from result?
      }
      this.populateFromResult(nestedElement, model.relatedModel(prop)!, nested)
      if (rel.runtimeType && rel.runtimeType['name'] == "Array") {
        if (typeof element[prop] == "undefined")
          element[prop] = [nestedElement]
        else if (Array.isArray(element[prop]))
          element[prop].push(nestedElement)
        else
          element[prop] = [element[prop], nestedElement]
      } 
      else     
        element[prop] = nestedElement
    })
    element['__fdr__lifecycle'] = EntityLifecycle.populated
  }
  
  constructor(readonly graph: Graph, readonly classModel: ClassModel) { 

  }

  async fetch(client: TripleStore, element: object): Promise<object> {
    let pattern = {
      "@type": this.classModel.typeIri,
      "@id": this.classModel.produceIri(element)
    }

    this.formulatePattern(this.classModel, pattern)

    let matches = await client.match(pattern)        
    matches.forEach(data => {
      this.populateFromResult(element, this.classModel, data)
    })
    // if (matches.length > 0) {
    //   let data = matches[0]
    //   this.populateFromResult(element, this.classModel, data)
    // }
    element['__fdr__lifecycle'] = EntityLifecycle.populated
    return element
  }
}

class EntityFactory implements DMEFactory<IRISubjectId, any> {

  classModel: ClassModel
  readonly tripler: Tripler<any>
  
  constructor(readonly elementType: Constructor, 
              readonly classModelBase: ClassModel,
              readonly graph: Graph) {
    this.classModel = Object.create(classModelBase)
    this.classModel['graph'] = graph
    this.tripler = new EntityTripler(this.graph, this.classModel)
  }

  identify(...args: any[]): IRISubjectId {
    return args[0]
  }
  make(...args: any[]): AnnotatedDomainElement<IRISubjectId, any> {
    let iri = args[0]
    let id = iri
    if (!iri && this.classModel.iriFactory) {
      // console.log('compute id', spec)
      id = this.classModel.iriFactory()
    }
    let result = new (<any> this.classModel.javascriptClass)(this.classModel, id)
    if (this.classModel.idProperty)
      result[this.classModel.idProperty] = id
    return new AnnotatedDomainElement(iri, result)
  }
}

export const entity = (spec: EntitySpec) => {
  return (target: Constructor) => {
    let classModel = new ClassModel()    
    classModel.typeIri = spec.type
    const finalClass = WithEntityDataSpec(target)
    classModel.javascriptClass = finalClass
    if (spec.idProperty)
      classModel.idProperty = spec.idProperty
    classModel.attributes = metadata['undefined']['attributes']
    classModel.relations = metadata['undefined']['relations']
    metadata[target.name] = classModel    
    types[spec.type] = classModel

    Object.defineProperty(make, target.name, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (graph: Graph) => 
                new EntityFactory(target, classModel, graph)
    })
    nextClass()
  }
}

type EntitySpec = {type: string, iriFactory?: Function, idProperty?: string }
type AttributeSpec = {type: string, iri: string}
type RelationSpec = {type: string, iri: string}

export function attribute(spec: AttributeSpec)  {
  return function (target: any, key: string): void {
    console.log('attribute decorator', spec, target, key)
    metadata['undefined']['attributes'].push(new AttributeModel(key, spec.type, spec.iri))
  }
}

export function relation(spec: RelationSpec) {
  return function (target: any, key: string): void {
    var runtimeType  = Reflect.getMetadata("design:type", target, key)
    console.log(`Relation ${key} type: ${runtimeType}`);    
    metadata['undefined']['relations'].push(new RelationModel(key, spec.type, spec.iri, runtimeType))
  }  
}

// @entity({
//   iriFactory: () => "http://foaf.org/address/" + Math.random(),
//   type: "http://foaf.org/Person"
// })
// class Address {
//   @attribute({type: 'xsd:string', iri: "http://example.org/street"})
//   street: string = ''
//   @attribute({type: 'xsd:string', iri: "http://example.org/city"})
//   city: string = ''
//   @attribute({type: 'xsd:string', iri: "http://example.org/id"})
//   id: string = ''

//   constructor(id: string) {
//     this.id = id;
//   }
// }

// @entity({
//   iriFactory: () => "http://foaf.org/person/" + Math.random(),
//   type: "http://foaf.org/Person"
// })
// class Person {
//   @attribute({type:'xsd:integer', iri: "http://example.org/mynum"})
//   mynum : number
//   @relation({type:'foaf:Address', iri:'http://www.example.org/hasAddress'})
//   address: Array<Address> = []

//   constructor(readonly id: string)  {
//     console.log('Person constructor called')
//     this.mynum = Math.random()  
//   }
//   toString(): string { return this.id }
// }

// let p = make.Person()
// let p1 = p.workingCopy()
// p.commit()
// console.log(p.mynum)
// console.log(p)
// console.log(p1)

export default make
