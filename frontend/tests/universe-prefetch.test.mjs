import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import ts from 'typescript'
const source=(await readFile(new URL('../src/lib/api.ts',import.meta.url),'utf8'))
 .replace("import { authClient } from './auth'",'const authClient=null')
 .replace('import.meta.env.PROD','false').replace('import.meta.env.VITE_API_URL',"'http://api.test'")
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
const {api}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'))
test('prefetched public destinations reuse requests and expansion invalidates the map',async()=>{
 const previous=globalThis.fetch;const calls=[]
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:'warm',root_id:'warm'})}
 try {
  await Promise.all([api.prefetchUniverse('warm'),api.prefetchUniverse('warm')])
  await api.media('warm');await api.universe('warm')
  assert.equal(calls.length,2)
  assert.ok(calls.every(c=>!c.options.headers.has('Authorization')))
  await api.expandUniverse('warm',1);await api.universe('warm')
  assert.equal(calls.length,4)
 }finally{globalThis.fetch=previous}
})
test('cancelling one visit does not cancel its shared map request',async()=>{
 const previous=globalThis.fetch;let complete;let calls=0
 globalThis.fetch=()=>{calls++;return new Promise(resolve=>{complete=resolve})}
 try{
  const controller=new AbortController()
  const visit=api.universe('pending',controller.signal)
  const next=api.universe('pending')
  controller.abort()
  await assert.rejects(visit,{name:'AbortError'})
  complete(Response.json({root_id:'pending'}))
  assert.equal((await next).root_id,'pending');assert.equal(calls,1)
 }finally{globalThis.fetch=previous}
})
test('failed preloads do not prevent a fresh retry',async()=>{
 const previous=globalThis.fetch;let fail=true;let calls=0
 globalThis.fetch=async()=>{calls++;if(fail)throw Error('Offline');return Response.json({root_id:'retry'})}
 try{
  await api.prefetchUniverse('retry');fail=false
  assert.equal((await api.universe('retry')).root_id,'retry');assert.equal(calls,3)
 }finally{globalThis.fetch=previous}
})
