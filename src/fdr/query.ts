import { Dataset, Literal, NamedNode, Quad, Term } from "@rdfjs/types"
import { fdr, rdfjs } from "./fdr.js"
import { TripleNode, PathExpression, QuerySubject, SparqlSelect, Triple, Var, nodeEquals, path, SparqlPattern, SparqlConjunction, SparqlFilter } from "./sparql.js"

/*
1. Reference to a different node with "@id": "@refvar" (same instance) [IMPLEMENTED, NOT TESTED]
2. Handling of arrays of literals in query and in results 
    As per query4, simple version with just [] works. Needs to test with conditions on the values, operators etc.
3. Hanlding of arrays of objects in query and in results
    as per query5 basic cases seem to work
4. Operators and filters for literals 
5. Two syntaxes for operators must be supported: 
     (a) modified property names
     (b) literal specs via directives, as objects
6. Recursivity:
   (a) simple linked list (DONE)
   (b) full object model with planets and humans and starships (NEED TO TEST)
7. Is there a more elegant way to specify type than:
     "@type": {"@id" : "voc:Human"},
   something like "@type": "voc:Human", special treatment for a property to be interpreted as an IRI instead of literal      
8. Directives
    (a) @fetchAll true or false to get all properties, not only those mentioned
    (b)    
*/

export enum Directive {
  multipleValues
}

export const DIRECTIVES = {
  [Directive.multipleValues]: {
    "autoarray": true,
    "overwrite": false,
    "reject": false
  }
}

function sortOfsafeStringify(obj: any) {
  return JSON.stringify(Object.assign({}, obj), null, 2)  
}

export function safeStringify(obj: any, maxDepth: number = 4): string {
  const seen = new WeakSet();

  function grow(value: any, currentDepth: number): any {
    // 1. Cut off if we exceed max depth
    if (currentDepth > maxDepth) {
      return "[Max Depth Reached]";
    }

    // 2. Handle primitives and nulls
    if (typeof value !== "object" || value === null) {
      return value;
    }

    // 3. Catch circular references
    if (seen.has(value)) {
      return "[Circular]";
    }

    // Add object to seen tracking
    seen.add(value);

    // 4. Handle Arrays recursively
    if (Array.isArray(value)) {
      return value.map(item => grow(item, currentDepth + 1));
    }

    // 5. Handle Objects recursively
    const serializedObj: Record<string, any> = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        serializedObj[key] = grow(value[key], currentDepth + 1);
      }
    }
    
    // Remove object from tracking so it can be safely used in sibling branches
    seen.delete(value);
    return serializedObj;
  }

  return JSON.stringify(grow(obj, 0), null, 2);
}
class QueryPath {
  constructor(readonly variable: Var, 
              readonly path: PathExpression,
              readonly constraints: Array<any> = []) { }
}

// function sparqlFromPaths(pathList: Array<QueryPath>): SparqlSelect { 
//   let sparql = new SparqlSelect()
//   let root = new Var("root")
//   for (const p of pathList) {
//     sparql.selection.variables.push(p.variable)
//     sparql.pattern.triples.push(new Triple(
//       root,
//       p.path,
//       p.variable
//     ))
//     for (const c of p.constraints) {
//       // TODO
//     }
//     // All properties
//     sparql.pattern.triples.push(new Triple(
//       p.variable,
//       new Var(p.variable.name + "_prop"),
//       new Var(p.variable.name + "_val")
//     ))
//   }
//   return sparql
// }

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
  required = "!",
  optional = "?",
  any = "any"
}

function isOperator(val: string): val is Operator {
  return Object.values(Operator).includes(val as Operator);
}

function isFilteringOperator(val: string): val is Operator {
  return isOperator(val) && 
        ![Operator.required, Operator.optional, Operator.any].includes(val as Operator)
}

abstract class QueryNode {
  parent: QueryPattern | null = null
  constructor(parent: QueryPattern | null = null) { 
    this.parent = parent
  }

  abstract get tripleNode(): TripleNode
}

class LiteralObject extends QueryNode {
  variable: Var | null = null

  constructor(readonly operator: Operator, 
              readonly value: string | null = null, 
              readonly datatype: string = "xsd:string", 
              readonly language: string = "@eng") { 
      super(null)
  }

  queryContext(parent: QueryPattern, variable: Var): LiteralObject {
    this.parent = parent
    this.variable = variable
    return this
  }

