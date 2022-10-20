/**
 * Copyright (c) Granthika Co., All Rights Reserved.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 *
 */
import fetch from 'cross-fetch'
import {RdfXmlParser} from "rdfxml-streaming-parser"
import {ReadableWebToNodeStream} from 'readable-web-to-node-stream'
 
 // :: Wraps the low-lever fetch for communicating with the back-end. All Granthika backend logic
 // is implemented with services accepting and returning JSON data. So the functions
 // here work with JSON directly. To communicate with some other server or get
 // some other media type, use the 'fetch' function that simply delegates to the lower-level
 // fetch (polyfilled if necessary)
 //
 //

export class Restish {

  private url : string

   // :: A client with a base URL. All relative path used in other function calls in are simply
   // appended to the base.
  constructor(url) {
    this.url = url
  }
 
  get(path) {
    return fetch(this.url + path, {
      credentials: 'same-origin'
    }).then(r => {
      if (r.ok)
        return r.json()
      else
        throw r
    }).catch(e => {
      console.error("Calling " + path + " errored with:", e)
    })
  }

  async getRDF(path) {    

    const resp = await fetch(this.url + path, {
      credentials: 'same-origin'
    })

    if (!resp.ok)
      throw resp

      const myParser = new RdfXmlParser();

      let resolve, reject
      const result = new Promise((res, rej) => {
        reject = rej
        resolve = res
      })

      const quads : any[] = []
        
        
      const nodeStream = new ReadableWebToNodeStream(resp.body!);

      //is nodeStream actually an event emitter?
      const quadStream = myParser
        .import(nodeStream as any)
        .on('data', (data) => quads.push(data))
        .on('error', () => {reject("error parsing")})
        .on('end', () => {resolve(quads)});

      return await result

  }
 
  _putOrPost(path, method, data) {
    return fetch(this.url + path, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      method: method,
      body: JSON.stringify(data),
      credentials: 'same-origin'
    }).then(r => r.json())
    .catch(err =>
      console.error("While posting to " + path, err)
    )
  }
 
  put(path, data) {
    return this._putOrPost(path, "PUT", data)
  }

  post(path, data) {
    return this._putOrPost(path, "POST", data)
  }

  del(path) {
  return fetch(this.url + path, { method: "DELETE"}).then(r => r.json())
  }
 
  async _sendFormData(path, method, formData) {
    const response = await fetch(this.url + path, {
      method: method,
      body: formData,
      credentials: 'same-origin',
    })
    return response.json()
  }
 
  postFormData(path, formData) {
    return this._sendFormData(path, "POST", formData)
  }
 
  static withParams(path, params) {
    const query = Object.keys(params)
                      .filter(k => params[k] != null)
                      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
                      .join('&')
    return path + (query ? "?" + query : "")
  }
 
  static toBaseURL(url) {
    if (url.endsWith('#'))
      url = url.substring(0, url.length-1)
    if (!url.endsWith('/'))
      url += '/'
    return url
  }
}