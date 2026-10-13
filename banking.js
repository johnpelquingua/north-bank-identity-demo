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
  if(!result.ok){const error=Error(data.error||'The transfer service is unavailable.');error.code=data.code;error.recognize=data.recognize;throw error}
  return data;
}

let recognizeSdkPromise;
function loadRecognizeSdk(){
  if(recognizeSdkPromise)return recognizeSdkPromise;
  recognizeSdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.type='module';
    script.src='https://d3hz8ozgrmhn4r.cloudfront.net/sdk-web-components/3.1.0/index.js';
    script.integrity='sha512-rPLFDZgz3yyuaZuIjt9Y/lwlVqz0Pr8z55BAPcAGy6Y8SVstOuBz1ubA3kt0Mn1X8hDE5eaihUvocgx3NEpv0w==';
    script.crossOrigin='anonymous';
    script.onerror=()=>reject(Error('Face verification could not load. Try again.'));
    script.onload=()=>customElements.whenDefined('kl-auth').then(resolve,reject);
    document.head.append(script);
  }).catch(error=>{recognizeSdkPromise=null;throw error});
  return recognizeSdkPromise;
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
  async function faceStep(payload,firstChallenge){
    const form=dialog.querySelector('#transfer-form');
    form.hidden=true;
    const panel=document.createElement('section');
    panel.innerHTML='<h3>Confirm this transfer</h3><p class="small">Use your camera to verify your identity before the transfer is sent.</p><p class="small" id="recognize-message" role="status"></p><div id="recognize-options" class="dialog-actions"><button type="button" class="btn" id="recognize-verify">Verify my face</button><button type="button" class="btn secondary" id="recognize-enroll">First time? Set up face verification</button></div><div id="recognize-camera"></div><p class="error" id="recognize-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="btn secondary" id="recognize-cancel">Cancel transfer</button></div>';
    dialog.append(panel);
    const summary=document.createElement('p');
    summary.className='small';
    summary.textContent=money(payload.amountCents/100)+' to account '+payload.recipientAccountNumber;
    panel.querySelector('h3').after(summary);
    panel.querySelector('#recognize-cancel').onclick=()=>dialog.close();
    const message=panel.querySelector('#recognize-message'),failure=panel.querySelector('#recognize-error');
    const camera=panel.querySelector('#recognize-camera'),options=panel.querySelector('#recognize-options');
    let challenge=firstChallenge,busy=false;
    async function start(mode){
      if(busy||!dialog.open)return;
      busy=true;failure.hidden=true;options.hidden=true;message.textContent='Opening camera…';
      try{
        await loadRecognizeSdk();
        if(!dialog.open)return;
        camera.replaceChildren();
        const component=document.createElement(mode==='enroll'?'kl-enroll':'kl-auth');
        const service=challenge.serviceUrl.replace(/\/$/,'');
        component.setAttribute('customer',challenge.customer);
        component.setAttribute('username',challenge.username);
        component.setAttribute('authorization-token',challenge.authorizationToken);
        component.setAttribute('service-url',service);
        component.setAttribute('ws-url',service.replace(/^https:/,'wss:'));
        component.setAttribute('transaction-data',mode==='enroll'
          ?JSON.stringify({type:'face-enrollment',username:challenge.username})
          :challenge.transactionData);
        component.setAttribute('lang','en');
        component.setAttribute('theme','light');
        component.setAttribute('size','375');
        component.setAttribute('enable-camera-instructions','');
        component.addEventListener('error',event=>{
          if(!dialog.open)return;
          failure.textContent=mode==='enroll'?'Face setup did not finish. Please try again.':'Face verification did not finish. Please try again.';
          failure.hidden=false;options.hidden=false;camera.replaceChildren();busy=false;
        },{once:true});
        component.addEventListener('success',async event=>{
          if(!dialog.open)return;
          const proof=event.detail?.jwt;
          camera.replaceChildren();
          if(mode==='enroll'){
            message.textContent='Face setup complete. Now confirm this transfer with a new face check.';
            try{await bankRequest('POST',payload);message.textContent='This transfer no longer needs a face check.';dialog.close();await loadBanking();render();toast('Transfer completed.')}
            catch(error){
              if(error.code==='RECOGNIZE_REQUIRED'&&error.recognize){challenge=error.recognize;busy=false;await start('auth')}
              else{failure.textContent=error.message;failure.hidden=false;options.hidden=false;busy=false}
            }
            return;
          }
          if(typeof proof!=='string'){failure.textContent='Face verification did not return a confirmation. Please try again.';failure.hidden=false;options.hidden=false;busy=false;return}
          message.textContent='Confirming transfer…';
          try{const data=await bankRequest('POST',{...payload,recognizeJwt:proof});if(!dialog.open)return;applyBankData(data);dialog.close();render();toast('Transfer completed.')}
          catch(error){failure.textContent=error.message;failure.hidden=false;options.hidden=false;busy=false}
        },{once:true});
        camera.append(component);message.textContent=mode==='enroll'?'Set up face verification with your camera.':'Follow the camera instructions to confirm your transfer.';
      }catch(error){failure.textContent=error.message;failure.hidden=false;options.hidden=false;busy=false}
    }
    panel.querySelector('#recognize-verify').onclick=()=>start('auth');
    panel.querySelector('#recognize-enroll').onclick=()=>start('enroll');
  }
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]'),errorNode=form.querySelector('#bank-transfer-error');
    const recipientAccountNumber=String(new FormData(form).get('recipient')).trim(),amountText=String(new FormData(form).get('amount')).trim();
    const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(amountText);
    const amountCents=match?Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')):NaN;
    if(!/^\d{10}$/.test(recipientAccountNumber)||!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000||amountCents>bankAccount.balanceCents){errorNode.textContent='Enter a valid account and amount within your available balance.';errorNode.hidden=false;return}
    submit.disabled=true;errorNode.hidden=true;
    const signedIn=session;
    const payload={recipientAccountNumber,amountCents,requestId};
    try{const data=await bankRequest('POST',payload);if(session!==signedIn)return;applyBankData(data);dialog.close();render();toast('Transfer completed. Both account histories have been updated.')}
    catch(error){if(error.code==='RECOGNIZE_REQUIRED'&&error.recognize){await faceStep(payload,error.recognize);return}errorNode.textContent=error.message;errorNode.hidden=false;submit.disabled=false}
  };
  dialog.showModal();
};

