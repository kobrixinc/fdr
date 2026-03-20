import { Literal, NamedNode } from "@rdfjs/types"
import { rdfjs } from "./fdr.js"

export class Var {
  constructor(readonly name: string) { }

  private static sequence: number = 0
  /**
   * 
   * @returns Newly generated variables look like "?v_nnn" where
   * nnn is a sequence starting from 1.
   */
  static make(): Var { 
    return new Var("v_" + (++Var.sequence))
  }

  equals(other: any): boolean {
    return other instanceof Var && other.name == this.name
  }

  toString(): string {
    return "?" + this.name
  }
}

export class QuerySubject {
  constructor(readonly iri: string) { }
  equals(other: any): boolean {
    return other instanceof QuerySubject && other.iri == this.iri
  }

  toString(): string {
    return "<" + this.iri + ">"
  }

  static make(shortname: string): QuerySubject {
    return new QuerySubject(rdfjs.named(shortname).value)
  }
}

export const path = {
  predicate(predicate: NamedNode): PathElement {
    return new PathElement(new QuerySubject(predicate.value))
  },
  sequence(...elements: PathElement[]): PathSequence {
    return new PathSequence(...elements)
  },
  oneOf(...alternatives: PathExpression[]): AlternativePaths {
    return new AlternativePaths(...alternatives) 
  },
  inverse(path: PathExpression): InversePath {
    return new InversePath(path)
  },
  optional(path: PathExpression): OptionalPath {
    return new OptionalPath(path)
  },
  star(path: PathExpression): ZeroOrMorePath {
    return new ZeroOrMorePath(path)
  },
  plus(path: PathExpression): OneOrMorePath {
    return new OneOrMorePath(path)
  }
}

export interface PathExpression { 
  equals(other: any): boolean
  toString(): string
}

class PathElement implements PathExpression {
  constructor(readonly predicate: Node) {  }

  equals(other: any): boolean {
    return other instanceof PathElement &&
           nodeEquals(this.predicate, other.predicate)
  }
  toString(): string {
    return nodeToString(this.predicate)
  }
}

class PathSequence implements PathExpression {
  elements: Array<PathElement> = []  
  constructor(...elements: PathElement[]) { 
    this.elements = elements
  }

  equals(other: any): boolean {
    if (!(other instanceof PathSequence) ||
        other.elements.length != this.elements.length)
      return false
    for (let i = 0; i < this.elements.length; i++) {
      if (!this.elements[i].equals(other.elements[i]))
        return false
    }
    return true
  }

  toString(): string {
    return this.elements.map(e => e.toString()).join(" / ")
  }
}

class AlternativePaths implements PathExpression {
  alternatives: Array<PathExpression>
  constructor(...alternatives: PathExpression[]) {  this.alternatives = alternatives}

  equals(other: any): boolean {
    if (!(other instanceof AlternativePaths) ||
        other.alternatives.length != this.alternatives.length)
      return false
    for (let i = 0; i < this.alternatives.length; i++) {
      if (other.alternatives.indexOf(this.alternatives[i]) < 0)
        return false
    }
    return true
  }
  
  toString(): string {
    return this.alternatives.map(a => a.toString()).join(" | ")
  }
}

class InversePath implements PathExpression {
  constructor(readonly path: PathExpression) {  }

  equals(other: any): boolean {
    return other instanceof InversePath &&
           this.path.equals(other.path)
  }

  toString(): string {
    return "^(" + this.path.toString() + ")"
  }
}

class OptionalPath implements PathExpression {
  constructor(readonly path: PathExpression) {  }
  equals(other: any): boolean {
    return other instanceof OptionalPath &&
           this.path.equals(other.path)
  }

  toString(): string {
    return "(" + this.path.toString() + ")?"
  }
}

class ZeroOrMorePath implements PathExpression {
  constructor(readonly path: PathExpression) {  }
  equals(other: any): boolean {
    return other instanceof ZeroOrMorePath &&
           this.path.equals(other.path)
  }

  toString(): string {
    return "(" + this.path.toString() + ")*"
  } 
}

class OneOrMorePath implements PathExpression {
  constructor(readonly path: PathExpression) {  }
  equals(other: any): boolean {
    return other instanceof OneOrMorePath &&
           this.path.equals(other.path)
  }

  toString(): string {
    return "(" + this.path.toString() + ")+"
  }
}

type Node = QuerySubject | Var | Literal

function nodeEquals(x: Node, y: Node): boolean {
  if (x instanceof Var) return (x as Var).equals(y)
  else if (x instanceof QuerySubject) return (x as QuerySubject).equals(y)
  else return x.value == (y as Literal).value
}

/**
 * For testing purpose, like nodeEquals, but will return true also
 * if both are falsy (i.e. undefined or null) or if both are variables
 * possibly with different names
 */
function nodeSimilar(x: Node, y: Node): boolean {
  if (!x) return !y
  else if (x instanceof Var) return (y instanceof Var)
  else if (x instanceof QuerySubject) return (x as QuerySubject).equals(y)
  else return x.value == (y as Literal).value
}

function nodeToString(x: Node): string {
  if (x instanceof Var)
    return x.toString()
  else if (x instanceof QuerySubject)
    return x.toString()
  else
    return '"' + x.value + '"'
}

export class Triple {
  constructor(readonly sub: Node, 
              readonly pred: PathExpression, 
              readonly obj: Node)
  {}

  like(other: Triple): boolean {
    return nodeSimilar(this.sub, other.sub) &&
           this.pred.equals(other.pred) &&
           nodeSimilar(this.obj, other.obj)
  }

  equals(other: any): boolean {
    return other instanceof Triple &&
          nodeEquals(this.sub, other.sub) &&
          this.pred.equals(other.pred) &&
          nodeEquals(this.obj, other.obj)
  }

  /**
   * Return a string suitable for Turtle/SPARQL output.
   */
  toString(): string {
    return nodeToString(this.sub) + " " + 
           this.pred.toString() + " " + 
           nodeToString(this.obj) + " ."
  }
}


class SparqlSelection {
  variables: Array<Var> = []

  toString(): string {
    if (this.variables.length == 0)
      return "*"
    else
      return this.variables.map(v => v.toString()).join(" ")
  }
}

class SparqlPattern { 
  triples: Array<Triple> = []

  toString(): string {
    return this.triples.map(t => t.toString()).join("\n")
  }
}

class SparqlFilter {
  toString(): string {
    return ""
  }
}

export class SparqlSelect {
  selection: SparqlSelection = new SparqlSelection()
  pattern: SparqlPattern = new SparqlPattern()
  filter: SparqlFilter = new SparqlFilter()

  toString(): string {
    return `
      SELECT ${this.selection.toString()} WHERE { 
        ${this.pattern.toString()}
        ${this.filter.toString()}
      }
    `
  }
}

const sparql = {
  select(): SparqlSelect {
    return new SparqlSelect()
  }
}