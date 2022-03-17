import camelCase from 'lodash/camelCase'
import isArray from 'lodash/isArray'
import cloneDeep from 'lodash/cloneDeep'
import keys from 'lodash/keys'
import merge from 'lodash/merge'
import difference from 'lodash/difference'

// TODO: Check if is this library support CURIE syntax. Do Hyper Cache in Pinia.

type NormalizeOptions = {
  camelizeKeys?: boolean
  normalizeUri?: Function
  metaKey?: string
  filterReferences?: boolean
  embeddedStandaloneListKey?: string
  virtualSelfLinks?: any
}

type DefaultNormalizeOptions = {
  camelizeKeys: boolean
  normalizeUri: Function
  metaKey: string
  filterReferences: boolean
  embeddedStandaloneListKey?: string
  virtualSelfLinks?: any
}

type JSONBase = Record<string, any>

interface Link extends JSONBase {
  href: string // REQUIRED URI or URI Template
  templated?: boolean // OPTIONAL when use URI Template, the value SHOULD be true.
  type?: string // OPTIONAL
  deprecation?: string // OPTIONAL URL
  name?: string // OPTIONAL
  profile?: string // OPTIONAL It seems as if HTML 5 will drop support for this mechanism entirely. @{link https://datatracker.ietf.org/doc/rfc6906/}
  title?: string // OPTIONAL
  hreflang?: string // OPTIONAL
}

type LinksBase = Record<string, Link | Array<Link>>

interface Links extends LinksBase {
  self: Link
}

interface ResourceBase extends JSONBase {
  _links: Links
}

type Embedded = Record<string, ResourceBase | Array<ResourceBase>>

interface Resource extends JSONBase {
  _links?: Links
  _embedded?: Embedded
}

let extractResource: Function

function normalizeLink(link: Link, normalizeUri: Function) {
  if (!link || !link.href) return link
  if (link.templated) return link
  return { ...link, href: normalizeUri(link.href) }
}

function camelizeNestedKeys(attributeValue: any): any {
  // attribute value is a string.
  if (attributeValue === null || typeof attributeValue !== 'object') {
    return attributeValue
  }

  // attribute value is an array.
  if (isArray(attributeValue)) {
    return attributeValue.map(camelizeNestedKeys)
  }

  const copy: any = {}

  // attribute value is an object.
  keys(attributeValue).forEach(key => {
    copy[camelCase(key)] = camelizeNestedKeys(attributeValue[key])
  })

  return copy
}

/**
 * Check if the value is an instance of a Resource Object.
 * @param value An JSON object.
 * @returns Is this object a Resource Object.
 */
function isResource(value: JSONBase): boolean {
  return value?._links?.self && value._links.self.href != null
}

function hasSingleKey(object: JSONBase | LinksBase, key: string) {
  const objectKeys = Object.keys(object)
  return objectKeys.length === 1 && objectKeys[0] === key
}

function isReference(value: Resource) {
  return value !== null && hasSingleKey(value, '_links') && hasSingleKey(value._links as LinksBase, 'self')
}

function isSingleLink(value: object) {
  return value !== null && hasSingleKey(value, 'href');
}

function extractSingleEmbed(embed: ResourceBase, ret: JSONBase, opts: DefaultNormalizeOptions) {
  if (!(opts.filterReferences && isReference(embed))) {
    merge(ret, extractResource(embed, opts))
  }
  return normalizeLink(cloneDeep(((embed || {})._links || {}).self) || null, opts.normalizeUri)
}

function extractEmbeds(
  embeds: ResourceBase | Array<ResourceBase> | undefined,
  ret: JSONBase,
  opts: DefaultNormalizeOptions
) {
  if (!isArray(embeds)) {
    return extractSingleEmbed(embeds as ResourceBase, ret, opts)
  }
  return embeds.map(embed => extractSingleEmbed(embed, ret, opts))
}

function extractAllEmbedded(json: Resource, uri: string, opts: DefaultNormalizeOptions) {
  const { camelizeKeys } = opts
  const ret: JSONBase = {
    [uri]: {}
  }

  keys(json._embedded).forEach((key: string) => {
    if (camelizeKeys) {
      ret[uri][camelCase(key)] = camelizeNestedKeys(extractEmbeds(json._embedded?.[key], ret, opts))
    } else {
      ret[uri][key] = extractEmbeds(json._embedded?.[key], ret, opts)
    }
  })

  return ret
}

//check this embeddedStandaloneListKey
function extractSingleLink(link: Link, ret: JSONBase, opts: DefaultNormalizeOptions) {
  return normalizeLink(cloneDeep(link), opts.normalizeUri)
}

function extractLinks(links: Link | Array<Link>, ret: JSONBase, opts: DefaultNormalizeOptions) {
  if (!(isArray(links))) {
    return extractSingleLink(links, ret, opts)
  }
  return links.map((link: Link) => extractSingleLink(link, ret, opts))
}