  get tripleNode(): TripleNode {
    return this.variable!
  }
}

interface NodeVariableProvider {
  get node(): QueryNode
  get refvar(): Var
  property(prop: string): NodeVariableProvider
}

/**
 * A path cycle is a chain of properties starting at some need in the query tree
 * and ending at another node which recursively call out (via the @pattern directive)
 * a repeat of the chain starting from the first node. 
 * 
 * This translate to a (x/y/z)+ path expression where at least one occurrence is expected
 * but there maybe more. To handle more than one occurrence we have to generate fresh variables
 * to represent additional cycles of the pattern.
 * 
 * The very first instantiation of the path needs to be anchored at the root of pattern match (e.g.
 * the head of a recursive list) and as such it gets its own copy of all triples using the 
 * originally assigne variables.
 * 
 * Then to capture repeated cycles, for every QueryPattern node on the path, we need fresh variable representing it 
 * and all its property values.  
 * 
 * These fresh variable are kept in a separate property map that we keep in the PathCycle so we can 
 * reconstruct the pattern from the SPARQL result bindings.
 */

class PatternNodeVariables implements NodeVariableProvider {
  propMap: Record<string, PatternNodeVariables> = {}
  constructor(readonly node :QueryNode, readonly refvar: Var) { }

  property(prop: string): PatternNodeVariables {
    return this.propMap[prop]
  }
}

class QueryNodeVariables implements NodeVariableProvider {
  constructor(readonly node :QueryNode) { }
  get refvar(): Var { 
    if (this.node instanceof LiteralObject)
      return (this.node as LiteralObject).variable!
    else
      return (this.node as QueryPattern).refvar
  }
  property(prop: string): QueryNodeVariables {
    return new QueryNodeVariables((this.node as QueryPattern).propMap[prop])
  }
}

class PathCycle {
  firstOccurrenceVariables = {} // prop -> PatternNodeVariables
  startFresh: PatternNodeVariables 
  cycleVariables = {}  
  constructor(readonly startPattern: QueryPattern, 
              readonly endPattern: QueryPattern, 
              readonly path: Array<string>) {
    // path.forEach(p => this.firstOccurrenceVariables[p] = varnameFromProp(p))
    // path.forEach(p => this.cycleVariables[p] = varnameFromProp(p))            
    this.startFresh  =  new PatternNodeVariables(this.startPattern, this.startPattern.refVar)
  }

  get triples(): SparqlConjunction {
    let triples: SparqlConjunction = new SparqlConjunction()
    let thepath = path.plus(path.sequence(...this.path.map(p => path.predicate(rdfjs.named(p)))))
    triples.add(new Triple(this.startPattern.subject, thepath, this.endPattern.subject))

    let subjectPattern = this.startPattern
    let subject = subjectPattern.subject
    for (const p of this.path) {
      let object = Var.make(varnameFromProp(p))  //Var.make(this.firstOccurrenceVariables[p])
      let objectPattern = subjectPattern.propMap[p] as QueryPattern      
      triples.add(new Triple(subject, path.predicate(rdfjs.named(p)), object))
      let triplesAs = objectPattern.triplesAs(object, true)
      triples.add(triplesAs.sparql)
      this.firstOccurrenceVariables[p] = triplesAs.freshvars!
      subjectPattern = objectPattern
      subject = object
    }

    subjectPattern = this.startPattern // we are doing a recursion now, starting node same as startPattern
    subject = this.endPattern.subject // however, the variable has to be from endPattern node capturing the new occurrence
    let triplesAs = subjectPattern.triplesAs(subject, true)
    triples.add(triplesAs.sparql)
    this.startFresh = triplesAs.freshvars!
    for (const p of this.path) {
      let object =  Var.make(varnameFromProp(p))//Var.make(this.cycleVariables[p])
      let objectPattern = subjectPattern.propMap[p] as QueryPattern  
      triples.add(new Triple(subject, path.predicate(rdfjs.named(p)), object))
      let triplesAs = objectPattern.triplesAs(object, true)
      triples.add(triplesAs.sparql)
      this.cycleVariables[p] = triplesAs.freshvars!
      subjectPattern = objectPattern
      subject = object
    }
    return triples
  }
}

