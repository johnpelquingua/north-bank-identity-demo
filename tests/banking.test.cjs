const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const ISSUER='https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as';
const CLIENT='b62c72a0-1d23-4351-8f67-77054a795169';
const B64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
let fixture;
async function setup(){
  if(fixture)return fixture;
  const api=await import('../supabase/functions/bank-demo/index.mjs');
  const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-key';
  const token=async(sub,overrides={})=>{
    const now=Math.floor(Date.now()/1000),head=B64({alg:'RS256',kid:'test-key'}),body=B64({iss:ISSUER,aud:CLIENT,sub,iat:now,exp:now+600,...overrides});
    const bytes=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(head+'.'+body));
    return head+'.'+body+'.'+Buffer.from(bytes).toString('base64url');
  };
  const calls=[];
  const fetcher=async(url,options)=>{
    if(url===ISSUER+'/.well-known/openid-configuration')return Response.json({issuer:ISSUER,jwks_uri:ISSUER+'/jwks'});
    if(url===ISSUER+'/jwks')return Response.json({keys:[jwk]});
    calls.push({url,options});
    const name=url.split('/').at(-1);
    if(name==='ensure_demo_account')return Response.json([{id:'aaa',account_number:'7000000001',display_name:'Alice',balance_cents:10000000}]);
    if(name==='demo_account_history')return Response.json([]);
    if(name==='make_demo_transfer')return Response.json({id:'tx',replayed:false});
    throw Error('Unexpected RPC');
  };
  fixture={...api,token,calls,dependencies:{fetcher,cryptoApi:webcrypto,getEnv:name=>name==='SUPABASE_URL'?'https://test.supabase.co':JSON.stringify({default:'sb_secret_test'})}};
  return fixture;
}
test('bank API rejects invalid identity before touching account data',async()=>{
  const f=await setup();f.calls.length=0;
  const bad=await f.token('alice',{aud:'other-client'});
  const response=await f.handleBankRequest(new Request('https://bank.test',{headers:{Authorization:'Bearer '+bad,Origin:'https://johnpelquingua.github.io'}}),f.dependencies);
  assert.equal(response.status,401);assert.equal(f.calls.length,0);
});
test('bank API derives the sender from the signed token and sends no service key to the browser',async()=>{
  const f=await setup();f.calls.length=0;
  const requestId='3085575d-44c0-4e3a-84eb-97f6de1a0d86';
  const response=await f.handleBankRequest(new Request('https://bank.test',{method:'POST',headers:{Authorization:'Bearer '+await f.token('alice'),Origin:'https://johnpelquingua.github.io'},body:JSON.stringify({senderSubject:'mallory',recipientAccountNumber:'7000000002',amountCents:125,requestId})}),f.dependencies);
  assert.equal(response.status,200);
  const transfer=f.calls.find(call=>call.url.endsWith('/make_demo_transfer'));
  assert.equal(JSON.parse(transfer.options.body).p_sender_subject,'alice');
  assert.equal(JSON.parse(transfer.options.body).p_amount_cents,125);
  assert.equal(response.headers.get('access-control-allow-origin'),'https://johnpelquingua.github.io');
  assert.equal(response.headers.get('apikey'),null);
});
test('a face-required transfer fails closed when Recognize is not configured',async()=>{
  const f=await setup();
  const fetcher=async(url,options)=>{
    if(url.endsWith('/make_demo_transfer'))return Response.json({message:'RECOGNIZE_REQUIRED'},{status:400});
    return f.dependencies.fetcher(url,options);
  };
  const response=await f.handleBankRequest(new Request('https://bank.test',{method:'POST',headers:{
    Authorization:'Bearer '+await f.token('alice'),Origin:'https://johnpelquingua.github.io',
  },body:JSON.stringify({recipientAccountNumber:'7000000002',amountCents:2000000,
    requestId:'3085575d-44c0-4e3a-84eb-97f6de1a0d86'})}),{...f.dependencies,fetcher});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not ready/);
});
test('refreshing a face challenge never sends the transfer',async()=>{
  const f=await setup();f.calls.length=0;
  const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const privateJwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
  const values={
    SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),
    RECOGNIZE_ENABLED:'true',RECOGNIZE_CUSTOMER_NAME:'netpoleons_asia',
    RECOGNIZE_AUTH_SERVICE_URL:'https://authentication-service-sandbox.eks.core-production.keyless.technology/',
    RECOGNIZE_JWKS_URL:'https://example.test/customers/netpoleons_asia/.well-known/jwks.json',
    RECOGNIZE_AUTH_PRIVATE_JWK:JSON.stringify(privateJwk),RECOGNIZE_AUTH_KEY_ID:'north-bank-test',
  };
  const response=await f.handleBankRequest(new Request('https://bank.test',{method:'POST',headers:{
    Authorization:'Bearer '+await f.token('alice'),Origin:'https://johnpelquingua.github.io',
  },body:JSON.stringify({action:'recognize-challenge',recipientAccountNumber:'7000000002',
    amountCents:2000000,requestId:'3085575d-44c0-4e3a-84eb-97f6de1a0d86'})}),
  {...f.dependencies,getEnv:name=>values[name]});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.recognize.username,'alice');
  assert.ok(body.recognize.authorizationToken.split('.').length===3);
  assert.equal(f.calls.some(call=>call.url.endsWith('/make_demo_transfer')),false);
});

