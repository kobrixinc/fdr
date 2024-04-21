import { DataFactory, Literal, Quad_Graph, Quad_Object } from "@rdfjs/types"
import modelFactory  from "@rdfjs/data-model"
import { NamedNode, Quad, Term } from "@rdfjs/types"
import { ResolverHolder, WithResolver } from "./naming.js"
import { IRISubjectId, SubjectId } from "./dataspecAPI.js"
import { Graph, LocalGraph } from "./graph.js"
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

function DefaultFDR<TBase extends new (...args: any[]) => ResolverHolder>(Base: TBase) {
  return class DefaultFDR extends Base implements FDR {
    subjectId(name: string): SubjectId {
      return new IRISubjectId(this.resolver.resolve(name))
    }  
    graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph {
      let localgraph = new LocalGraph(this, graphSpecification.store, "", "")
      return localgraph
    }  

    readonly config: FDRConfig  = {
      lang: undefined
    }
  }
}



export interface RDFJS {
  named(iri: string): NamedNode
  /**
   * Construct literaral with the given value for a given language
   * @param value 
   * @param lang if value is a string, this is the language which will be
   * associated with it. The parameter has no effect if the value is not
   * a string. If value is a string and lang is not set, the resulting literal
   * will have no language (duh.)
   * TODO we probably need a type parameter in order to support non string
   * types which are represented by JS strings 
   * 
   */
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

      switch (typeof value) {
        case 'string': {
          return mf.literal(value, lang) 
        }
        case 'number': {
          if (Number.isInteger(value))
            return mf.literal(Math.floor(value).toString(), mf.namedNode('http://www.w3.org/2001/XMLSchema#integer')) 

          return mf.literal(value.toString(), mf.namedNode('http://www.w3.org/2001/XMLSchema#decimal')) 
        }
        case 'boolean': {
          return mf.literal(value.toString(), mf.namedNode('http://www.w3.org/2001/XMLSchema#boolean')) 
        }
      
        default:
          throw new Error(`${value} is of illegal type ${typeof value}`)
      }
    }
  
    quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph) { 
      return mf.quad(x, y, z as Quad_Object, g) 
    }
    
    metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph) {
      return mf.quad(x, y, z, g) 
    }
  }
}



export type LiteralValue = number | string | boolean
export type LiteralStruct = { value: string, language?: string, datatype?: NamedNode }

export type  { NameResolver, DefaultNameResolver } from "./naming.js"
export type { Subject } from "./dataspecAPI.js"
export * from "./triplestore-client.js"
export * from "./graph.js"

class BaseGraphEnvFacade extends ResolverHolder {
  // resolver: DefaultNameResolver = resolvers.default()
}

const GraphEnvFacade = DefaultFDR(DefaultRDFJS(BaseGraphEnvFacade))
/**
 * An environment which hosts multiple related graphs and contains state 
 * which should be shared between those graphs e.g. prefixes, default
 * language. 
 * 
 * The objects used to interact with the graphs must be created using
 * the factory methods of the environment which holds the graph.
 */
export type GraphEnvironment = FDR & WithResolver 

export const fdr: FDR & RDFJS & ResolverHolder = new GraphEnvFacade()

export class rdfjs {

  /*
    In this simplest case when we are using a global GraphEnvironment (namely
    the fdr object), we reuse that for the maker instead of creating a
    fresh object, since we need to reuse the same resolver (and other environment config if needed)
  */
  static maker: RDFJS & WithResolver = fdr

  static named(iri: string) 
    { return rdfjs.maker.named(iri) }

  /**
   * 
   * @param value 
   * @param lang 
   * @returns 
   */
  static literal(value: string | number | boolean, lang?: string) { 
    return rdfjs.maker.literal(value, lang) 
  }

  static quad(x: NamedNode, y: NamedNode, z: Term, g?:Quad_Graph) 
    { return rdfjs.maker.quad(x, y, z, g) }
  
  // TODO: the term in object position here, the 'z' argument can also be a quad
  static metaQuad(x: Quad, y: NamedNode, z: Quad|NamedNode|Literal, g?: Quad_Graph) 
    { return rdfjs.maker.metaQuad(x, y, z, g) }
}


/**
 * A factory for common FDR objects. 
 */
export class fdrmake {

  /*
    In this simplest case when we are using a global GraphEnvironment (namely
    the fdr object), we reuse that for the maker instead of creating a
    fresh object, since we need to reuse the same resolver (and other environment config if needed)
  */
  static maker = fdr

  static subjectId(name: string): SubjectId {
    return fdrmake.maker.subjectId(name)
  }

  static graph(graphSpecification: {store: TripleStore, id? : string, label? : string }): Graph {
    return fdrmake.maker.graph(graphSpecification)
  }
}