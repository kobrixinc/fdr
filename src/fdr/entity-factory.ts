import { LocalGraph, fdr } from "./fdr.js"
import { DataSpec } from "./dataspecAPI.js"

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
  attributes: AttributeModel[] = []
  relations : RelationModel[] = []
  factory : Function = () => new Object()

}

type Constructor = new (...args: any[]) => {};

function WithEntityDataSpec<TBase extends Constructor>(Base: TBase) {
  const custom = Base.name + "_as_FDR_Entity"
  type NewType = Constructor & DataSpec<NewType>
  const { [custom]: MixedClass } = { [custom]: 
  class extends Base implements DataSpec<NewType> {
    constructor(...args: any[]) {
      super(args)
    }
    workingCopy(reactivityDecoratorFunction? : <T extends NewType>(T) => T) : NewType {
      console.log('creating a working copy')
      return new (<any>MixedClass)()
    }
  
    /**
     * Commit changes performed to this DataSpec object to its
     * source of truth
     */
    async commit() : Promise<void>  {  
      console.log('committing!')
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
    const finalClass = WithEntityDataSpec(target)
    const maker = function(iri) {
      let id = iri
      if (!iri && spec.hasOwnProperty('iriFactory')) {
        console.log('compute id', spec)
        id = spec['iriFactory']()
      }
      let result = new (<any> finalClass)(id)
      let model = metadata[target.name]
      console.log('making object from model', model)
      return result
    }
    Object.defineProperty(make, target.name, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: maker,
    })
    let classModel = new ClassModel()
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
