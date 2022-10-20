import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Term } from "@rdfjs/types"

export class make {
  static named(iri) { return modelFactory.namedNode(iri) }
  static literal(iri) { return modelFactory.literal(iri) }
  static quad(x: NamedNode, y: NamedNode, z: Term, g?:Term) { return modelFactory.quad(x, y, z, g) }
}

export type LiteralValue = number | string | boolean

export type  { NameResolver, DefaultNameResolver } from "./naming"
export type { Subject } from "./dataspecAPI"
export * from "./triplestore-client"
export * from "./graph"