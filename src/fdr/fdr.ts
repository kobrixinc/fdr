import { DataFactory, Literal, Quad_Graph, Quad_Object } from "@rdfjs/types"
import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Quad, Term } from "@rdfjs/types"

const mf = modelFactory as DataFactory

export class make {
  static named(iri) { return mf.namedNode(iri) }
  static literal(iri) { return mf.literal(iri) }

  static quad(x: NamedNode, y: NamedNode, z: Quad_Object, g?:Quad_Graph) { 
    return mf.quad(x, y, z, g) 
  }
  
  // TODO: the term in object position here, the 'z' argument can also be a quad
  static metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph) {
    return mf.quad(x, y, z, g) 
  }
}

export type LiteralValue = number | string | boolean

export type  { NameResolver, DefaultNameResolver } from "./naming.js"
export type { Subject } from "./dataspecAPI.js"
export * from "./triplestore-client.js"
export * from "./graph.js"