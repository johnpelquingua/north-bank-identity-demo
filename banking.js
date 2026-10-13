// Fictional shared accounts. The URL is public; the service key stays in Supabase.
const bankApiUrl='https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/bank-demo';
let bankAccount=null,bankStatus='loading',bankError='';
const bankInitialBalance=128450.50;
const bankInitialTransactions=transactions.slice();

async function bankRequest(method,body){
  if(!session?.idToken)throw Error('Sign in again to view your account.');
  let result;
  try{result=await fetch(bankApiUrl,{method,headers:{Authorization:'Bearer '+session.idToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)})}
  catch{throw Error('The sample transfer service is unavailable. Try again shortly.')}
  let data={};try{data=await result.json()}catch{}
  if(!result.ok)throw Error(data.error||'The sample transfer service is unavailable.');
  return data;
}
function applyBankData(data){
  if(!data.account||!/^\d{10}$/.test(data.account.accountNumber)||!Number.isSafeInteger(data.account.balanceCents)||!Array.isArray(data.history))throw Error('The sample account response was incomplete.');
  bankAccount=data.account;
  balance=data.account.balanceCents/100;
  transactions=data.history.map(t=>({
    name:String(t.counterparty_name||'Customer'),
    detail:`Sample transfer · ${t.direction==='INCOMING'?'Incoming':'Outgoing'} · ${String(t.counterparty_account_number||'')}`,
    date:new Date(t.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
    amount:(t.direction==='INCOMING'?1:-1)*Number(t.amount_cents)/100,
    icon:t.direction==='INCOMING'?'↙':'↗'
  }));
  bankStatus='ready';bankError='';
}
async function loadBanking(){
  if(session?.mode!=='pingone'||!session.mfaReady)return;
  try{applyBankData(await bankRequest('GET'))}
  catch(error){bankStatus='error';bankError=error.message;bankAccount=null;transactions=[];balance=0}
}

const originalBankCallback=callback;
callback=async function(){await originalBankCallback();await loadBanking()};
const originalBankSignout=signout;
signout=function(){bankAccount=null;bankStatus='loading';bankError='';originalBankSignout();transactions=bankInitialTransactions.slice();balance=bankInitialBalance};
const originalBankOverview=overview;
overview=function(){
  let html=originalBankOverview();
  if(session?.mode!=='pingone')return html;
  const accountLine=bankStatus==='ready'?`ACCOUNT ${esc(bankAccount.accountNumber)} · Share this number to receive a sample transfer`:bankStatus==='error'?`Account unavailable: ${esc(bankError)}`:'Loading your sample account…';
  html=html.replace('ACCOUNT •••• 4821 &nbsp;',`${accountLine} &nbsp;`);
  html=html.replace('Available balance · Everyday account',bankStatus==='ready'?'Available sample balance · Everyday account':'Everyday account');
  html=html.replace(`<div class="amount">${money(balance)}</div>`,`<div class="amount">${bankStatus==='ready'?money(balance):'—'}</div>`);
  html=html.replace('YOUR MONEY AT A GLANCE','YOUR FICTIONAL ACCOUNT');
  html=html.replace('Here’s where things stand today.','Transfers between North Bank test users are shared and appear in both histories.');
  html=html.replace('<div class="subgrid">',`<p class="small muted">Only the everyday account and transfer history are shared. The savings card and spending figures are sample illustrations.</p><button class="action" data-bank-refresh type="button">Refresh balance and history</button><div class="subgrid">`);
  return html;
};
const originalBankActivity=activity;
activity=function(){
  let html=originalBankActivity();
  if(session?.mode!=='pingone')return html;
  html=html.replace('ACCOUNT •••• 4821',bankStatus==='ready'?`ACCOUNT ${esc(bankAccount.accountNumber)}`:'ACCOUNT UNAVAILABLE');
  html=html.replace('Your sample account activity.',bankStatus==='ready'?'Your shared sample transfer history.':esc(bankError||'Loading transfer history…'));
  return html.replace('<section class="card">',`<button class="action" data-bank-refresh type="button">Refresh history</button><section class="card">`);
};
const originalBankRender=render;
render=function(){originalBankRender();document.querySelectorAll('[data-bank-refresh]').forEach(button=>button.onclick=async()=>{button.disabled=true;await loadBanking();render()});if(session?.mode==='pingone'&&session.mfaReady&&bankStatus==='loading'){bankStatus='fetching';loadBanking().then(()=>render())}};

const originalBankTransfer=transfer;
transfer=function(){
  if(session?.mode!=='pingone')return originalBankTransfer();
  if(bankStatus!=='ready'){toast(bankError||'Your sample account is loading.');return}
  const dialog=document.createElement('dialog');
  dialog.innerHTML=`<h2>Transfer sample funds</h2><p class="small muted">Enter another North Bank test user’s 10-digit account number. No real money moves.</p><form id="transfer-form"><label for="recipient">Recipient account number</label><input id="recipient" name="recipient" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required><label for="amount">Amount (PHP)</label><input id="amount" name="amount" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required><p class="error" id="bank-transfer-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" id="cancel-transfer" class="btn secondary">Cancel</button><button type="submit" class="btn">Transfer sample funds</button></div></form>`;
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('#cancel-transfer').onclick=()=>dialog.close();
  let requestId=crypto.randomUUID();
  dialog.querySelectorAll('input').forEach(input=>input.oninput=()=>{requestId=crypto.randomUUID()});
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]'),errorNode=form.querySelector('#bank-transfer-error');
    const recipientAccountNumber=String(new FormData(form).get('recipient')).trim(),amountText=String(new FormData(form).get('amount')).trim();
    const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(amountText);
    const amountCents=match?Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')):NaN;
    if(!/^\d{10}$/.test(recipientAccountNumber)||!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000||amountCents>bankAccount.balanceCents){errorNode.textContent='Enter a valid account and amount within your sample balance.';errorNode.hidden=false;return}
    submit.disabled=true;errorNode.hidden=true;
    try{applyBankData(await bankRequest('POST',{recipientAccountNumber,amountCents,requestId}));dialog.close();render();toast('Sample transfer completed. Both account histories have been updated.')}
    catch(error){errorNode.textContent=error.message;errorNode.hidden=false;submit.disabled=false}
  };
  dialog.showModal();
};

