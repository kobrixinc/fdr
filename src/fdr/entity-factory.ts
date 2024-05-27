import { PropertyChange, PropertyReplaced, QuadChange } from "./changemgmt.js"
import { AnnotatedDomainElement, DMEFactoryImpl, DataSpec } from "./dataspecAPI.js"  
class AttributeModel {
  constructor(readonly name: string, readonly iri: string) {
    console.log('created an attribute', name, iri)
  }
}

class RelationModel {
  constructor(readonly name: string, readonly iri: string) {
    console.log('created a relation', name, iri)
  }
}

class ClassModel {
  private static internal_iri_property = '__fdr__assigned_iri'
  iriAttribute: string | undefined
  iriFactory: Function | undefined 
  attributes: AttributeModel[] = []
  relations : RelationModel[] = []
  factory : Function = () => new Object()

  get classname() { return this.factory.prototype.name }

  produceIri(entity: object): string {
    if (this.iriAttribute) {
      let iri = entity[this.iriAttribute]
      if (!iri) {
        if (this.iriFactory) {
          iri = this.iriFactory(entity)
          entity[this.iriAttribute] = iri
        }
        else 
          new Error("IRI attribute of entity + " + entity + " of type " + this.classname
              + " expected to have an IRI assigned to property " + this.iriAttribute +
            ", but that property is empty and there is no iriFactory provided in the class annotation.")
      }
      return iri
    }
    else if (entity.hasOwnProperty(ClassModel.internal_iri_property)) {
      return entity[ClassModel.internal_iri_property]
    }
    else if (this.iriFactory) {
      let iri = this.iriFactory(entity)
      entity[this.iriAttribute ? this.iriAttribute : ClassModel.internal_iri_property] = iri
      return iri
    }
    else 
      throw new Error("Class " + this.classname + 
        " has no IRI factory or property name specified")
  }

  semanticPropertyFor(key: string) {
    let amodel = this.attributes.find(a => a.name == key)
    return amodel && amodel.iri
  }
}

type Constructor = new (...args: any[]) => {};

function WithEntityDataSpec<TBase extends Constructor>(Base: TBase) {
  const custom = Base.name + "_as_FDR_Entity"
  type NewType = Constructor & DataSpec<NewType>
  // the following construct for creating the new class is a trick
  // i found on StackOverflow to create a class with a dynamically
  // generated name and assign it to a variable called MixedClass
  const { [custom]: MixedClass } = { [custom]: 
  class extends Base implements DataSpec<NewType> {

    private __fdr__model: ClassModel
    private __fdr__changes: Array<PropertyChange> = []

    private __track_changes(key: string) {
      const property = Object.getOwnPropertyDescriptor(this, key)
      if (!property) return
      if (property.configurable === false) return

      const propIri = this.__fdr__model.semanticPropertyFor(key)

      if (!propIri) {
        return
      }

      const getter = property.get
      const setter = property.set
      
      Object.defineProperty(this, key, {
        enumerable: true,
        configurable: true,
        get: getter,
        set: function fdrTrackingSetter(newVal) {
          let oldVal = getter?.apply(this)
          setter?.apply(this, newVal)
          let change = new PropertyReplaced(propIri, oldVal, newVal)
          this.__fdr__changes.push(change)
        }
      })
    }

    private __fdr__prepare() {
      const keys = Object.keys(this)
      for (let i = 0; i < keys.length; i++) {
        // TODO: check if this property is mapped to an RDF property
        this.__track_changes(keys[i])
      }
    }

    constructor(...args: any[]) {
      super(...args.slice(1))
      this.__fdr__model = args[0]
      this.__fdr__prepare()
    }

    workingCopy(reactivityDecoratorFunction? : <T extends NewType>(T) => T) : NewType {
      // console.log('creating a working copy')
      return new (<any>MixedClass)()
    }

    /**
     * Commit changes performed to this DataSpec object to its
     * source of truth
     */
    async commit() : Promise<void>  {  
      // console.log('committing!')

      let changes : QuadChange[] = []
      this.__fdr__changes.forEach(change =>  {
        const quadchanges = change.toQuadChanges(this)
        changes = changes.concat(quadchanges)
      })      
    }
     
     /**
     * Whether this dataspec is ready to use
     */
    ready:boolean  = false   
  }}
  return MixedClass
}

let metadata: { 'undefined': any} = {'undefined': null}
let make: Record<string, Function> = {}

function nextClass() {
  metadata['undefined'] = { 'attributes': [], 'relations' : []}
}
nextClass()

const entity = (spec: Object) => {
  return (target: Constructor) => {
    let classModel = new ClassModel()    
    const finalClass = WithEntityDataSpec(target)
    const maker = function(iri) {
      let id = iri
      if (!iri && spec.hasOwnProperty('iriFactory')) {
        // console.log('compute id', spec)
        id = spec['iriFactory']()
      }
      let result = new (<any> finalClass)(classModel, id)
      let model = metadata[target.name]
      // console.log('making object from model', model)
      // return result
      return new AnnotatedDomainElement(iri, result)
    }
    const identifier = function(iri) { return iri }
    const factory = new DMEFactoryImpl(target, identifier, maker)

    Object.defineProperty(make, target.name, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: factory // maker,
    })
    classModel.factory = maker
    classModel.attributes = metadata['undefined']['attributes']
    classModel.relations = metadata['undefined']['relations']
    metadata[target.name] = classModel    
    nextClass()
  }
}

type AttributeSpec = {type: string}
type RelationSpec = {}

function attribute(spec: AttributeSpec)  {
  return function (target: any, key: string): void {
    console.log('attribute decorator', spec, target, key)
    metadata['undefined']['attributes'].push(new AttributeModel(key, "http://test.org/" + key))
  }
}

function relation(spec: RelationSpec) {
  return function (target: any, key: string): void {
    console.log('attribute decorator', spec, target, key)
    metadata['undefined']['relations'].push(new RelationModel(key, "http://test.org/" + key))
  }  
}

@entity({
  iriFactory: () => "http://foaf.org/address/" + Math.random(),
  type: "http://foaf.org/Person"
})
class Address {
  @attribute({type: 'xsd:string'})
  street: string = ''
  @attribute({type: 'xsd:string'})
  city: string = ''
  @attribute({type: 'xsd:string'})
  id: string = ''

  constructor(id: string) {
    this.id = id;
  }
}

@entity({
  iriFactory: () => "http://foaf.org/person/" + Math.random(),
  type: "http://foaf.org/Person"
})
class Person {
  @attribute({type:'xsd:integer'})
  mynum : number
  @relation({})
  address: Array<Address> = []

  constructor(readonly id: string)  {
    console.log('Person constructor called')
    this.mynum = Math.random()  
  }
  toString(): string { return this.id }
}

// let p = make.Person()
// let p1 = p.workingCopy()
// p.commit()
// console.log(p.mynum)
// console.log(p)
// console.log(p1)

export default make
