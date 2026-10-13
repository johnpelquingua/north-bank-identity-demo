const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const context=vm.createContext({
  document:undefined,
  location:{href:'http://localhost:8080/'},
  localStorage:{getItem:()=>null},
  URL,
  console,
});
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8').replace("const app=document.querySelector('#app');",'const app=null;');
vm.runInContext(app,context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','banking.js'),'utf8'),context);

test('signed-in account display masks the assigned account number and omits invented balances',()=>{
  vm.runInContext("session={mode:'pingone',user:{name:'Marvin De Guzman',given_name:'Marvin'},mfaReady:true};bankStatus='ready';bankAccount={accountNumber:'7000001234',balanceCents:987650};balance=9876.5;transactions=[];",context);
  const html=vm.runInContext('overview()',context);
  assert.match(html,/ACCOUNT 7000001234/);
  assert.match(html,/•••• ••1234/);
  assert.match(html,/₱9,876\.50/);
  assert.doesNotMatch(html,/85,000|18,345|4821|Savings account|Debit card|PingOne setup/);
  assert.match(html,/Copy account number/);
});

