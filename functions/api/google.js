// OAuth secrets remain in Supabase. The browser receives only an HttpOnly session.
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function onRequest({request,env}){
 const url=new URL(request.url);
 const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 const options=`Path=/api; HttpOnly; SameSite=Lax${url.protocol==='https:'?'; Secure':''}`;
 const clear=()=>headers.append('Set-Cookie',`cci_oauth=; Max-Age=0; ${options}`);
 const finish=error=>{clear();headers.set('Location',`${url.origin}/admin/${error?'?signin_error='+error:''}`);return new Response(null,{status:303,headers})};
 if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers});
 if(env.GOOGLE_SIGN_IN_ENABLED!=='true'||!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return new Response('Google sign-in is not available yet.',{status:503,headers});
 if(url.searchParams.has('error'))return finish('google');
 const code=url.searchParams.get('code');
 if(!code){
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const auth=new URL(env.SUPABASE_URL+'/auth/v1/authorize');
  auth.search=new URLSearchParams({provider:'google',redirect_to:url.origin+'/api/google',code_challenge:challenge,code_challenge_method:'s256',scopes:'openid email profile',prompt:'select_account'}).toString();
  headers.set('Location',auth.href);headers.append('Set-Cookie',`cci_oauth=${verifier}; Max-Age=600; ${options}`);
  return new Response(null,{status:303,headers});
 }
 const verifier=(request.headers.get('Cookie')||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('cci_oauth='))?.slice(10);
 if(!/^[A-Za-z0-9_-]{64}$/.test(verifier||'')||code.length>500)return finish('expired');
 try{
  const exchange=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier})});
  if(!exchange.ok)return finish('google');
  const session=await exchange.json();
  if(!/^[A-Za-z0-9._-]+$/.test(session.access_token||''))return finish('google');
  const access=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/admin_snapshot',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});
  if(!access.ok)return finish('unapproved');
  const snapshot=await access.json();
  if(!['owner','finance','viewer'].includes(snapshot.role))return finish('unapproved');
  const claims=JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
  const ttl=Math.max(0,Math.min(3600,Math.floor(Number(claims.exp)-Date.now()/1000)));
  if(!ttl)return finish('expired');
  headers.append('Set-Cookie',`cci_session=${session.access_token}; Max-Age=${ttl}; Path=/api; HttpOnly; SameSite=Strict${url.protocol==='https:'?'; Secure':''}`);
  return finish();
 }catch{return finish('google')}
}
