import { Dataset, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import { fdr, rdfjs } from "./fdr.js"
import { TripleNode, PathExpression, QuerySubject, SparqlSelect, Triple, Var, nodeEquals, path } from "./sparql.js"

class QueryPath {
  constructor(readonly variable: Var, 
              readonly path: PathExpression,
              readonly constraints: Array<any> = []) { }
}

function sparqlFromPaths(pathList: Array<QueryPath>): SparqlSelect { 
  let sparql = new SparqlSelect()
  let root = new Var("root")
  for (const p of pathList) {
    sparql.selection.variables.push(p.variable)
    sparql.pattern.triples.push(new Triple(
      root,
      p.path,
      p.variable
    ))
    for (const c of p.constraints) {
      // TODO
    }
    // All properties
    sparql.pattern.triples.push(new Triple(
      p.variable,
      new Var(p.variable.name + "_prop"),
      new Var(p.variable.name + "_val")
    ))
  }
  return sparql
}

let varcount = 0
function varnameFromProp(prop: string): string {
  let iri = new URL(rdfjs.named(prop).value)
  if (iri.hash)
    return iri.hash.substring(1) + varcount++;
  else 
    return iri.pathname.split("/").filter(Boolean).pop()! + varcount++
} 

enum Operator {
  equals = "=",
  notEquals = "!=",
  lessThan = "<",
  greaterThan = ">",
  lessThanOrEqual = "<=",
  greaterThanOrEqual = ">=",
  any = "any"
}

function isOperator(val: string): val is Operator {
  return Object.values(Operator).includes(val as Operator);
}

class LiteralObject {
  parent: QueryPattern | null = null
  variable: Var | null = null

  constructor(readonly operator: Operator, 
              readonly value: string | null = null, 
              readonly datatype: string = "xsd:string", 
              readonly language: string = "@eng") { 
  }

  queryContext(parent: QueryPattern, variable: Var): LiteralObject {
    this.parent = parent
    this.variable = variable
    return this
  }
}

export class QueryPattern {
  // Used both as a SPARQL variable representing this pattern and for recursive references
  // can be user provided and it has to be unique for the entire pattern or auto-generated.
  refvar: Var = new Var("")
  iri: string | null = null // known @id
  propMap: Record<string, LiteralObject | QueryPattern> = {}
  multiplicity: Record<string, boolean> = {}
  fetchAll: boolean = false
  sparqlFilters: Array<string> = []

  /**
   * Given a refvar of a QueryPattern which is one of the property targets, find
   * the property name. An inverse lookup of the propMap.
   * 
   * @param objectVar 
   */
  propName(objectVar: string): string | undefined {
    return Object.keys(this.propMap).find(key => {
      let value = this.propMap[key]
      return value instanceof QueryPattern && value.refvar.name === objectVar ||
             value instanceof LiteralObject && value.variable!.name === objectVar
    })
  }

  protected literalProperty (key: string, 
                             op: Operator, 
                             value?: string | null, 
                             datatype?: string, 
                             language?: string) {
    let propvar = Var.make(varnameFromProp(key))                              
    this.root().patternReferences[propvar.name] 
      = this.propMap[key]
      = new LiteralObject(op, value, datatype, language).queryContext(this, propvar)
  }

  protected parseOut(): QueryPattern {
    this.refVar = Var.make()    
    Object.keys(this.struct).forEach(key => {

      let keyParts = key.split("\s+")
      if (keyParts.length > 1)
        key = keyParts[0]

      let value = this.struct[key]

      if ("@context" == key) {
        // ignore for now, we assume context is globally set      
        return
      }
      else if ("@id" == key) {
        // is it a hard IRI, or a ref?
        if (value.startsWith("@")) {
          // a reference means we want to match the same object exactly, same variable
        }
        else { // otherwise it's a know IRI, to be matched exactly
          this.iri = value
        }
        return
      }
      else if ("@type" == key) {
        key = "rdf:type"
      }

      if (Array.isArray(value)) {
        if (value.length == 0) {
          // assume an array of Literals
          this.literalProperty(key, Operator.any)
          return
        }
        else if (value.length == 1) {
          value = value[0]
          this.multiplicity[key] = true
          if (Array.isArray(value)) {
            throw new Error("Cannot interpret an array within an array in a query pattern")
          }
        }
        else {
          throw Error("Cannot interpret an array in a query pattern, excepting 0 or 1 element")
        }
      }
      else
        this.multiplicity[key] = false
        
      if (value != null && typeof value == "object") {
        this.propMap[key] = new QueryPattern(this, value).parseOut()
      } 
      else {
        let operator: Operator = Operator.equals
        if (keyParts.length > 1) {
          if (isOperator(keyParts[1]))
            operator = keyParts[1]
          else 
            new Error("Invalid operator " + keyParts[1])
        }
        else if (value == null)
          operator = Operator.any
        this.literalProperty(key, operator, value)
      }
    })
    return this
  }

  set refVar(v: Var) { 
    this.refvar = v 
    let existing = this.root().patternReferences[v.name]
    if (existing && existing != this) {
      throw Error("Cannot have two patterns with the same name: " + v.name)
    }
    this.root().patternReferences[v.name] = this
  }

  constructor(readonly parent: QueryPattern | null, readonly struct: object) { 
  }
  
  get subject(): QuerySubject | Var {
    if (this.iri) {
      return QuerySubject.make(this.iri)
    }
    else {
      return this.refvar
    }
  }

  get triples(): Array<Triple> {
    let result: Array<Triple> = []
    Object.keys(this.propMap)
      .filter(k => k != "@id").forEach(key => {      
        let v = this.propMap[key]
        let pred = path.predicate(rdfjs.named(key))
        if (v instanceof LiteralObject) {
          if (v.operator == Operator.equals) {
            result.push(new Triple(this.subject, 
                                  pred, 
                                  rdfjs.literal(v.value!, v.language)))
          }
          else {
            result.push(new Triple(this.subject, pred, v.variable!))
            if (v.operator != Operator.any) {
              this.sparqlFilters.push(v.variable + " " + v.operator + " '" + v.value + "'")
            }
          }
        }
        else {
          result.push(new Triple(this.subject, 
                                 pred, 
                                 (v as QueryPattern).subject))
        }
    })
    return result  
  }

  root(): RootQueryPattern { 
    return (this.parent == null ? this : this.parent.root()) as RootQueryPattern
  }
}

/**
 * The root pattern contains global maps b/w variables and sub-patterns, 
 * the top-level paths and ultimately the query generation.
 */
export class RootQueryPattern extends QueryPattern {

  patternReferences: Record<string, QueryPattern | LiteralObject>
  // TODO: maybe a similarly global to collect all paths

  /**
   * 
   * @param struct A JSON-LD pattern structure. 
   */
  constructor(readonly struct: object) { 
    super(null, struct)
    this.patternReferences = {} 
  }
  
  fromBindings(bindings: Array<object>): Array<object> {
    let self = this
    let result = {}  // @id -> object for top-level (i.e. "root") entities returned
    let resultStructure = { } // root ID -> (var -> object) for nested entities, let's us build the resulting structure 
                              // bottom up by progressively connecting entities with their parents and properties.

    function ensureRootNode(binding: object, refvar: Var): object {
      let rootId = binding[refvar.name].value
      let nodes = resultStructure[rootId] = resultStructure[rootId] || {}
      let rootnode = result[rootId] = result[rootId] || { '@id': rootId }     
      nodes[refvar.name] = rootnode      
      return rootnode
    }

    function findResultParentNode(rootId: string, key: string): {prop:string, node:object} {
      let nodes = resultStructure[rootId] = resultStructure[rootId] || {}
      let parentPattern = self.patternReferences[key].parent
      let parentVar = parentPattern!.refvar.name
      nodes[parentVar] = nodes[parentVar] || {}
      let propname = parentPattern!.propName(key)
      if (!propname) {
        console.log("Could not find property name for " + key + " in ", parentPattern)
        throw new Error("Could not find property name for " + key + " in " + JSON.stringify(parentPattern))
      }
      return {prop: propname, node: nodes[parentVar]}
    }

    bindings.forEach(binding => {      
      let root = ensureRootNode(binding, this.refvar)
      for (let key of Object.keys(binding).filter(k => k != this.refvar.name)) {
        // Find the node in the result tree which holds the value
        // of this key
        let {prop, node} = findResultParentNode(root['@id'], key)
        node[prop] = binding[key].value
      }
    })
    return Object.values(result) as Array<object>
  }
  toSparql(): SparqlSelect {
    let select = new SparqlSelect()
    select.pattern.addTriples(this.triples)
    return select
  }

  static make(struct: object): RootQueryPattern {
    let pattern = new RootQueryPattern(struct)
    pattern.parseOut()
    return pattern  
  }
}

/*
export class QueryPatternOld {
  subject: TripleNode
  triples: Array<Triple> = []
  related: Record<string, QueryPattern> = {}

  private addTriple(sub: TripleNode, pred: TripleNode, obj: TripleNode): QueryPattern {
    this.triples.push(new Triple(sub, pred, obj))
    return this
  }

  private parseOut() {
    Object.keys(this.struct).forEach(key => {
      if ("@context" == key || "@id" == key) {
        // ignore for now, we assume context is globally set      
        return
      }
      let value = this.struct[key]
      let obj: TripleNode | null = null
      let pred: TripleNode | null = null
      if ("@type" == key) {
        pred = new QuerySubject(rdfjs.named("rdf:type").value)
        obj = value ? new QuerySubject(rdfjs.named(value).value) : Var.make()
      }
      else {
        // need to deal with operators here eventually
        pred = new QuerySubject(rdfjs.named(key).value)
        if (value == null) {
          obj = Var.make()
        }
        else if (typeof value == "object") {
          obj = Var.make()
          let nestedPattern = new QueryPattern(value)
          nestedPattern.subject = obj
          nestedPattern.parseOut()
          this.related[pred.iri] = nestedPattern          
        }
        else
          obj = rdfjs.literal(value)
      }
      this.addTriple(this.subject, pred, obj)
    })
    return this
  }

  bindingsToMatch(bindings: object): object {
    let result = {}
    if (this.subject instanceof QuerySubject) {
      result['@id'] = this.subject.iri
    }
    else { // var 
      result['@id'] = bindings[(this.subject as Var).name].value
    }
    this.triples.forEach(t => {
      if (!nodeEquals(t.sub, this.subject)) {
        throw new Error("Unexpected triple with different subject: " + t.sub)
      }
      let predicateIri = (t.pred as QuerySubject).iri
      let nestedPattern = this.related[predicateIri]
      let propname = fdr.resolver.inverse().resolve(predicateIri)
      let propvalue 
      if (t.obj instanceof Var) {
        if (nestedPattern) {
          propvalue = nestedPattern.bindingsToMatch(bindings)
        }
        else {
          propvalue = bindings[t.obj.name] 
          if (propvalue.type == "literal")
            propvalue = propvalue.value
          else if (propvalue.type == "uri")
            propvalue = fdr.resolver.inverse().resolve(propvalue.value)
        }
      }
      else if (t.obj instanceof QuerySubject)
        propvalue = fdr.resolver.inverse().resolve((t.obj as QuerySubject).iri)
      else 
        propvalue = (t.obj as Literal).value
      result[propname] = propvalue
    })

    return result
  }

  private constructor(readonly struct: object) { 
    this.subject = this.struct.hasOwnProperty('@id') && this.struct['@id']
    ? new QuerySubject(rdfjs.named(this.struct['@id']).value)
    : Var.make()
  }

  static make(struct: object): QueryPattern {
    let pattern = new QueryPattern(struct)
    pattern.parseOut()
    return pattern  
  }


  get allTriples(): Array<Triple> {
    let result = [...this.triples]
    Object.values(this.related).forEach(nested => {
      result.push.apply(result, nested.allTriples)
    })
    return result
  }

  toSparql(): string {
    let query = "select * where { \n "
    this.allTriples.forEach(t => {
      query += t.toString() + "\n"
    })
    query += "}"
    return query
  }
}
*/