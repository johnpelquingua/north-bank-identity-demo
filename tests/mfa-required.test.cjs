const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('bank API rejects signed password-only tokens and accepts signed MFA tokens',async()=>{
  const {verifyPingOneToken}=await import('../supabase/functions/bank-demo/index.mjs');
  const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'key'};
  const issuer='https://auth.jportal-nsph.com/as',now=Math.floor(Date.now()/1000);
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  async function token(amr){
    const body=encode({alg:'RS256',kid:'key'})+'.'+encode({iss:issuer,aud:'b62c72a0-1d23-4351-8f67-77054a795169',sub:'user',iat:now,exp:now+300,amr});
    return body+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(body))).toString('base64url');
  }
  const fetcher=async url=>new Response(JSON.stringify(String(url).endsWith('/jwks')?{keys:[jwk]}:{issuer,jwks_uri:issuer+'/jwks'}));
  for(const amr of [undefined,['pwd']])await assert.rejects(verifyPingOneToken(await token(amr),fetcher,webcrypto),error=>error.status===401&&error.code==='MFA_REQUIRED');
  assert.equal((await verifyPingOneToken(await token(['pwd','mfa']),fetcher,webcrypto)).sub,'user');
});

test('bank browser sends password-only callback to shared setup before loading banking',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  let destination,bankCalls=0;
  const config={issuer:'https://auth.jportal-nsph.com/as',clientId:'bank-client'};
  const pending={state:'state',created:Date.now(),issuer:config.issuer,clientId:config.clientId};
  const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,crypto:webcrypto,atob,btoa,console,
    location:{origin:'https://north.jportal-nsph.com',pathname:'/',href:'https://north.jportal-nsph.com/',search:'?code=code&state=state',assign:url=>destination=url},
    localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>JSON.stringify(pending),removeItem:()=>{}},history:{replaceState:()=>{}},document:undefined});
  vm.runInContext(source.replace("const app=document.querySelector('#app');","const app={innerHTML:''};"),context);
  context.discovery=async()=>({token_endpoint:'mock'});
  context.getJSON=async()=>({id_token:'id',access_token:'access',token_type:'Bearer'});
  context.validateIDToken=async()=>({sub:'user',amr:['pwd']});
  context.loadBanking=async()=>{bankCalls++;};
  vm.runInContext('config='+JSON.stringify(config),context);
  await context.callback();
  assert.equal(destination,'https://jportal-nsph.com/auth/enroll?return=north');
  assert.equal(bankCalls,0);
  assert.equal(vm.runInContext('session',context),null);
});