export class QueryPattern extends QueryNode {
  // Used both as a SPARQL variable representing this pattern and for recursive references
  // can be user provided and it has to be unique for the entire pattern or auto-generated.
  refvar: Var = new Var("")
  iri: string | null = null // known @id, if provided
  patternName: string | null = null
  pathCycle : PathCycle | null = null; 
  propMap: Record<string, QueryNode> = {}
  multiplicity: Record<string, boolean> = {} // which properties are to be multi-valued in the result
  required:  Record<string, boolean> = {} // which properties are required as part of the result
  fetchAll: boolean = false

  fetchAllPropVar : Var | null = null
  fetchAllValueVar : Var | null = null

  // State during SPARQL generation
  sparqlFilters: Array<string> = []

  directive(d: Directive): any {
    let options = DIRECTIVES[d]
    for (const [key, value] of Object.entries(options)) {
      if (value) return key
    }  
    return undefined
  }

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

  isPattern(propName: string): boolean {
    if (typeof this.propMap[propName] == "undefined") {
      if (this.patternName)
        return (this.root().patternReferences[this.patternName] as QueryPattern).isPattern(propName)
      else
        return false
    }
    else
      return this.propMap[propName] instanceof QueryPattern
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

  protected findPathCycle(patternName: string): PathCycle | null {
    let chain: Array<QueryPattern> = [this]
    let par = this.parent
    while (par && par.refVar.name != patternName) {
      chain.push(par)
      par = par.parent
    }
    if (!par) {
      return null
    }
    else {
      // We generate a path expression for the variable chain
      chain.push(par)
      let propArray: Array<string> = []
      for (const p of chain) {
        if (!p.parent) continue
        let propname = p.parent.propName(p.refVar.name)
        if (!propname)
          throw new Error("Unable to find property " + p.refVar.name + 
                  " in " + safeStringify(p.parent))
        propArray.unshift(propname)
        this.root().propertyInPathExpression(p.parent, propname)
      }      
      return new PathCycle(par, this, propArray) 
    }      
  }

  protected resolvePatternReferences() {
    if (this.patternName) {
      this.pathCycle = this.findPathCycle(this.patternName)
      if (!this.pathCycle) {
        // here we need to create a clone of the pattern referenced. However,
        // we may have not yet encountered it. TBD: need a second pass over all patterns to
        // make fresh copies whenever there is uncyclical reference to another pattern
      }    
    }
    else {
      Object.keys(this.propMap).forEach(key => {
        let value = this.propMap[key]
        if (value instanceof QueryPattern) {
          value.resolvePatternReferences()
        }
      })
    }
  }

  protected parseOut(): QueryPattern {
    this.refVar = Var.make(this.struct["@ref"])
    Object.keys(this.struct).forEach(fullkey => {
      let key = fullkey
      let keyParts = fullkey.split(/\s+/)
      if (keyParts.length > 1)
        key = keyParts[0]

      let value = this.struct[fullkey]

      if ("@ref" == key) {
        return
      }
      else if ("@context" == key) {
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
      else if ("@pattern" == key) {
        this.patternName = value
        return
      }
      else if ("@type" == key) {
        key = "rdf:type"
        if (typeof value == "string") {
          value = {"@id": value}
        }
      }
      else if ("@fetch" == key) {
        this.fetchAll = true
        return
      }

      let isoptional = keyParts.find(part => part == Operator.required || part == Operator.optional)
      this.required[key] = ("?" != isoptional)
      // let operator = keyParts.find(part => isFilteringOperator(part)) as Operator || Operator.any

      if (Array.isArray(value)) {
        this.multiplicity[key] = true
        if (value.length == 0) {
          // assume an array of Literals
          this.literalProperty(key, Operator.any)
          return
        }
        else if (value.length == 1) {
          value = value[0]
          if (Array.isArray(value)) {
            throw new Error("Cannot interpret an array within an array in a query pattern")
          }
          // TODO: might need to further check value here, if it's a literal, not clear
          // what it means, the intent is to have an object pattern as the single value
          // in an array. A literal might make sense in conjunction with a non-equality operator,
          // e.g. "x >" : [100]   for all x > 100
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

  get refVar(): Var { return this.refvar }

  constructor(readonly parent: QueryPattern | null, readonly struct: object) { 
    super(parent)
  }
  
  get tripleNode(): TripleNode {
    return this.subject
  }

  get subject(): QuerySubject | Var {
    if (this.iri) {
      if (this.iri.startsWith("@"))
        return Var.make(this.iri.substring(1))
      else
        return QuerySubject.make(this.iri)
    }
    else {
      return this.refvar
    }
  }

  get isCycleEnd(): boolean {
    return (this.pathCycle != null && this.pathCycle.endPattern == this)
  }

  get pathExpressionTriples(): SparqlConjunction {
    let result: SparqlConjunction = new SparqlConjunction()
    if (this.pathCycle) {
      result.add(this.pathCycle.triples)
    }    
    else for (const child of Object.values(this.propMap).filter(v => v instanceof QueryPattern)) {
      result.add((child as QueryPattern).pathExpressionTriples)
    }
    return result
  }

  get triples(): SparqlPattern {
    return this.triplesAs(this.subject ).sparql
  }

  triplesAs(subject: TripleNode, make_fresh_vars: boolean = false): 
      {sparql: SparqlPattern, freshvars: PatternNodeVariables | undefined} {
    let result: SparqlConjunction = new SparqlConjunction()        
    let freshvars: PatternNodeVariables | undefined = undefined
    if (make_fresh_vars) {
      freshvars = new PatternNodeVariables(this, subject as Var)
    }  
    Object.keys(this.propMap)
      .filter(k => k != "@id" && !this.root().isPropertyInPathExression(this, k))
      .forEach(key => {      
        let v = this.propMap[key]
        let pred = path.predicate(rdfjs.named(key))
        let triples: SparqlPattern[]
        if (v instanceof LiteralObject) {
          let thevar = v.variable
          if (make_fresh_vars) {
            thevar = Var.make(varnameFromProp(key))
            freshvars!.propMap[key] = new PatternNodeVariables(v, thevar)
          }
          if (v.operator == Operator.equals) {
            triples = [new Triple(subject, 
                                  pred, 
                                  rdfjs.literal(v.value!, v.language))]
          }
          else {
            triples = [new Triple(subject, pred, thevar!)]
            if (isFilteringOperator(v.operator)) {
              let quoted = v.value
              if (typeof v.value == "string")
                quoted = "'" + v.value + "'"
              this.sparqlFilters.push(thevar + " " + v.operator + " " + quoted)
            }
          }
        }
        else {
          let object = (v as QueryPattern).subject
          triples = [new Triple(subject, 
            pred, 
            object)]
          let nestedTriples: SparqlPattern
          if (make_fresh_vars && object instanceof Var) {
            object = Var.make(varnameFromProp(key))            
            let triplesAs = (v as QueryPattern).triplesAs(object, true)
            freshvars!.propMap[key] = triplesAs.freshvars!
            nestedTriples = triplesAs.sparql
          }         
          else
            nestedTriples = (v as QueryPattern).triples
          if (!nestedTriples.isEmpty())
            triples.push(nestedTriples)
        }
        result.add(new SparqlConjunction(!this.required[key]).add(...triples))
    })
    if (this.fetchAll) {
      this.fetchAllPropVar = Var.make(varnameFromProp("fdr:allprops"))
      this.fetchAllValueVar = Var.make(varnameFromProp("fdr:allvalues"))
      result.add(new Triple(subject, this.fetchAllPropVar, this.fetchAllValueVar))
    }
    return {sparql: result, freshvars: freshvars}  
  }

  iriFromBinding(binding: object, refvar: Var = this.refVar): string {
    if (this.iri) {
      if (!this.iri.startsWith("@"))
        return this.iri
      else {
        let linked = this.root().patternReferences[this.iri.substring(1)] as QueryPattern
        // assuming we've detected and errored out circular variable references
        return linked.iriFromBinding(binding)      
      }
    }
    else
      return binding[refvar.name].value
  }

  root(): RootQueryPattern { 
    return (this.parent == null ? this : this.parent.root()) as RootQueryPattern
  }

  find(predicate: (pattern: QueryPattern) => boolean): QueryPattern | null {
    if (predicate(this)) return this
    else {
      for (let v of Object.values(this.propMap).filter(v => v instanceof QueryPattern)) {
        let found = (v as QueryPattern).find(predicate)
        if (found) return found
      }
      return null
    }
  }
}

/**
 * The root pattern contains global maps b/w variables and sub-patterns, 
 * the top-level paths and ultimately the query generation.
 */
export class RootQueryPattern extends QueryPattern {

  patternReferences: Record<string, QueryPattern | LiteralObject>
  // TODO: maybe a similarly global to collect all paths

  // State during SPARQL generation
  propertiesInPaths = new Set<string>() // properties used in paths, and should be ignored otherwise

  isPropertyInPathExression(pattern: QueryPattern, propName: string): boolean {
    return this.propertiesInPaths.has(pattern.refVar.name + "->" + propName)
  }

  propertyInPathExpression(from: QueryPattern, propName: string): void {
    this.propertiesInPaths.add(from.refVar.name + "->" + propName)
  }

  /**
   * 
   * @param struct A JSON-LD pattern structure. 
   */
  constructor(readonly struct: object) { 
    super(null, struct)
    this.patternReferences = {} 
  }
  
  /**
   * Return true is the pattern can occur multiple times within its parent property or false otherwise. 
   */
  isMultiple(pattern: QueryPattern): boolean {
    if (!pattern.parent) return false
    let prop = pattern.parent.propName(pattern.refVar.name)  
    if (!prop) throw new Error("Unable to find property to " + pattern.refVar.name + 
                                " in " + pattern.parent.refVar.name)
    return pattern.parent.multiplicity[prop]
  }

  fromBindings(bindings: Array<object>): Array<object> {
    
    let self = this

    // @id -> object for top-level (i.e. "root") entities returned
    let result = {}  

    // root ID -> (var -> object) for nested entities, lets us build the resulting structure 
    // bottom up by progressively connecting entities with their parents and properties.    
    let resultStructure = { } 

    // flat @id -> object map so we make sure @id always points to a single object instance
    // not 100% sure this is right since a node in the graph can be simultaneously part
    // of multiple result structures with different requested properties. For FDR itself
    // we want a single instance, but if this is to be used as a query language in other contexts,
    // requirements may be different
    //
    // A way out of it, conceptually, is to say that fetching requirements (i.e. which properties to
    // populate) are to be interpreted as a minimal requirements, i.e. at least the properties required
    // must be present, but we may have more. 
    let allnodes = {}

    function ensureNode(atid: string): object {
      return allnodes[atid] = allnodes[atid] || { '@id': atid }  
    }

    function ensureRootNode(binding: object): object {
      let rootId
      if (self.iri) {
        if (self.iri.startsWith("@"))
          rootId = binding[self.iri.substring(1)].value
        else
          rootId = self.iri 
      }
      else
        rootId = binding[self.refVar.name].value
      let nodes = resultStructure[rootId] = resultStructure[rootId] || {}
      return nodes[self.refVar.name] = 
             result[rootId] = 
             ensureNode(rootId)     
    }

    function connectPathOccurrence(cycle: PathCycle, binding: object) {
      let currentNode = ensureNode(cycle.startPattern.iriFromBinding(binding))
      let currentPattern = cycle.startPattern
      for (let p of cycle.path) {
        // let next = ensureNode(binding[cycle.firstOccurrenceVariables[p].refvar.name].value)
        let next: PatternNodeVariables = cycle.firstOccurrenceVariables[p]
        let object = connectPattern(next.node as QueryPattern, next, binding) // cycle.startPattern, cycle.startPattern.property(p), binding)
        assignValue(p, currentNode, currentPattern, object)
        currentNode = next
        currentPattern = next.node as QueryPattern
      }

      currentNode = ensureNode(cycle.endPattern.iriFromBinding(binding))
      currentPattern = cycle.endPattern
      for (let p of cycle.path) {
        // let next = ensureNode(binding[cycle.cycleVariables[p].refvar.name].value)
        // assignValue(p, currentNode, cycle.endPattern, next)
        // currentNode = next
        let next: PatternNodeVariables = cycle.cycleVariables[p]
        let object = connectPattern(next.node as QueryPattern, next, binding) // cycle.startPattern, cycle.startPattern.property(p), binding)
        assignValue(p, currentNode, currentPattern, object)
        currentNode = object
        currentPattern = next.node as QueryPattern
      }
  
    }

    function connectPathCycles(pattern: QueryPattern, binding: object){ 
      if (pattern.isCycleEnd) 
        connectPathOccurrence(pattern.pathCycle!, binding)
      for (const p of Object.keys(pattern.propMap)) {
        let atP = pattern.propMap[p]
        if (atP instanceof QueryPattern) {
          connectPathCycles(atP as QueryPattern, binding)
        }        
      }
    }

    function connectPattern(pattern: QueryPattern, variables: NodeVariableProvider, binding: object): object {
      let node = pattern.subject instanceof Var
        ? ensureNode(pattern.iriFromBinding(binding, variables.refvar))
        : ensureNode((pattern.subject as QuerySubject).iri)
      for (const p of Object.keys(pattern.propMap)) {
        if (self.isPropertyInPathExression(pattern, p)) continue       
        let atP = pattern.propMap[p]
        if (atP instanceof QueryPattern) {
          let subPattern = atP as QueryPattern
          if (subPattern.isCycleEnd) 
            connectPathOccurrence(subPattern.pathCycle!, binding)
          else {
            let nestedNode = connectPattern(subPattern, variables.property(p), binding)
            assignValue(p, node, pattern, nestedNode)
          }
        }
        else {
          let literal = atP as LiteralObject
          let value = literal.operator == Operator.equals 
                        ? literal.value 
                        : binding[variables.property(p).refvar.name]
          assignValue(p, node, pattern, value)
        }
      }
      if (pattern.fetchAll) {
        let propname = binding[pattern.fetchAllPropVar!.name]
        let propvalue = binding[pattern.fetchAllValueVar!.name]
        let shortPropname = fdr.resolver.prefixResolver.inverse().resolve(propname.value)
        // let value =  (propvalue.type == 'uri') ? ensureNode(propvalue.value) : propvalue
        assignValue(shortPropname, node, pattern, propvalue)
      }
      return node
    }

    /**
     * This function has to do the right by overwriting an existing value
     * or turning it into an array or adding to an existing array. Based
     * on current directives and configuration as interfaced through the pattern instance
     * 
     * @param prop The property name, contextualized/prefixed
     * @param node The node holding that property
     * @param pattern The pattern that the node matched
     * @param value The value to assign
     */
    function assignValue(prop, node, pattern, value): object {    
      
      if (typeof value === "undefined") return node

      if (typeof value == "object") {
        if ("literal" == value['type'])
          value = value.value
        else if ("uri" == value['type'])
          value = ensureNode(value.value)
      } 
      if (pattern.multiplicity[prop]) {
        // we always want an array here
        addArrayElement(prop, node, pattern, value)
      }
      else {
        if (node.hasOwnProperty(prop)) {
          switch (pattern.directive(Directive.multipleValues)) {
            case "autoarray":
              addArrayElement(prop, node, pattern, value)
              break
            case "overwrite":
              node[prop] = value
              break
            default:
              throw new Error(`Unexpected multiple values for ${prop} in node ${safeStringify(node)}`)
          }
        }
        else
          node[prop] = value
      }
      return node
    }
    
    function addArrayElement(prop, node, pattern, value) {
      // Arrays (multiple values for the same properties) are sets
      // not lists, so both literal and objects have to be added only once.
      let A = node[prop] = node[prop] || []
      if (!Array.isArray(A)) {
        A = [A]
      }
      // We don't want to turn node[prop] into an array unless there is
      // another **different** value to add.
      function pushToArray(x) {
        A.push(x)
        node[prop] = A
      }

      if (pattern.isPattern(prop)) {
        if (!A.find(e => e['@id'] == value['@id']))
          pushToArray(ensureNode(value['@id']))
      }
      else {
        // if (!A.find(l => l.type == value.type && l.value == value.value))
        if (!A.find(x => x == value))
          pushToArray(value)
      }
    }

    bindings.forEach(binding => {      
      let root = ensureRootNode(binding)
      connectPattern(self, new QueryNodeVariables(this), binding)
      connectPathCycles(self, binding)
    })
    // console.log(safeStringify(resultStructure))
    let resultArray = Object.values(result) as Array<object>
    console.log(safeStringify(resultArray))
    return resultArray
  }
  toSparql(): SparqlSelect {
    let select = new SparqlSelect()
    select.pattern.add(this.triples)
    select.pattern.add(this.pathExpressionTriples)
    select.filter = new SparqlFilter(this.sparqlFilters)
    return select
  }

  static make(struct: object): RootQueryPattern {
    let pattern = new RootQueryPattern(struct)
    pattern.parseOut()
    pattern.resolvePatternReferences()
    return pattern  
  }
}