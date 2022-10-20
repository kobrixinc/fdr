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