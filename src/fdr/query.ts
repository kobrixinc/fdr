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

function safeStringify(obj: any) {
  return JSON.stringify(Object.assign({}, obj), null, 2)  
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

class PathCycle {
  firstOccurrenceVariables = {} // prop -> varname
  cycleVariables = {}  
  constructor(readonly startPattern: QueryPattern, 
              readonly endPattern: QueryPattern, 
              readonly path: Array<string>) {
    path.forEach(p => this.firstOccurrenceVariables[p] = varnameFromProp(p))
    path.forEach(p => this.cycleVariables[p] = varnameFromProp(p))            
  }

  get triples(): Array<Triple> {
    let triples: Array<Triple> = []
    let thepath = path.plus(path.sequence(...this.path.map(p => path.predicate(rdfjs.named(p)))))
    triples.push(new Triple(this.startPattern.subject, thepath, this.endPattern.subject))

    let subject = this.startPattern.subject
    for (const p of this.path) {
      let object = Var.make(this.firstOccurrenceVariables[p])
      triples.push(new Triple(subject, path.predicate(rdfjs.named(p)), object))
      subject = object
    }

    subject = this.endPattern.subject
    for (const p of this.path) {
      let object = Var.make(this.cycleVariables[p])
      triples.push(new Triple(subject, path.predicate(rdfjs.named(p)), object))
      subject = object
    }
    return triples
  }
}

export class QueryPattern {
  // Used both as a SPARQL variable representing this pattern and for recursive references
  // can be user provided and it has to be unique for the entire pattern or auto-generated.
  refvar: Var = new Var("")
  iri: string | null = null // known @id, if provided
  patternName: string | null = null
  pathCycle : PathCycle | null = null; 
  propMap: Record<string, LiteralObject | QueryPattern> = {}
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
      let operator = keyParts.find(part => isFilteringOperator(part)) as Operator || Operator.any

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

  get pathExpressionTriples(): Array<Triple> {
    let result: Array<Triple> = []
    if (this.pathCycle) {
      result.push.apply(result, this.pathCycle.triples)
    }    
    else for (const child of Object.values(this.propMap).filter(v => v instanceof QueryPattern)) {
      result.push.apply(result, (child as QueryPattern).pathExpressionTriples)
    }
    return result
  }

  get triples(): SparqlPattern {
    let result: SparqlConjunction = new SparqlConjunction()
    Object.keys(this.propMap)
      .filter(k => k != "@id" && !this.root().isPropertyInPathExression(this, k))
      .forEach(key => {      
        let v = this.propMap[key]
        let pred = path.predicate(rdfjs.named(key))
        let triples: SparqlPattern[]
        if (v instanceof LiteralObject) {
          if (v.operator == Operator.equals) {
            triples = [new Triple(this.subject, 
                                  pred, 
                                  rdfjs.literal(v.value!, v.language))]
          }
          else {
            triples = [new Triple(this.subject, pred, v.variable!)]
            if (isFilteringOperator(v.operator)) {
              let quoted = v.value
              if (typeof v.value == "string")
                quoted = "'" + v.value + "'"
              this.sparqlFilters.push(v.variable + " " + v.operator + " " + quoted)
            }
          }
        }
        else {
          triples = [new Triple(this.subject, 
                                 pred, 
                                 (v as QueryPattern).subject),
                      (v as QueryPattern).triples]
        }
        result.add(new SparqlConjunction(!this.required[key]).add(...triples))
    })
    if (this.fetchAll) {
      this.fetchAllPropVar = Var.make(varnameFromProp("fdr:allprops"))
      this.fetchAllValueVar = Var.make(varnameFromProp("fdr:allvalues"))
      result.add(new Triple(this.subject, this.fetchAllPropVar, this.fetchAllValueVar))
    }
    return result  
  }

  iriFromBinding(binding: object): string {
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
      return binding[this.refVar.name].value
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

    function connectPathOccurrence(rootId: string, cycle: PathCycle, binding: object) {
      let currentNode = ensureNode(cycle.startPattern.iriFromBinding(binding))
      for (let p of cycle.path) {
        let next = ensureNode(binding[cycle.firstOccurrenceVariables[p]].value)
        assignValue(p, currentNode, cycle.startPattern, next)
        currentNode = next
      }

      currentNode = ensureNode(cycle.endPattern.iriFromBinding(binding))
      for (let p of cycle.path) {
        let next = ensureNode(binding[cycle.cycleVariables[p]].value)
        assignValue(p, currentNode, cycle.endPattern, next)
        currentNode = next
      }
  
    }

    function connectPattern(rootId: string, pattern: QueryPattern, binding: object): object {
      let node = ensureNode(pattern.iriFromBinding(binding))
      for (const p of Object.keys(pattern.propMap)) {
        let atP = pattern.propMap[p]
        if (atP instanceof QueryPattern) {
          let subPattern = atP as QueryPattern
          if (subPattern.isCycleEnd) 
            connectPathOccurrence(rootId, subPattern.pathCycle!, binding)
          else {
            let nestedNode = connectPattern(rootId, subPattern, binding)
            assignValue(p, node, pattern, nestedNode)
          }
        }
        else {
          let literal = atP as LiteralObject
          let value = literal.operator == Operator.equals 
                        ? literal.value 
                        : binding[literal.variable!.name]
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

    // Every variable in a binding hold the value of a property of a parent entity.
    // This function finds the parent entity as a result node and as the original QueryPattern
    // and also the name of the property
    function findResultParentNode(rootId: string, varname: string, binding: object): 
                    {prop:string, node:object, pattern: QueryPattern} {
      let nodes = resultStructure[rootId] = resultStructure[rootId] || {}
      let parentPattern = self.patternReferences[varname].parent!
      let parentVar = parentPattern.refvar.name
      let parentIRI = parentPattern.iriFromBinding(binding)
      let node
      if (self.isMultiple(parentPattern)) {
        nodes[parentVar] = nodes[parentVar] || []    
        node = nodes[parentVar].find(e => e['@id'] == parentIRI)
        if (!node) {
          node = ensureNode(parentIRI)
          nodes[parentVar].push(node)
        }
      }
      else
        node = nodes[parentVar] = ensureNode(parentIRI)
      let propname = parentPattern.propName(varname)
      if (!propname) {
        console.log("Could not find property name for " + varname + " in ", parentPattern)
        throw new Error("Could not find property name for " + varname + " in " + safeStringify(parentPattern))
      }
      return {prop: propname, node: node, pattern: parentPattern}
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
      // for (let varname of Object.keys(binding).filter(k => k != this.refvar.name)) {
      //   // Find the node in the result tree which holds the value
      //   // of this key
      //   let {prop, node, pattern} = findResultParentNode(root['@id'], varname, binding)
      //   if (pattern.multiplicity[prop]) {
      //     addArrayElement(prop, node, pattern, binding[varname].value)
      //   }
      //   else
      //     node[prop] = binding[varname].value
      // }
      connectPattern(root['@id'], self, binding)
    })
    // console.log(safeStringify(resultStructure))
    let resultArray = Object.values(result) as Array<object>
    console.log(safeStringify(resultArray))
    return resultArray
  }
  toSparql(): SparqlSelect {
    let select = new SparqlSelect()
    select.pattern.add(this.triples)
    select.pattern.add(new SparqlConjunction().add(...this.pathExpressionTriples))
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