function extractAllLinks(json: Resource, uri: string, opts: DefaultNormalizeOptions) {
  const { camelizeKeys, normalizeUri } = opts
  const ret: JSONBase = {
    [uri]: {}
  }

  keys(json._links).forEach((key: string) => {
    if (key === 'self') return
    if (camelizeKeys) {
      // JSON HAL spec(https://datatracker.ietf.org/doc/html/draft-kelly-json-hal-08#section-4.1.1) says that
      // [_links] is an object whose property names are link relation types (as defined by [RFC5988]) and values are either a Link Object or an array of Link Objects.
      // It's impossible that {json._links?.[key]} is undefined.
      ret[uri][camelCase(key)] = extractLinks(cloneDeep(json._links?.[key] as Link | Array<Link>), ret, opts)
      // if (!isArray(json._links?.[key])) {
      //   ret[uri][camelCase(key)] = normalizeLink(cloneDeep(json._links?.[key] as Link), normalizeUri)
      // } else {
      //   ret[uri][camelCase(key)] = normalizeLink(cloneDeep(json._links?.[key]), normalizeUri)
      // }
    } else {
      let links = json._links?.[key] as Link | Array<Link>
      if (!(isArray(links))) {
        ret[uri][key] = normalizeLink(cloneDeep(links), normalizeUri)
      } else {
        ret[uri][key] = links.map((link: Link) => normalizeLink(cloneDeep(link), normalizeUri))
      }
    }
  })

  return ret
}

function extractToVirtualKey(uri: string, rel: string, content: any, opts: DefaultNormalizeOptions) {
  const ret: JSONBase = {}
  const virtualKey = `${uri}#${rel}`
  ret[virtualKey] = {
    [opts.embeddedStandaloneListKey as string]: content,
    [opts.metaKey]: {
      self: virtualKey,
      virtual: true,
      owningResource: uri,
      owningRelation: rel
    }
  }

  ret[uri] = {}
  ret[uri][rel] = {
    href: virtualKey,
    virtual: true
  }
  return ret
}

function mergeEmbeddedStandaloneCollections(embedded: JSONBase, links: JSONBase, opts: DefaultNormalizeOptions) {
  const ret: JSONBase = {}
  merge(ret, links)
  merge(ret, embedded)

  keys(embedded).forEach(uri => {
    // check all embedded properties for embedded collections
    keys(embedded[uri]).forEach(rel => {
      if (Array.isArray(embedded[uri][rel])) {
        // standalone link provided (store embedded list as standalone link)
        if (uri in links && rel in links[uri] && isSingleLink(links[uri][rel])) {
          ret[uri][rel] = links[uri][rel]
          ret[links[uri][rel].href] = {
            [opts.embeddedStandaloneListKey as string]: embedded[uri][rel],
            [opts.metaKey]: { self: links[uri][rel].href }
          }
        } else if (opts.virtualSelfLinks && rel !== opts.embeddedStandaloneListKey) {
          // no standalone link provided --> generate virtual key
          delete ret[uri][rel]
          merge(ret, extractToVirtualKey(uri, rel, embedded[uri][rel], opts))
        }
      }
    })

    // also check remaining link properties to search for a possible collection
    // which is not embedded
    if (opts.virtualSelfLinks) {
      difference(keys(links[uri]), [
        ...keys(embedded[uri]),
        opts.embeddedStandaloneListKey
      ]).forEach((rel) => {
        // @ts-ignore
        if (Array.isArray(links[uri][rel])) {
          // @ts-ignore
          delete ret[uri][rel]
          // @ts-ignore
          merge(ret, extractToVirtualKey(uri, rel, links[uri][rel], opts))
        }
      })
    }
  })

  return ret
}

extractResource = (json: JSONBase, opts: DefaultNormalizeOptions): JSONBase => {
  const { camelizeKeys, normalizeUri, metaKey } = opts

  if (!isResource(json)) {
    return json
  }

  const uri = normalizeUri(json._links.self.href)
  const ret: JSONBase = {
    [uri]: {}
  }

  // filter status keys
  keys(json)
    .filter((key: string) => key !== '_embedded' && key !== '_links')
    .forEach((key: string) => {
      if (camelizeKeys) {
        // Camelize all keys expect metaKey
        if (key === metaKey) {
          ret[uri][metaKey] = camelizeNestedKeys(cloneDeep(json[key]))
        } else {
          // camelize keys
          ret[uri][camelCase(key)] = camelizeNestedKeys(cloneDeep(json[key]))
        }
      } else {
        ret[uri][key] = cloneDeep(json[key])
      }
    })

  const embedded = extractAllEmbedded(json as Resource, uri, opts)
  const links = extractAllLinks(json as Resource, uri, opts)

  if (opts.embeddedStandaloneListKey) {
    merge(ret, mergeEmbeddedStandaloneCollections(embedded, links, opts))
  } else {
    merge(ret, links)
    merge(ret, embedded)
  }

  ret[uri][metaKey] = ret[uri][metaKey] || {}
  ret[uri][metaKey].self = uri

  return ret
}

/**
 * The main function of normalize hal json object.
 * @param json JSONBase
 * @param opts NormalizeOptions: An object to set options.
 * @returns JSONBase：Normalize Object.
 */
export default function normalize(json: JSONBase, opts: NormalizeOptions = {}): JSONBase {
  const optsWithDefaults: DefaultNormalizeOptions = {
    camelizeKeys: true,
    normalizeUri: (uri: string): string => uri,
    metaKey: '_meta',
    filterReferences: false,
    ...opts
  }

  if (optsWithDefaults.filterReferences && isReference(json)) {
    // TODO: is this really the most useful way of handling this edge case?
    return {};
  }

  return extractResource(json, optsWithDefaults)
}
// https://datatracker.ietf.org/doc/html/draft-kelly-json-hal-08
