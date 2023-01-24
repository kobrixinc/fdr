import { Quad } from "@rdfjs/types"
import { Subject, SubjectId } from "./dataspecAPI.js"
import { PropertyValueIdentifier, SubjectImpl } from "./dataspec.js"
import { make, LiteralValue } from "./fdr.js"

export class KBChange {
  constructor() { }
}

export class QuadChange {
  constructor(readonly quad: Quad) { }
}

export class NoChange extends KBChange {
  constructor() { 
    super()
  }
}

export class QuadAdded extends QuadChange {
  constructor(readonly quad: Quad, readonly annotation? : object) { 
    super(quad)
    this.annotation = annotation
  }
}

export class QuadRemoved extends QuadChange {
  constructor(readonly quad: Quad) { super(quad) }
}


export interface PropertyChange {
  readonly name: string
  toQuadChanges(subject: Subject): Array<QuadChange>
}

export class PropertyAdded implements PropertyChange {
  constructor(readonly name: string, readonly value: Subject[] | LiteralValue[], readonly annotation?: any[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return (this.value as (Subject|LiteralValue)[]).map(added => {
      const pvi = new PropertyValueIdentifier(subject.id, this.name, added) 
      const newQuad = pvi.toQuad() 
      return new QuadAdded(newQuad, this.annotation)
    }) 
  }
}

export class PropertyRemoved implements PropertyChange {
  constructor(readonly name: string, readonly value: Subject[] | LiteralValue[], readonly annotation?: any[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return (this.value as (Subject|LiteralValue)[]).map(added => 
      new QuadRemoved(make.quad(
        make.named(subject.id.toString()), 
        make.named(this.name),
        added instanceof SubjectImpl ? 
          make.named(added.id) : 
          make.literal(added)
      )))
  }
}

/**
 * Replace the value of a property with a new one.
 * The replaced property could be a multi valued
 * one in which case all its old values will be
 * removed and replaced with a n
 */
export class PropertyReplaced implements PropertyChange {
  constructor(readonly name: string, 
              readonly oldvalue: Subject[] | LiteralValue[],
              readonly newvalue: Subject[]  | LiteralValue[],
              readonly annotation?: any[]) {}
  debugger
  toQuadChanges(subject: Subject): Array<QuadChange> {
    const result = [] as QuadChange[]
    
    for (const oneOldValue of this.oldvalue) {
      result.push(new QuadRemoved(make.quad(
        make.named(subject.id.toString()), 
        make.named(this.name),
        oneOldValue instanceof SubjectImpl ? 
          make.named(oneOldValue.id) : 
          make.literal(oneOldValue)
      )))
    }   
   
    for (const i in this.newvalue)
    {
      const oneNewValue = this.newvalue[i] as (Subject|LiteralValue)
      const change = new QuadAdded(make.quad(
        make.named(subject.id.toString()), 
        make.named(this.name),
        oneNewValue instanceof SubjectImpl ? 
          make.named(oneNewValue.id) : 
          make.literal(oneNewValue)
      ), this.annotation && this.annotation[i])
      result.push(change)
    }
            
    return result
  }              
}
