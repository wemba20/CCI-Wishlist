const json=(b,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store'}});
export function validateSubmission(b){const n=Number(b.amount_cents);if(!['payment','pledge'].includes(b.kind)||!Number.isSafeInteger(n)||n<100||n>100000000)throw Error('Enter a valid amount.');const c={kind:b.kind,amount_cents:n,project_id:String(b.project_id||''),donor_name:String(b.donor_name||'').trim(),email:String(b.email||'').trim(),note:String(b.note||'').trim(),payment_reference:String(b.payment_reference||'').trim(),payment_date:b.payment_date||null,submission_key:b.submission_key,pledge_reference:String(b.pledge_reference||'').trim()};if(!/^[a-z0-9-]{1,60}$/.test(c.project_id)||c.donor_name.length<2||c.donor_name.length>100||c.email.length>254||c.note.length>500||c.payment_reference.length>150||c.pledge_reference.length>80||!/^[-a-f0-9]{36}$/i.test(c.submission_key||''))throw Error('Check your details.');if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw Error('Enter a valid email.');if(c.kind==='payment'&&(!/^\d{4}-\d{2}-\d{2}$/.test(c.payment_date||'')||!Number.isFinite(Date.parse(c.payment_date))||c.payment_date>new Date().toISOString().slice(0,10)||!c.payment_reference))throw Error('Enter the payment date and Tithely transaction reference.');return c}
export async function onRequest({request,env,params}){
 const path=Array.isArray(params.path)?params.path.join('/'):params.path||'';
 const localTest=env.LOCAL_TESTING==='true'&&['127.0.0.1','localhost'].includes(new URL(request.url).hostname);
 const testKeys=String(env.TURNSTILE_SITE_KEY||'').startsWith('1x000000');
 const ready=(!testKeys||localTest)&&Boolean(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVICE_ROLE_KEY&&env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY);
 const configResponse=testMode=>json({ready,submissionsEnabled:ready&&(env.SUBMISSIONS_ENABLED==='true'||testMode),testMode,googleSignInEnabled:env.GOOGLE_SIGN_IN_ENABLED==='true',supabaseUrl:env.SUPABASE_URL||'',publishableKey:env.SUPABASE_ANON_KEY||'',turnstileSiteKey:env.TURNSTILE_SITE_KEY||''});
 if(path==='config'&&!ready)return configResponse(false);
 if(!ready)return json({error:'The shared database is not connected yet. Submissions are disabled.'},503);
 const cookieToken=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('cci_session='))?.slice(12);
 const authorization=request.headers.get('Authorization')||(cookieToken?'Bearer '+cookieToken:'');
 const cookieOptions=`Path=/api; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}`;
 const db=async(name,body={},privileged=false)=>{const key=privileged?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;const r=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,...(privileged&&key.startsWith('eyJ')?{Authorization:`Bearer ${key}`} :!privileged&&authorization?{Authorization:authorization} :{}),'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok){const e=Error(result.message||'Database request failed.');e.status=r.status;throw e}return result};
 const canTest=async()=>{if(env.ADMIN_TESTING!=='true'||!authorization.startsWith('Bearer '))return false;try{return ['owner','finance'].includes((await db('admin_snapshot')).role)}catch{return false}};
 try{
  if(request.method==='GET'&&path==='config')return configResponse(env.SUBMISSIONS_ENABLED!=='true'&&await canTest());
  if(request.method==='GET'&&path==='totals')return json(await db('public_project_totals'));
  if(request.method==='GET'&&path==='admin'){if(!authorization.startsWith('Bearer '))return json({error:'Sign in to continue.'},401);return json(await db('admin_snapshot'))}
  if(request.method==='POST'){
   if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Request origin not allowed.'},403);
   if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON required.'},415);
   const raw=await request.text();if(raw.length>12000)return json({error:'Request too large.'},413);const b=JSON.parse(raw);
   if(path==='logout'){const response=json({ok:true});response.headers.set('Set-Cookie',`cci_session=; Max-Age=0; ${cookieOptions}`);return response}
   if(path==='password'){
    if(!authorization.startsWith('Bearer '))return json({error:'Sign in before setting your password.'},401);
    await db('admin_snapshot');
    if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)return json({error:'Use a password between 12 and 128 characters.'},400);
    const result=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{method:'PUT',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({password:b.password})});
    if(!result.ok){const error=await result.json();return json({error:error.msg||error.message||'Password could not be saved. Sign in again and retry.'},400)}
    return json({ok:true});
   }
   if(path==='session'){if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))return json({error:'Invalid session.'},401);await db('admin_snapshot');const jwt=authorization.slice(7);const claims=JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));const ttl=Math.max(0,Math.min(3600,Math.floor(Number(claims.exp)-Date.now()/1000)));if(!ttl)return json({error:'Session expired.'},401);const response=json({ok:true});response.headers.set('Set-Cookie',`cci_session=${jwt}; Max-Age=${ttl}; ${cookieOptions}`);return response}

   if(path==='submit'){
    const testMode=env.SUBMISSIONS_ENABLED!=='true';
    if(testMode&&!await canTest())return json({error:'Submissions are not open yet.'},503);
    const clean=validateSubmission(b);
    if(testMode&&(!clean.donor_name.startsWith('TEST ')||!clean.payment_reference.startsWith('TEST-')&&clean.kind==='payment'))return json({error:'Administrator testing requires a name beginning TEST and a payment reference beginning TEST-.'},400);
    const v=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:b.turnstileToken,remoteip:request.headers.get('CF-Connecting-IP')})}).then(r=>r.json());
    if(!v.success||(!localTest&&(v.hostname!==new URL(request.url).hostname||v.action!=='giving')))return json({error:'Please complete the security check again.'},400);
    return json(await db('create_submission',{payload:clean},true),201);
   }
   if(path==='review')return json(await db('review_submission',{report_id:b.id,new_status:b.status,verified_reference:b.reference||'',review_note:b.note||''}));
  }
  return json({error:'Not found.'},404);
 }catch(e){return json({error:e.status===401?'Session expired. Sign in again.':e.message||'Please try again.'},e.status===401?401:e.status>=500?503:400)}
}
