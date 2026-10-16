
const test=require('node:test');const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
let api;
async function fixture(){return api||(api=await import('../supabase/functions/bank-demo/index.mjs'));}
const custom='https://auth.jportal-nsph.com/as';
test('a revoked PingOne access token blocks an otherwise signed-in bank session',async()=>{
  const {verifyActiveSession}=await fixture();
  await assert.rejects(verifyActiveSession(new Request('https://bank.test',{headers:{'X-PingOne-Access-Token':'revoked-token'}}),
    {iss:custom,sub:'alice'},async()=>new Response(null,{status:401})),e=>e.status===401);
});
test('custom-domain bank requests require an active access token bound to the same user',async()=>{
  const {verifyActiveSession}=await fixture();const claims={iss:custom,sub:'alice'};
  await assert.rejects(verifyActiveSession(new Request('https://bank.test'),claims),e=>e.status===401);
  const request=new Request('https://bank.test',{headers:{'X-PingOne-Access-Token':'active-token'}});
  await assert.rejects(verifyActiveSession(request,claims,async()=>Response.json({sub:'other-user'})),e=>e.status===401);
  await verifyActiveSession(request,claims,async(url,options)=>{
    assert.equal(url,custom+'/userinfo');assert.equal(options.headers.Authorization,'Bearer active-token');
    return Response.json({sub:'alice'});
  });
});
test('the custom domain preserves the existing ledger namespace and rejects unapproved issuers',async()=>{
  const {verifyPingOneToken,handleBankRequest}=await fixture();
  const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='sso-test';
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign=async iss=>{
    const now=Math.floor(Date.now()/1000),raw=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss,aud:'b62c72a0-1d23-4351-8f67-77054a795169',sub:'alice',iat:now,exp:now+300});
    return raw+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(raw))).toString('base64url');
  };
  let account;
  const fetcher=async(url,options)=>{
    if(url===custom+'/.well-known/openid-configuration')return Response.json({issuer:custom,jwks_uri:custom+'/jwks'});
    if(url===custom+'/jwks')return Response.json({keys:[jwk]});
    if(url===custom+'/userinfo')return Response.json({sub:'alice'});
    if(url.endsWith('/ensure_demo_account')){account=JSON.parse(options.body);return Response.json([{id:'one',account_number:'7000000001',display_name:'Alice',balance_cents:10000000}]);}
    if(url.endsWith('/demo_account_history_with_balances'))return Response.json([]);
    throw Error('Unexpected URL '+url);
  };
  const token=await sign(custom);
  const response=await handleBankRequest(new Request('https://bank.test',{headers:{Origin:'https://johnpelquingua.github.io',Authorization:'Bearer '+token,'X-PingOne-Access-Token':'active-token'}}),
    {fetcher,cryptoApi:webcrypto,getEnv:name=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'})}[name])});
  assert.equal(response.status,200);
  assert.equal(account.p_issuer,'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as');
  assert.equal(account.p_subject,'alice');
  let fetched=false;
  await assert.rejects(verifyPingOneToken(await sign('https://evil.example/as'),async()=>{fetched=true;},webcrypto),e=>e.status===401);
  assert.equal(fetched,false);
});
