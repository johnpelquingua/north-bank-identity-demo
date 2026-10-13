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

test('statements include only the signed-in account history within Philippine dates',()=>{
  vm.runInContext("bankHistory=[{created_at:'2026-10-13T00:30:00Z',direction:'OUTGOING',counterparty_name:'Second customer',counterparty_account_number:'7000005678',amount_cents:2000000},{created_at:'2026-10-12T15:30:00Z',direction:'INCOMING',counterparty_name:'First customer',counterparty_account_number:'7000009999',amount_cents:1900000}];statementFrom='2026-10-13';statementTo='2026-10-13';",context);
  const rows=vm.runInContext('statementRows()',context);
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'Second customer');
  assert.equal(rows[0].amount,-20000);
  const html=vm.runInContext('statements()',context);
  assert.match(html,/1 transaction in this range/);
  assert.match(html,/Second customer/);
  assert.doesNotMatch(html,/First customer/);
  assert.match(html,/latest 2 available transfers/);
});

test('banking navigation exposes working account, transfer, statement, and security destinations',()=>{
  const screen=vm.createContext({document:undefined,location:{href:'http://localhost:8080/'},localStorage:{getItem:()=>null},URL,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8').replace("const app=document.querySelector('#app');","const app={innerHTML:''};"),screen);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','banking.js'),'utf8'),screen);
  screen.document={querySelectorAll:()=>[],querySelector:()=>null};
  vm.runInContext("session={mode:'pingone',user:{name:'Marvin De Guzman',given_name:'Marvin'},mfaReady:true};bankStatus='ready';bankAccount={accountNumber:'7000001234',balanceCents:987650};balance=9876.5;page='overview';render();",screen);
  const html=vm.runInContext('app.innerHTML',screen);
  for(const label of ['Accounts','Transfer money','Transactions','Statements','Sign-in & security','My profile'])assert.match(html,new RegExp(label));
  assert.match(html,/data-transfer/);
  assert.match(html,/data-page="statements"/);
  assert.match(html,/data-page="mfa"/);
});
