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

test('a pending transfer is sent only after the same user completes the PingOne MFA challenge',async()=>{
  const f=await setup();f.calls.length=0;
  const subject='788d4931-6936-43f2-82ff-178f5762298a';
  const id='03e1897e-33b0-40b9-b54e-68236769b1fa';
  const device='ea055ca3-2b5b-4766-9628-95fc03f4ec9b';
  const body={recipientAccountNumber:'7000000002',amountCents:2000001,requestId:'3085575d-44c0-4e3a-84eb-97f6de1a0d86'};
  let completed=false;
  const values={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),
    PINGONE_WORKER_CLIENT_ID:'b62c72a0-1d23-4351-8f67-77054a795169',PINGONE_WORKER_CLIENT_SECRET:'test-secret'};
  const fetcher=async(url,options)=>{
    if(url.endsWith('/as/token')&&url.includes('auth.pingone.sg'))return Response.json({access_token:'worker-token'});
    if(url.includes('/deviceAuthentications'))return Response.json({id,user:{id:subject},status:completed?'COMPLETED':'OTP_REQUIRED',
      selectedDevice:{id:device},_embedded:{devices:[{id:device,type:'EMAIL',status:'ACTIVE'}]}},{status:options.method==='POST'&&url.endsWith('/deviceAuthentications')?201:200});
    if(url.endsWith('/make_demo_transfer')&&!completed)return Response.json({message:'RECOGNIZE_REQUIRED'},{status:400});
    return f.dependencies.fetcher(url,options);
  };
  const deps={...f.dependencies,fetcher,getEnv:name=>values[name]};
  const headers={Authorization:'Bearer '+await f.token(subject),Origin:'https://johnpelquingua.github.io'};
  const request=input=>new Request('https://bank.test',{method:'POST',headers,body:JSON.stringify(input)});
  const start=await f.handleBankRequest(request({...body,action:'mfa-start'}),deps);
  assert.equal(start.status,200);
  const state=(await start.json()).state;
  const denied=await f.handleBankRequest(request({...body,action:'mfa-complete',mfaState:state}),deps);
  assert.equal(denied.status,403);
  assert.equal(f.calls.some(call=>call.url.endsWith('/make_demo_transfer')),false);
  completed=true;
  const accepted=await f.handleBankRequest(request({...body,action:'mfa-complete',mfaState:state}),deps);
  assert.equal(accepted.status,200);
  const transfer=f.calls.find(call=>call.url.endsWith('/make_demo_transfer'));
  assert.equal(JSON.parse(transfer.options.body).p_mfa_verified,true);
  const changed=await f.handleBankRequest(request({...body,amountCents:100,action:'mfa-complete',mfaState:state}),deps);
  assert.equal(changed.status,400);
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

test('an unverified enrollment result cannot update the PingOne directory',async()=>{
  const f=await setup();f.calls.length=0;
  const values={
    SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),
    RECOGNIZE_ENABLED:'true',RECOGNIZE_JWKS_URL:'https://example.test/customers/netpoleons_asia/.well-known/jwks.json',
    PINGONE_WORKER_CLIENT_ID:'worker-id',PINGONE_WORKER_CLIENT_SECRET:'worker-secret',
  };
  const response=await f.handleBankRequest(new Request('https://bank.test',{method:'POST',headers:{
    Authorization:'Bearer '+await f.token('alice'),Origin:'https://johnpelquingua.github.io',
  },body:JSON.stringify({action:'recognize-enrollment-complete',enrollmentJwt:'unsigned',
    recipientAccountNumber:'',amountCents:0,requestId:'',transferContext:{
      recipientAccountNumber:'7000000002',amountCents:2000001,
      requestId:'3085575d-44c0-4e3a-84eb-97f6de1a0d86'}})}),
  {...f.dependencies,getEnv:name=>values[name]});
  assert.equal(response.status,403);
  assert.equal(f.calls.some(call=>call.url.includes('pingone.sg')),false);
  assert.equal(f.calls.some(call=>call.url.endsWith('/make_demo_transfer')),false);
});

test('a signed enrollment result updates the matching user without sending a transfer',async()=>{
  const f=await setup();f.calls.length=0;
  const {recognizeEnrollmentData}=await import('../supabase/functions/bank-demo/recognize.mjs');
  const subject='bdc48b62-7baf-418d-bd08-c4baf552eb44';
  const requestId='3085575d-44c0-4e3a-84eb-97f6de1a0d86';
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='recognize-key';jwk.use='sig';
  const td=recognizeEnrollmentData({issuer:ISSUER,subject,requestId});
  const header=B64({alg:'ES256',kid:jwk.kid});
  const claims=B64({iat:Math.floor(Date.now()/1000),td});
  const signed=header+'.'+claims;
  const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signed));
  const proof=signed+'.'+Buffer.from(signature).toString('base64url');
  const values={
    SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),
    RECOGNIZE_ENABLED:'true',RECOGNIZE_JWKS_URL:'https://example.test/customers/netpoleons_asia/.well-known/jwks.json',
    PINGONE_WORKER_CLIENT_ID:'worker-id',PINGONE_WORKER_CLIENT_SECRET:'worker-secret',
  };
  const directoryCalls=[];
  const fetcher=async(url,options)=>{
    if(url===values.RECOGNIZE_JWKS_URL)return Response.json({keys:[jwk]});
    if(url.endsWith('/as/token'))return Response.json({access_token:'worker-token'});
    if(url.includes('/users/')){directoryCalls.push({url,options});return Response.json({id:subject})}
    return f.dependencies.fetcher(url,options);
  };
  const response=await f.handleBankRequest(new Request('https://bank.test',{method:'POST',headers:{
    Authorization:'Bearer '+await f.token(subject),Origin:'https://johnpelquingua.github.io',
  },body:JSON.stringify({action:'recognize-enrollment-complete',recipientAccountNumber:'',amountCents:0,requestId:'',
    transferContext:{recipientAccountNumber:'7000000002',amountCents:2000001,requestId},enrollmentJwt:proof})}),
  {...f.dependencies,fetcher,getEnv:name=>values[name],cryptoApi:webcrypto});
  assert.equal(response.status,200);
  assert.equal((await response.json()).recognizeEnrolled,true);
  assert.equal(directoryCalls.length,1);
  assert.match(directoryCalls[0].url,new RegExp(subject+'$'));
  assert.deepEqual(JSON.parse(directoryCalls[0].options.body),{recognizeEnrolled:'true'});
  assert.equal(f.calls.some(call=>call.url.endsWith('/make_demo_transfer')),false);
});
