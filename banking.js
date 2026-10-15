// Shared demo accounts. The URL is public; the service key stays in Supabase.
const bankApiUrl='https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/bank-demo';
let bankAccount=null,bankStatus='loading',bankError='';
let bankHistory=[],statementFrom='',statementTo='';
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
function hasRecognizeEnrollment(){return session?.user?.recognizeEnrolled==='true'}
function recognizeFailureMessage(code,mode){
  const messages={
    MEDIA_DEVICES_EMPTY_VIDEO_INPUT_LABEL:'Allow camera access in your browser, then try again.',
    MEDIA_STREAM_NOT_ALLOWED:'Allow camera access in your browser, then try again.',
    MEDIA_DEVICES_NO_VIDEO_INPUTS:'No camera was found. Connect a camera, then try again.',
    MEDIA_STREAM_NOT_FOUND:'No camera was found. Connect a camera, then try again.',
    MEDIA_STREAM_NOT_READABLE:'Your camera is in use or unavailable. Close other camera apps, then try again.',
    SESSION_MEDIA_STREAM_TIMEOUT:'The face scan timed out. Try again in good lighting.',
    SERVER_RECOGNITION_FAILED:'Your face could not be confirmed. Try again in good lighting; contact support if it keeps happening.',
    SERVER_USER_LOCKED_OUT:'Face verification is temporarily locked. Contact support before trying again.',
    SERVER_FORBIDDEN:'The face verification session was rejected. Sign in again and retry.',
    SESSION_MANAGER_NOT_NULL:'The previous camera session did not close. Reload the page, then try again.',
  };
  return (messages[code]||`${mode==='enroll'?'Face setup':'Face verification'} did not finish. Please try again.`)+` (Code: ${code})`;
}
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
function bankTransaction(t){
  const occurredAt=new Date(t.created_at);
  return {
    name:String(t.counterparty_name||'Customer'),
    detail:`Transfer · ${t.direction==='INCOMING'?'Incoming':'Outgoing'} · ${String(t.counterparty_account_number||'')}`,
    referenceId:String(t.reference_id||''),
    runningBalance:Number(t.running_balance_cents)/100,
    date:occurredAt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Manila'}),
    time:occurredAt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZone:'Asia/Manila'})+' PHT',
    timestamp:t.created_at,
    amount:(t.direction==='INCOMING'?1:-1)*Number(t.amount_cents)/100,
    icon:t.direction==='INCOMING'?'↙':'↗'
  };
}
function statementDate(value){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function statementRange(){
  const today=statementDate(Date.now());
  return {from:statementFrom|| (bankHistory.length?statementDate(bankHistory[bankHistory.length-1].created_at):today),to:statementTo||today};
}
function statementRows(){
  const {from,to}=statementRange();
  return bankHistory.filter(t=>{const date=statementDate(t.created_at);return date>=from&&date<=to}).map(bankTransaction);
}
function applyBankData(data){
  if(!data.account||!/^\d{10}$/.test(data.account.accountNumber)||!Number.isSafeInteger(data.account.balanceCents)||!Array.isArray(data.history)||!data.history.every(t=>/^NB-\d{8}-\d{8,}$/.test(t.reference_id)&&Number.isSafeInteger(t.running_balance_cents)&&t.running_balance_cents>=0))throw Error('The account response was incomplete.');
  bankAccount=data.account;
  balance=data.account.balanceCents/100;
  bankHistory=data.history;
  transactions=bankHistory.map(bankTransaction);
  bankStatus='ready';bankError='';
}
async function loadBanking(){
  if(session?.mode!=='pingone'||!session.mfaReady)return;
  const signedIn=session;
  try{const data=await bankRequest('GET');if(session===signedIn)applyBankData(data)}
  catch(error){if(session===signedIn){bankStatus='error';bankError=error.message;bankAccount=null;bankHistory=[];transactions=[];balance=0}}
}

const originalBankSignout=signout;
signout=function(){bankAccount=null;bankStatus='loading';bankError='';bankHistory=[];statementFrom='';statementTo='';originalBankSignout();transactions=bankInitialTransactions.slice();balance=bankInitialBalance};
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
const originalBankStatements=statements;
statements=function(){
  if(session?.mode!=='pingone')return originalBankStatements();
  const ready=bankStatus==='ready',range=statementRange(),rows=ready?statementRows():[];
  return `<div class="heading"><div><div class="eyebrow muted">ACCOUNT ${ready?esc(bankAccount.accountNumber):'ACTIVITY'}</div><h1>Statements</h1><p>Select a date range to view and export your available transfers.</p></div></div>
    ${bankStatus==='error'?`<p class="error" role="alert">${esc(bankError)}</p>`:''}
    <section class="card statement-card"><form id="statement-range" class="statement-filters">
      <div><label for="statement-from">From</label><input id="statement-from" name="from" type="date" value="${esc(range.from)}" required></div>
      <div><label for="statement-to">To</label><input id="statement-to" name="to" type="date" value="${esc(range.to)}" required></div>
      <button class="btn secondary" type="submit" ${ready?'':'disabled'}>Apply dates</button>
    </form><p class="small muted">This page shows the latest ${bankHistory.length} available transfers. The export includes only transactions shown for your selected dates.${bankHistory.length>=100?' Older transfers are not available in this view.':''}</p>
    <div class="statement-summary"><span>${rows.length} transaction${rows.length===1?'':'s'} in this range</span><button id="statement-export" class="btn" type="button" ${rows.length?'':'disabled'}>↓ &nbsp; Download CSV</button></div>
    ${rows.length?txTable(rows):'<p class="muted">No transfers found for these dates.</p>'}</section>`;
};
render=function(){
  originalBankRender();
  document.querySelectorAll('[data-bank-refresh]').forEach(button=>button.onclick=async()=>{button.disabled=true;await loadBanking();render()});
  document.querySelectorAll('[data-copy-account]').forEach(button=>button.onclick=async()=>{if(!bankAccount)return;try{await navigator.clipboard.writeText(bankAccount.accountNumber);toast('Account number copied.')}catch{toast('Select the account number shown on the card to copy it.')}});
  document.querySelector('#statement-range')?.addEventListener('submit',event=>{
    event.preventDefault();
    const form=new FormData(event.target),from=String(form.get('from')),to=String(form.get('to'));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to){toast('Choose a valid date range.');return}
    statementFrom=from;statementTo=to;render();
  });
  document.querySelector('#statement-export')?.addEventListener('click',()=>{
    if(bankStatus!=='ready')return;
    const rows=statementRows();if(!rows.length)return;
    const {from,to}=statementRange(),url=URL.createObjectURL(new Blob([csvRows(rows)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`north-bank-${bankAccount.accountNumber}-${from}-to-${to}.csv`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Statement activity downloaded.');
  });
  if(session?.mode==='pingone'&&session.mfaReady&&bankStatus==='loading'){bankStatus='fetching';loadBanking().then(()=>render())}
};

const originalBankTransfer=transfer;
transfer=function(){
  if(session?.mode!=='pingone')return originalBankTransfer();
  if(bankStatus!=='ready'){toast(bankError||'Your account is loading.');return}
  const dialog=document.createElement('dialog');
  dialog.className='bank-transfer-dialog';
  dialog.setAttribute('aria-labelledby','transfer-title');
  dialog.innerHTML=`<div class="transfer-header"><span class="transfer-eyebrow">NORTH BANK TRANSFERS</span><h2 id="transfer-title">Transfer money</h2><p>Send to another North Bank account.</p></div><form id="transfer-form" class="transfer-form"><div class="transfer-field"><label for="recipient">Recipient account number</label><input id="recipient" name="recipient" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" autocomplete="off" placeholder="10-digit account number" required></div><div class="transfer-field"><label for="amount">Amount</label><div class="transfer-amount-input"><span aria-hidden="true">₱</span><input id="amount" name="amount" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="0.00" aria-label="Amount in Philippine pesos" required></div></div><p class="transfer-hint">Some transfers may require face verification before they are sent.</p><p class="error transfer-error" id="bank-transfer-error" role="alert" hidden></p><div class="transfer-footer"><button type="button" id="cancel-transfer" class="btn secondary">Cancel</button><button type="submit" class="btn">Send transfer</button></div></form>`;
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('#cancel-transfer').onclick=()=>dialog.close();
  let requestId=crypto.randomUUID();
  dialog.querySelectorAll('input').forEach(input=>input.oninput=()=>{requestId=crypto.randomUUID()});
  async function faceStep(payload){
    const form=dialog.querySelector('#transfer-form');
    form.hidden=true;
    dialog.querySelector(':scope > .transfer-header').hidden=true;
    dialog.setAttribute('aria-labelledby','recognize-title');
    const panel=document.createElement('section');
    panel.className='recognize-panel';
    panel.innerHTML=`<div class="transfer-header"><span class="transfer-eyebrow">ONE MORE SECURITY STEP</span><h3 id="recognize-title">Verify this transfer</h3><p>Confirm it is you before the transfer is sent.</p></div>
      <div class="transfer-summary"><div><span>Amount</span><strong id="recognize-amount"></strong></div><div><span>To account</span><strong id="recognize-recipient"></strong></div></div>
      <p class="recognize-prompt">Face verification</p>
      <div id="recognize-options" class="recognize-options">
        <button type="button" class="recognize-choice" id="recognize-verify"><span class="recognize-choice-icon" aria-hidden="true">◉</span><span><strong>Verify my face</strong><small>Use your camera to confirm this transfer.</small></span><span class="recognize-choice-arrow" aria-hidden="true">→</span></button>
        <div class="recognize-consent" id="recognize-setup"><strong>First time using face verification?</strong><p>Register your face with PingOne Recognize first. Your face will be linked to this account. Registration does not send the transfer; a second scan will confirm it.</p><label><input type="checkbox" id="recognize-consent"> I agree to register my face for this demo.</label><button type="button" class="btn" id="recognize-enroll" disabled>Register my face</button></div>
      </div>
      <div class="recognize-mfa" id="recognize-mfa" hidden><div class="recognize-mfa-notice"><strong>Use another way to verify</strong><p>Face verification could not be completed. Choose an enrolled PingOne method to approve this pending transfer.</p></div><div id="recognize-mfa-methods"></div><div id="recognize-mfa-action"></div></div>
      <p class="recognize-status" id="recognize-message" role="status"></p><div id="recognize-camera"></div><p class="error transfer-error" id="recognize-error" role="alert" hidden></p>
      <div class="transfer-footer recognize-footer"><button type="button" class="btn" id="recognize-mfa-switch" hidden>Use PingOne MFA instead</button><button type="button" class="btn secondary" id="recognize-cancel">Cancel transfer</button></div>`;
    dialog.append(panel);
    panel.querySelector('#recognize-amount').textContent=money(payload.amountCents/100);
    panel.querySelector('#recognize-recipient').textContent=payload.recipientAccountNumber;
    const setup=panel.querySelector('#recognize-setup'),verify=panel.querySelector('#recognize-verify');
    const enrolled=hasRecognizeEnrollment();
    setup.hidden=enrolled;verify.hidden=!enrolled;
    if(!enrolled){panel.querySelector('#recognize-title').textContent='Set up face verification';panel.querySelector('.recognize-prompt').textContent='Face registration'}
    panel.querySelector('#recognize-consent').onchange=event=>{panel.querySelector('#recognize-enroll').disabled=!event.target.checked};
    panel.querySelector('#recognize-cancel').onclick=()=>dialog.close();
    const message=panel.querySelector('#recognize-message'),failure=panel.querySelector('#recognize-error');
    const camera=panel.querySelector('#recognize-camera'),options=panel.querySelector('#recognize-options');
    let busy=false,usingMfa=false,faceFailures=0,activeScan=null,mfaState='',mfaFlow=null;
    const mfaPanel=panel.querySelector('#recognize-mfa'),mfaMethods=panel.querySelector('#recognize-mfa-methods'),mfaAction=panel.querySelector('#recognize-mfa-action');
    const mfaSwitch=panel.querySelector('#recognize-mfa-switch');
    mfaSwitch.onclick=()=>openMfa();
    dialog.addEventListener('close',()=>activeScan?.observer?.disconnect(),{once:true});
    const mfaLabels={TOTP:'Authenticator app',EMAIL:'Email code',FIDO2:'Passkey or security key',MOBILE:'PingID mobile app'};
    async function completeMfa(){
      message.textContent='Confirming PingOne verification and sending transfer…';
      const data=await bankRequest('POST',{...payload,action:'mfa-complete',mfaState});
      if(!dialog.open)return;
      applyBankData(data);dialog.close();render();toast('Transfer completed with PingOne MFA.');
    }
    function renderMfa(flow){
      const devices=flow.devices?.length?flow.devices:mfaFlow?.devices||[];
      mfaFlow={...flow,devices};mfaPanel.hidden=false;options.hidden=true;camera.replaceChildren();
      mfaMethods.innerHTML=devices.map(device=>`<button type="button" class="recognize-choice" data-mfa-device="${esc(device.id)}"><span class="recognize-choice-icon" aria-hidden="true">◈</span><span><strong>${esc(mfaLabels[device.type]||device.type)}</strong>${device.detail?`<small>${esc(device.detail)}</small>`:''}</span><span class="recognize-choice-arrow" aria-hidden="true">→</span></button>`).join('')||'<p>No enrolled PingOne methods are available. Cancel and contact your administrator.</p>';
      mfaMethods.querySelectorAll('[data-mfa-device]').forEach(button=>button.onclick=()=>mfaStep('select',{deviceId:button.dataset.mfaDevice}));
      mfaAction.replaceChildren();
      if(flow.status==='OTP_REQUIRED'){
        const form=document.createElement('form');form.className='recognize-mfa-code';
        form.innerHTML='<label for="transfer-mfa-code">Verification code</label><input id="transfer-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" required><button class="btn" type="submit">Verify and send transfer</button>';
        form.onsubmit=event=>{event.preventDefault();mfaStep('otp',{otp:form.querySelector('input').value.trim()})};mfaAction.append(form);
      }else if(flow.status==='ASSERTION_REQUIRED'){
        const button=document.createElement('button');button.className='btn';button.textContent='Continue with passkey';button.onclick=()=>usePasskey(flow);mfaAction.append(button);
      }else if(flow.status==='PUSH_CONFIRMATION_REQUIRED'){
        const button=document.createElement('button');button.className='btn';button.textContent='I approved the notification';button.onclick=()=>mfaStep('status',{});mfaAction.append(button);
      }
      if(flow.status==='COMPLETED')completeMfa().catch(showMfaError);
      else if(flow.status==='FAILED'||flow.status==='PUSH_CONFIRMATION_TIMED_OUT')showMfaError(Error('PingOne verification did not finish. Choose another method or cancel.'));
      else message.textContent='Choose or complete your PingOne verification method.';
    }
    function showMfaError(error){
      failure.textContent=error.message;failure.hidden=false;message.textContent='Your transfer has not been sent.';busy=false;
      if(!mfaState){
        mfaPanel.hidden=false;options.hidden=true;mfaMethods.textContent='Your PingOne methods could not be loaded.';
        mfaAction.innerHTML='<button type="button" class="btn secondary" id="retry-mfa">Try loading methods again</button>';
        mfaAction.querySelector('button').onclick=()=>openMfa();
      }
    }
    async function mfaStep(action,values){
      if(busy)return;busy=true;failure.hidden=true;message.textContent='Checking with PingOne…';
      try{const result=await bankRequest('POST',{...payload,action:'mfa-step',mfaAction:action,mfaState,...values});renderMfa(result.mfa)}
      catch(error){showMfaError(error)}finally{busy=false}
    }
    async function usePasskey(flow){
      try{
        const raw=JSON.parse(flow.publicKeyCredentialRequestOptions);
        const toBytes=value=>Array.isArray(value)?Uint8Array.from(value):decode(value);
        const toBase64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
        raw.challenge=toBytes(raw.challenge);
        raw.allowCredentials=(raw.allowCredentials||[]).map(item=>({...item,id:toBytes(item.id)}));
        const credential=await navigator.credentials.get({publicKey:raw});
        if(!credential)throw Error('Passkey verification was cancelled.');
        const response=credential.response;
        const assertion=JSON.stringify({id:credential.id,type:credential.type,rawId:toBase64(credential.rawId),response:{clientDataJSON:toBase64(response.clientDataJSON),authenticatorData:toBase64(response.authenticatorData),signature:toBase64(response.signature),userHandle:response.userHandle?toBase64(response.userHandle):null},clientExtensionResults:credential.getClientExtensionResults()});
        await mfaStep('assertion',{assertion});
      }catch(error){showMfaError(error)}
    }
    async function openMfa(preserveFaceError=false){
      if(!dialog.open||(usingMfa&&busy))return;
      usingMfa=true;busy=true;activeScan?.observer?.disconnect();mfaSwitch.hidden=true;failure.hidden=!preserveFaceError;options.hidden=true;camera.replaceChildren();
      panel.querySelector('#recognize-title').textContent='Verify this transfer';
      panel.querySelector('.recognize-prompt').textContent='PingOne MFA';
      mfaPanel.querySelector('p').textContent=enrolled
        ?'Choose an enrolled PingOne method to approve this pending transfer.'
        :'Face registration can be completed later. Choose an enrolled PingOne method to approve this pending transfer.';
      mfaPanel.hidden=false;mfaMethods.textContent='Loading your enrolled PingOne methods…';mfaAction.replaceChildren();
      message.textContent='Loading your PingOne methods…';
      mfaPanel.scrollIntoView({block:'nearest'});
      try{const result=await bankRequest('POST',{...payload,action:'mfa-start'});mfaState=result.state;renderMfa(result)}
      catch(error){showMfaError(error)}finally{busy=false}
    }
    function faceFailed(error,keepCamera=false,scan=activeScan){
      if(usingMfa||!dialog.open)return;
      if(scan&&scan!==activeScan)return;
      if(scan?.failureRecorded)return;
      if(scan)scan.failureRecorded=true;
      faceFailures++;busy=false;panel.classList.remove('recognize-busy');
      if(faceFailures>=3){
        scan?.observer?.disconnect();camera.replaceChildren();options.hidden=true;
        failure.textContent='Face verification could not be completed after three attempts. You can use an enrolled PingOne MFA method to approve this transfer.';
        failure.hidden=false;message.textContent='Your transfer has not been sent.';
        mfaSwitch.hidden=false;mfaSwitch.focus();mfaSwitch.scrollIntoView({block:'nearest'});
        return;
      }
      failure.textContent=`Face attempt ${faceFailures} of 3 did not finish. ${3-faceFailures} ${faceFailures===2?'attempt':'attempts'} left before PingOne MFA becomes available.`;
      failure.hidden=false;message.textContent=error.message;
      if(!keepCamera){scan?.observer?.disconnect();camera.replaceChildren();options.hidden=false}
    }
    async function start(mode){
      if(busy||usingMfa||faceFailures>=3||!dialog.open)return;
      activeScan?.observer?.disconnect();activeScan=null;camera.replaceChildren();
      busy=true;failure.hidden=true;options.hidden=true;message.textContent='Opening camera…';panel.classList.add('recognize-busy');
      try{
        const refreshed=await bankRequest('POST',{...payload,action:'recognize-challenge'});
        const challenge=refreshed.recognize;
        if(!challenge?.authorizationToken)throw Error('Face verification could not start.');
        await loadRecognizeSdk();
        if(!dialog.open||usingMfa)return;
        const component=document.createElement(mode==='enroll'?'kl-enroll':'kl-auth');
        const service=challenge.serviceUrl.replace(/\/$/,'');
        component.setAttribute('customer',challenge.customer);
        component.setAttribute('username',challenge.username);
        component.setAttribute('authorization-token',challenge.authorizationToken);
        component.setAttribute('service-url',service);
        component.setAttribute('ws-url',service.replace(/^https:/,'wss:'));
        component.setAttribute('transaction-data',mode==='enroll'
          ?(challenge.enrollmentTransactionData||JSON.stringify({type:'face-enrollment',username:challenge.username}))
          :challenge.transactionData);
        component.setAttribute('lang','en');
        component.setAttribute('theme','light');
        component.setAttribute('size','375');
        component.setAttribute('enable-camera-instructions','');
        let settled=false;
        const scan={failureRecorded:false,retryVisible:false,observer:null,component};
        activeScan=scan;
        // The documented Retry slot lets North Bank count failures that the SDK handles internally.
        const retryButton=document.createElement('button');
        retryButton.type='button';retryButton.slot='button-retry';retryButton.className='btn recognize-sdk-retry';
        retryButton.textContent='Retry face scan';
        retryButton.onclick=event=>{event.stopPropagation();if(!usingMfa&&faceFailures<3)start(mode)};
        component.append(retryButton);
        component.addEventListener('error',event=>{
          if(!dialog.open||usingMfa||activeScan!==scan||settled)return;
          settled=true;
          const code=typeof event.message==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(event.message)?event.message:'UNKNOWN';
          faceFailed(Error(recognizeFailureMessage(code,mode)),false,scan);
        },{once:true});
        component.addEventListener('success',async event=>{
          if(!dialog.open||usingMfa||activeScan!==scan||settled)return;
          settled=true;
          const proof=event.detail?.jwt;
          scan.observer?.disconnect();camera.replaceChildren();
          if(mode==='enroll'){
            if(typeof proof!=='string'){faceFailed(Error('Face registration did not return a confirmation.'));return}
            message.textContent='Confirming face registration…';
            try{
              const result=await bankRequest('POST',{
                action:'recognize-enrollment-complete',recipientAccountNumber:'',amountCents:0,requestId:'',
                transferContext:payload,enrollmentJwt:proof,
              });
              if(result.recognizeEnrolled!==true)throw Error('Face registration could not be confirmed.');
              session.user.recognizeEnrolled='true';setup.hidden=true;verify.hidden=false;
            }catch(error){faceFailed(error);return}
            faceFailures=0;busy=false;
            panel.classList.remove('recognize-busy');options.hidden=false;
            panel.querySelector('#recognize-title').textContent='Verify this transfer';
            panel.querySelector('.recognize-prompt').textContent='Face verification';
            verify.querySelector('strong').textContent='Continue to verify transfer';
            message.textContent='Face registration is complete. A separate face scan will approve this transfer.';
            return;
          }
          if(typeof proof!=='string'){faceFailed(Error('Face verification did not return a confirmation. Please try again.'));return}
          message.textContent='Confirming transfer…';
          try{const data=await bankRequest('POST',{...payload,recognizeJwt:proof});if(!dialog.open)return;if(data.recognizeEnrollmentRecorded===true)session.user.recognizeEnrolled='true';applyBankData(data);dialog.close();render();toast(data.recognizeEnrollmentRecorded===false&&session.user.recognizeEnrolled!=='true'?'Transfer completed. Your face enrollment badge is pending.':'Transfer completed.')}
          catch(error){faceFailed(error)}
        },{once:true});
        camera.append(component);panel.classList.remove('recognize-busy');message.textContent=mode==='enroll'?'Set up face verification with your camera.':'Follow the camera instructions to confirm your transfer.';
        if(typeof ResizeObserver!=='undefined'){
          const checkRetry=()=>{
            if(!dialog.open||usingMfa||activeScan!==scan)return;
            const visible=retryButton.getClientRects().length>0;
            if(visible&&!scan.retryVisible){scan.retryVisible=true;faceFailed(Error('The face scan did not finish.'),true,scan)}
            else if(!visible&&scan.retryVisible){scan.retryVisible=false;scan.failureRecorded=false;failure.hidden=true}
          };
          scan.observer=new ResizeObserver(checkRetry);
          scan.observer.observe(retryButton);
          requestAnimationFrame(checkRetry);
        }
      }catch(error){faceFailed(error)}
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
    submit.disabled=true;submit.textContent='Processing…';errorNode.hidden=true;
    const signedIn=session;
    const payload={recipientAccountNumber,amountCents,requestId};
    try{const data=await bankRequest('POST',payload);if(session!==signedIn)return;applyBankData(data);dialog.close();render();toast('Transfer completed. Both account histories have been updated.')}
    catch(error){if(error.code==='RECOGNIZE_REQUIRED'){await faceStep(payload);return}errorNode.textContent=error.message;errorNode.hidden=false;submit.disabled=false;submit.textContent='Send transfer'}
  };
  dialog.showModal();
};

