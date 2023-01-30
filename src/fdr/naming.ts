
/**
 * Implements some name resolution mechanism. Typical 
 * ways to resolve a name is through aliasing or expanding
 * based on a prefix, but this interface mandates no constraints
 * except that the resolution should either produce a new name or
 * return its input parameter as is. 
 */
export interface NameResolver {
  resolve(name: string): string
  inverse() : NameResolver
}

class AliasResolver implements NameResolver {

  private dict: Map<string, string>

  constructor(aliases: object) {
    this.dict = new Map<string, string>(Object.entries(aliases))
  }
  inverse(): NameResolver {
    const inverseMap = new Map<string, string>
    for (const entry of this.dict){
      inverseMap.set(entry[1], entry[0])
    }
    return new AliasResolver(inverseMap)
  }

  withAliases(moreAliases: object): AliasResolver {
    Object.keys(moreAliases)
      .forEach(key => {
        this.dict.set(key, moreAliases[key])
      })
    return this
  }

  set(name: string, alias: string): AliasResolver {
    this.dict.set(name, alias)
    return this
  }

  unset(alias: string): AliasResolver {
    const value = (this.dict.get(alias))
    this.dict.delete(alias)
    return this
  }

  clear(): AliasResolver {
    this.dict.clear()
    return this
  }

  resolve(name: string): string {
    const alias = this.dict.get(name)
    return alias || name
  }
}

class PrefixResolver implements NameResolver {

  private prefixes: Map<string, string>

  constructor(prefixes: object) {
    this.prefixes = new Map<string, string>(Object.entries(prefixes))
  }
  inverse(): NameResolver {
    const _inv = new Map<string, string>()
    for (const k of this.prefixes) {
      _inv.set(k[1], k[0])
    }
    return new PrefixResolver(_inv)
  }

  withPrefixes(morePrefixes: object): PrefixResolver {
    Object.keys(morePrefixes)
      .forEach(key => this.prefixes.set(key, morePrefixes[key]))
    return this
  }

  set(prefix: string, expansion: string): PrefixResolver {
    this.prefixes.set(prefix, expansion)
    return this
  }

  unset(prefix: string): PrefixResolver {
    this.prefixes.delete(prefix)
    return this
  }

  clear(): PrefixResolver {
    this.prefixes.clear()
    return this
  }

  resolve(name: string): string {
    let colonidx = name.indexOf(':')
    if (colonidx < 0)
      return name
    let prefix = name.substring(0, colonidx)
    let expansion = this.prefixes.get(prefix)
    if (!expansion)
      return name
    else
      return expansion + name.substring(colonidx + 1)
  }
}

/**
 * A ConNameResolver performs two name resolutions in sequence feeding
 * the result of the first into the second.
 */
class ConNameResolver implements NameResolver {
  private first: NameResolver
  private second: NameResolver
  constructor(first: NameResolver, second: NameResolver) {
    this.first = first
    this.second = second
  }
  inverse(): NameResolver {
    return new ConNameResolver(this.second.inverse(), this.first.inverse())
  }

  resolve(name: string): string {
    return this.second.resolve(this.first.resolve(name))
  }
}

export class DefaultNameResolver extends ConNameResolver {
  // private aliasResolver: NameResolver
  // private prefixResolver: NameResolver
  constructor(readonly aliasResolver: AliasResolver, 
              readonly prefixResolver: PrefixResolver) {
    super(aliasResolver, prefixResolver)
  }

  /**
   * Algorithm:
   * 
   * 1. First the dictionary of aliases is used to translate
   * the name to its alias, if any. This is a single step, a single
   * alias lookup.
   * 2. If the name contains a prefix, the prefix resolver for
   * that prefix is invoked to resolve the name. 
   * 
   * Any more complex behavior, or any sort of recursion where the result
   * of a name resolution is further resolved, must be done through
   * composition of name resolvers and implementing the composition logic 
   * in individual resolvers.
   * 
   * @param name 
   */
  resolve(name: string): string {
    return super.resolve(name)
  }
}

const standardPrefixes = {
  "dcterms": "http://purl.org/dc/terms/",
  "owl": "http://www.w3.org/2002/07/owl#",
  "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  "sh": "http://www.w3.org/ns/shacl#",
  "skos": "http://www.w3.org/2004/02/skos/core#",
  "xsd": "http://www.w3.org/2001/XMLSchema#"
}

const resolvers = {
  default: () => new DefaultNameResolver(new AliasResolver({}), new PrefixResolver(standardPrefixes)), 
  byAlias: (aliases: object) => new AliasResolver(aliases),
  byPrefix: (prefixes: object) => new PrefixResolver(prefixes)
}

export { resolvers, standardPrefixes }
