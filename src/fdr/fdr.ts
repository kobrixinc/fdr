import { DataFactory, Literal, Quad_Graph, Quad_Object } from "@rdfjs/types"
import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Quad, Term } from "@rdfjs/types"
import { DefaultNameResolver, NameResolver, ResolverHolder, WithResolver, resolvers } from "./naming.js"
import { IRISubjectId, SubjectId } from "./dataspecAPI.js"
import { Graph, LocalGraph } from "./graph.js"
import SPARQLProtocolClient from "./sparql-triplestore-client.js"
import { TripleStore } from "./triplestore-client.js"

const mf = modelFactory as DataFactory

export interface FDR {
  subjectId(name: string): SubjectId
  graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph
}

function DefaultFDR<TBase extends new (...args: any[]) => WithResolver>(Base: TBase) {
  return class DefaultFDR extends Base implements FDR {
    subjectId(name: string): SubjectId {
      return new IRISubjectId(this.resolver.resolve(name))
    }  
    graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph {
      let localgraph = new LocalGraph(graphSpecification.store, "", "")
      localgraph.nameResolver = this.resolver
      return localgraph
    }  
  }
}

/**
 * A factory for common FDR objects. 
 */
export class fdrmake {

  static maker: FDR = new (DefaultFDR(ResolverHolder))

  static subjectId(name: string): SubjectId {
    return fdrmake.maker.subjectId(name)
  }

  static graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph {
    return fdrmake.maker.graph(graphSpecification)
  }
}

export interface RDFJS {
  named(iri: string): NamedNode
  literal(value: string | number | boolean): Literal
  quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph): Quad
  metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph): Quad
}

function DefaultRDFJS<TBase extends new (...args: any[]) => WithResolver>(Base: TBase) {
  return class DefaultRDFJS extends Base implements RDFJS {
    named(iri: string) { 
      return mf.namedNode(this.resolver.resolve(iri))
    }  
    literal(value: string | number | boolean) { 
      return mf.literal(value.toString()) 
    }
  
    quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph) { 
      return mf.quad(x, y, z as Quad_Object, g) 
    }
    
    metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph) {
      return mf.quad(x, y, z, g) 
    }
  }
}

export class rdfjs {

  static maker: RDFJS & WithResolver = new (DefaultRDFJS(ResolverHolder))

  static named(iri: string) 
    { return rdfjs.maker.named(iri) }

  static literal(value: string | number | boolean) 
    { return rdfjs.maker.literal(value) }

  static quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph) 
    { return rdfjs.maker.quad(x, y, z, g) }
  
  // TODO: the term in object position here, the 'z' argument can also be a quad
  static metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph) 
    { return rdfjs.maker.metaQuad(x, y, z, g) }
}

export type LiteralValue = number | string | boolean

export type  { NameResolver, DefaultNameResolver } from "./naming.js"
export type { Subject } from "./dataspecAPI.js"
export * from "./triplestore-client.js"
export * from "./graph.js"

class BaseGraphEnvFacade extends ResolverHolder {
  // resolver: DefaultNameResolver = resolvers.default()
}

export const GraphEnvFacade = DefaultFDR(DefaultRDFJS(BaseGraphEnvFacade))
export const fdr = new GraphEnvFacade()
