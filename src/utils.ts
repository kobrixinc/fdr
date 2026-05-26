export function asArray<T>(arg : null|T|T[]) : T[]{
  if (arg == null) return []
  return arg instanceof Array ? arg : [arg]
}

export function asSingle<T>(arg : null|T|T[]) : T|null{
  if (arg == null) return null
  if (arg instanceof Array) 
    throw new Error(`Requested value ${arg} as a singlular value but is an array.`)
  return arg
}

export const Hashing = {

  equals(left, right) {
    if (typeof left == "object" && typeof right == "object" &&
      typeof left['equals'] == "function")
      return left.equals(right)
    else
      return left == right
  },

  hashIt(anything: any): number {
    if (anything == null || typeof anything == "undefined")
      return 0
    else if (typeof anything == "string")
      return Hashing.hashString(anything)
    else if (typeof anything == "number") 
      return anything as number
    else if (typeof anything == "boolean")
      return Hashing.hashBoolean(anything)
    else if (typeof anything == "object" && typeof anything['hashCode'] == "function")
      return anything['hashCode']()
    else {
      console.log("Unable to hash value ", anything)
      throw new Error("Unable to hash value " + anything)
    }
  },

  // Functions stolen from https://github.com/tykowale/ts-hash-map/blob/main/src/hash.ts
  hashString(value: string): number {
    let hash = 0;
  
    for (let i = 0; i < value.length; i++) {
      const charCode = value.charCodeAt(i);
      hash = (hash * 31) + charCode;
      hash |= 0;
    }
  
    return hash;
  },

  hashBoolean(value: boolean): number {
    // Java convention for boolean hash codes
    return value ? 1231 : 1237;
  }  
}