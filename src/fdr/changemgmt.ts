import { Literal, Quad } from "@rdfjs/types"
import { Subject } from "./dataspecAPI.js"
import { PropertyValueIdentifier, SubjectImpl } from "./dataspec.js"

export class KBChange {
  constructor() { }
}

export class QuadChange extends KBChange {
  constructor(readonly quad: Quad) { 
    super()
  }
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
  constructor(readonly name: string, readonly value: Subject[] | Literal[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return this.value.map((added : Literal|Subject) => {
      const pvi = new PropertyValueIdentifier(subject.id, this.name, added) 
      const newQuad = pvi.toQuad() 
      return new QuadAdded(newQuad)
    }) 
  }
}

export class PropertyRemoved implements PropertyChange {
  constructor(readonly name: string, readonly value: Subject[] | Literal[], readonly annotation?: any[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    return (this.value as (Subject|Literal)[]).map(added => {
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
              readonly oldvalue: Subject[] | Literal[],
              readonly newvalue: Subject[]  | Literal[],
              readonly annotation?: any[]) {}
  toQuadChanges(subject: Subject): Array<QuadChange> {
    const result = [] as QuadChange[]

    //a bitmap marking whether a new value was present before the change
    const preexistingValues = this.newvalue.map(() => false)
    
    /*
     * Delete the old values which are not getting reinserted 
     */
    for (const oneOldValue of this.oldvalue) {
    
      const indexInNewValues = this.newvalue.findIndex(oneNewValue => {
        if (oneOldValue instanceof SubjectImpl) {
          if (oneOldValue.id == (oneNewValue as Subject).id) return true
        }
        else {
          return oneNewValue == oneOldValue
        }
      })
      
      /*
      if the value is to be reinserted, do not delete it, just mark it 
      as present
      */
      if (indexInNewValues >= 0) {
        //mark as preexisting, so the value will not be reinserted 
        preexistingValues[indexInNewValues] = true
      }
      else {
        const quad = new PropertyValueIdentifier(subject.id, this.name, oneOldValue).toQuad()
        result.push(new QuadRemoved(quad))
      }
    }
   
    for (const i in this.newvalue)
    {
      if (!preexistingValues[i]) {
        const quad = new PropertyValueIdentifier(subject.id, this.name, this.newvalue[i]).toQuad()
        const change = new QuadAdded(quad)
        result.push(change)
      }
    }
            
    return result
  }              
}
