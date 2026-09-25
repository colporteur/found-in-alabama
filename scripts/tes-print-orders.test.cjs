const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/api/tes/print-orders/route.ts'),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(rows=[],items=[],authorized=true) {
  let queries=0; const conditions=[];
  const chain={from(){return this;},where(c){conditions.push(c);return this;},
    orderBy(){return this;},limit:async()=>rows,then(resolve){return Promise.resolve(items).then(resolve);}};
  const op = name => (...args)=>({name,args});
  const context={exports:{}, require(name) {
    if(name==='next/server') return {NextResponse:{json:(body,opts)=>({body,...opts})}};
    if(name==='drizzle-orm') return Object.fromEntries(['and','asc','eq','gt','gte','inArray'].map(k=>[k,op(k)]));
    if(name==='@/db') return {db:{select(){queries++;return chain;}}};
    if(name==='@/db/schema') return {tesOrders:new Proxy({},{get:(_,k)=>k}),tesOrderItems:new Proxy({},{get:(_,k)=>k})};
    if(name==='@/lib/api-keys') return {bearerFromRequest:()=>authorized?'key':null,verifyApiKey:async()=>authorized};
    throw Error(name);
  }};
  vm.runInNewContext(code,context);
  return {get:(query='')=>context.exports.GET({nextUrl:new URL('https://example.test/?'+query)}),conditions,queries:()=>queries};
}
test('unauthenticated and malformed requests never query orders',async()=>{
  const h=setup([],[],false); assert.equal((await h.get()).status,401); assert.equal(h.queries(),0);
  const valid=setup(); assert.equal((await valid.get('after=invalid')).status,400);
  assert.equal((await valid.get('since=invalid')).status,400); assert.equal(valid.queries(),0);
});
test('paid TES filtering, paid-date boundary, full order items and pagination',async()=>{
  const rows=Array.from({length:101},(_,n)=>({orderId:String(n)}));
  const h=setup(rows,[{orderId:'0',id:'line-a'},{orderId:'0',id:'line-b'}]);
  const result=await h.get('since=2026-09-24T05:00:00Z');
  assert.equal(result.body.orders.length,100); assert.equal(result.body.nextCursor,'99');
  assert.equal(result.body.orders[0].items.length,2);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
  const serialized=JSON.stringify(h.conditions[0]);
  assert.match(serialized,/"source","tes"/); assert.match(serialized,/"status","paid"/);
  assert.match(serialized,/"paidAt","2026-09-24T05:00:00.000Z"/);
  assert.doesNotMatch(serialized,/delistStatus/);
});
