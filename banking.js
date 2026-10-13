// Shared demo accounts. The URL is public; the service key stays in Supabase.
const bankApiUrl='https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/bank-demo';
let bankAccount=null,bankStatus='loading',bankError='';
const bankInitialBalance=128450.50;
const bankInitialTransactions=transactions.slice();

async function bankRequest(method,body){
  if(!session?.idToken)throw Error('Sign in again to view your account.');
  let result;
  try{result=await fetch(bankApiUrl,{method,headers:{Authorization:'Bearer '+session.idToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)})}
  catch{throw Error('The transfer service is unavailable. Try again shortly.')}
  let data={};try{data=await result.json()}catch{}
  if(!result.ok)throw Error(data.error||'The transfer service is unavailable.');
  return data;
}
function applyBankData(data){
  if(!data.account||!/^\d{10}$/.test(data.account.accountNumber)||!Number.isSafeInteger(data.account.balanceCents)||!Array.isArray(data.history))throw Error('The account response was incomplete.');
  bankAccount=data.account;
  balance=data.account.balanceCents/100;
  transactions=data.history.map(t=>({
    name:String(t.counterparty_name||'Customer'),
    detail:`Transfer · ${t.direction==='INCOMING'?'Incoming':'Outgoing'} · ${String(t.counterparty_account_number||'')}`,
    date:new Date(t.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
    amount:(t.direction==='INCOMING'?1:-1)*Number(t.amount_cents)/100,
    icon:t.direction==='INCOMING'?'↙':'↗'
  }));
  bankStatus='ready';bankError='';
}
async function loadBanking(){
  if(session?.mode!=='pingone'||!session.mfaReady)return;
  const signedIn=session;
  try{const data=await bankRequest('GET');if(session===signedIn)applyBankData(data)}
  catch(error){if(session===signedIn){bankStatus='error';bankError=error.message;bankAccount=null;transactions=[];balance=0}}
}

const originalBankSignout=signout;
signout=function(){bankAccount=null;bankStatus='loading';bankError='';originalBankSignout();transactions=bankInitialTransactions.slice();balance=bankInitialBalance};
const originalBankOverview=overview;
overview=function(){
  if(session?.mode!=='pingone')return originalBankOverview();
  const ready=bankStatus==='ready',accountNumber=ready?esc(bankAccount.accountNumber):'—';
  const masked=ready?`•••• ••${esc(bankAccount.accountNumber.slice(-4))}`:'•••• ••••';
  const status=bankStatus==='error'?`<p class="error" role="alert">${esc(bankError)}</p>`:'';
  return `<div class="heading"><div><div class="eyebrow muted">PERSONAL BANKING</div><h1>Hello, ${esc(session.user.given_name||name().split(' ')[0])}</h1><p>Welcome to your account.</p></div><button class="btn" data-transfer>↗ &nbsp; Transfer money</button></div>${status}
    <section class="cards" aria-label="Account overview" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">
      <div class="card balance"><span class="label">Everyday account · Available balance</span><div class="amount">${ready?money(balance):'—'}</div><div class="account">ACCOUNT ${accountNumber} &nbsp; <span style="float:right">PHP</span></div><button class="action" data-copy-account type="button" ${ready?'':'disabled'}>Copy account number</button></div>
      <div class="card virtual"><div class="section-head"><h2>Account card</h2></div><div class="virtual-card"><b>north bank <span style="float:right">◉</span></b><div class="number">${masked}</div><div class="row"><span>${esc(name().toUpperCase())}</span><span>ACCOUNT</span></div></div></div>
    </section>
    <div class="actions"><button class="action" data-transfer>↗ &nbsp; Make a transfer</button><button class="action" data-export>↓ &nbsp; Export activity</button><button class="action" data-bank-refresh type="button">↻ &nbsp; Refresh</button></div>
    <section class="card"><div class="section-head"><h2>Recent activity</h2><button class="action" id="view-all">View all →</button></div>${transactions.length?txTable(transactions.slice(0,5)):'<p class="muted">No transfers yet.</p>'}</section>`;
};
const originalBankActivity=activity;
activity=function(){
  if(session?.mode!=='pingone')return originalBankActivity();
  return `<div class="heading"><div><div class="eyebrow muted">${bankStatus==='ready'?`ACCOUNT ${esc(bankAccount.accountNumber)}`:'ACCOUNT'}</div><h1>Transactions</h1><p>Transfers sent and received on this account.</p></div><button class="btn secondary" data-export>↓ Export CSV</button></div>${bankStatus==='error'?`<p class="error" role="alert">${esc(bankError)}</p>`:''}<button class="action" data-bank-refresh type="button">↻ &nbsp; Refresh history</button><section class="card">${transactions.length?txTable(transactions):'<p class="muted">No transfers yet.</p>'}</section>`;
};
const originalBankRender=render;
render=function(){originalBankRender();document.querySelectorAll('[data-bank-refresh]').forEach(button=>button.onclick=async()=>{button.disabled=true;await loadBanking();render()});document.querySelectorAll('[data-copy-account]').forEach(button=>button.onclick=async()=>{if(!bankAccount)return;try{await navigator.clipboard.writeText(bankAccount.accountNumber);toast('Account number copied.')}catch{toast('Select the account number shown on the card to copy it.')}});if(session?.mode==='pingone'&&session.mfaReady&&bankStatus==='loading'){bankStatus='fetching';loadBanking().then(()=>render())}};

const originalBankTransfer=transfer;
transfer=function(){
  if(session?.mode!=='pingone')return originalBankTransfer();
  if(bankStatus!=='ready'){toast(bankError||'Your account is loading.');return}
  const dialog=document.createElement('dialog');
  dialog.innerHTML=`<h2>Transfer money</h2><p class="small muted">Enter another North Bank account number. Demo transfer; no real money moves.</p><form id="transfer-form"><label for="recipient">Recipient account number</label><input id="recipient" name="recipient" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required><label for="amount">Amount (PHP)</label><input id="amount" name="amount" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required><p class="error" id="bank-transfer-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" id="cancel-transfer" class="btn secondary">Cancel</button><button type="submit" class="btn">Transfer</button></div></form>`;
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('#cancel-transfer').onclick=()=>dialog.close();
  let requestId=crypto.randomUUID();
  dialog.querySelectorAll('input').forEach(input=>input.oninput=()=>{requestId=crypto.randomUUID()});
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]'),errorNode=form.querySelector('#bank-transfer-error');
    const recipientAccountNumber=String(new FormData(form).get('recipient')).trim(),amountText=String(new FormData(form).get('amount')).trim();
    const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(amountText);
    const amountCents=match?Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')):NaN;
    if(!/^\d{10}$/.test(recipientAccountNumber)||!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000||amountCents>bankAccount.balanceCents){errorNode.textContent='Enter a valid account and amount within your available balance.';errorNode.hidden=false;return}
    submit.disabled=true;errorNode.hidden=true;
    const signedIn=session;
    try{const data=await bankRequest('POST',{recipientAccountNumber,amountCents,requestId});if(session!==signedIn)return;applyBankData(data);dialog.close();render();toast('Transfer completed. Both account histories have been updated.')}
    catch(error){errorNode.textContent=error.message;errorNode.hidden=false;submit.disabled=false}
  };
  dialog.showModal();
};

