import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Term } from "@rdfjs/types"

export class make {
  static named(iri) { return modelFactory.namedNode(iri) }
  static literal(iri) { return modelFactory.literal(iri) }
  static quad(x: NamedNode, y: NamedNode, z: Term, g?:Term) { return modelFactory.quad(x, y, z, g) }
}

export type LiteralValue = number | string | boolean

export type  { NameResolver, DefaultNameResolver } from "./naming.js"
export type { Subject } from "./dataspecAPI.js"
export * from "./triplestore-client.js"
export * from "./graph.js"