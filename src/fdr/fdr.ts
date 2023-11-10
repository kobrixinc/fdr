import { DataFactory, Literal, Quad_Graph, Quad_Object } from "@rdfjs/types"
import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Quad, Term } from "@rdfjs/types"
import { DefaultNameResolver, NameResolver, ResolverHolder, WithResolver, resolvers } from "./naming.js"
import { IRISubjectId, SubjectId } from "./dataspecAPI.js"
import { Graph, LocalGraph } from "./graph.js"
import SPARQLProtocolClient from "./sparql-triplestore-client.js"
import { TripleStore } from "./triplestore-client.js"

const mf = modelFactory as DataFactory

/**
 * Configuration of the FDR environment, providing defaults across
 * all open graphs and objects.
 */
export interface FDRConfig {
  /**
   * The default language to use when returning literal values. This is initially
   * undefined which means that a random literal will be return in case of a multi-lingual
   * graph. The set it to a specific value do `fdr.config.lang="en"`.
   * 
   * Note that this affects only retrieval of literal values, not storage. That is, if a
   * new property is being added to an entity, one has to explicitly set the language of the literal
   * if one wants it to be stored in the triplestore.
   */
  lang: string | undefined 
}

export interface FDR {
  subjectId(name: string): SubjectId
  graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph
  config: FDRConfig
}

function DefaultFDR<TBase extends new (...args: any[]) => WithResolver>(Base: TBase) {
  return class DefaultFDR extends Base implements FDR {
    subjectId(name: string): SubjectId {
      return new IRISubjectId(this.resolver.resolve(name))
    }  
    graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph {
      let localgraph = new LocalGraph(this, graphSpecification.store, "", "")
      localgraph.nameResolver = this.resolver
      return localgraph
    }  

    readonly config: FDRConfig  = {
      lang: undefined
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
  literal(value: string | number | boolean, lang?: string): Literal
  quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph): Quad
  metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph): Quad
}

function DefaultRDFJS<TBase extends new (...args: any[]) => WithResolver>(Base: TBase) {
  return class DefaultRDFJS extends Base implements RDFJS {
    named(iri: string) { 
      return mf.namedNode(this.resolver.resolve(iri))
    }  
    literal(value: string | number | boolean, lang?: string) { 
      return mf.literal(value.toString(), lang) 
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

  static literal(value: string | number | boolean, lang?: string) 
    { return rdfjs.maker.literal(value, lang) }

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
