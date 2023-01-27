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
  constructor(readonly quad: Quad) { 
    super(quad)
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
  constructor(readonly name: string, readonly value: Subject[] | LiteralValue[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return this.value.map((added : LiteralValue|Subject) => {
      const pvi = new PropertyValueIdentifier(subject.id, this.name, added) 
      const newQuad = pvi.toQuad() 
      return new QuadAdded(newQuad)
    }) 
  }
}

export class PropertyRemoved implements PropertyChange {
  constructor(readonly name: string, readonly value: Subject[] | LiteralValue[], readonly annotation?: any[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return (this.value as (Subject|LiteralValue)[]).map(added => {
      const quad = new PropertyValueIdentifier(subject.id, this.name, added).toQuad()
      return new QuadRemoved(quad)
    })
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
  toQuadChanges(subject: Subject): Array<QuadChange> {
    const result = [] as QuadChange[]
    
    for (const oneOldValue of this.oldvalue) {
      const quad = new PropertyValueIdentifier(subject.id, this.name, oneOldValue).toQuad()
      result.push(new QuadRemoved(quad))
    }   
   
    for (const i in this.newvalue)
    {
      const oneNewValue = this.newvalue[i] as (Subject|LiteralValue)
      const quad = new PropertyValueIdentifier(subject.id, this.name, oneNewValue).toQuad()
      const change = new QuadAdded(quad)
      result.push(change)
    }
            
    return result
  }              
}
