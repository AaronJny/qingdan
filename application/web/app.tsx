import NativeStorageFailureNotice from'./native-storage-failure-notice';
import{translateError as translateMessage}from"../lib/i18n";
import{t as tr}from'../lib/i18n';
import{LanguageSelect,useLanguageRuntime}from'../lib/i18n-react';
import React,{useEffect,useState}from'react';
import Workspace from'../app/workspace';
import DesktopConnectionPanel from'../app/desktop-connection';
import{configureSession,api}from'../lib/client';import{invalidateOfflineSession}from'../lib/offline-session';
import type{Bootstrap}from'../lib/types';
export function App(){useLanguageRuntime();const[user,setUser]=useState<Bootstrap['user']|null>(null);const[loading,setLoading]=useState(true);const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;const denied=()=>{configureSession('');setUser(null)};window.addEventListener('qingdan-account-changed',denied);api('/api/auth/me').then(async data=>{if(!live)return;if(!data.user){await invalidateOfflineSession('authenticated-session-missing');if(!live)return;}configureSession(data.csrfToken||'');setUser(data.user?{...data.user,mode:data.mode}:null)}).catch(e=>{if(live&&e.status!==401)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false;window.removeEventListener('qingdan-account-changed',denied)}},[]);
 const login=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const data=await api('/api/auth/login',{email,password});configureSession(data.csrfToken);setPassword('');setUser({...data.user,mode:data.mode})}catch(e){setError((e as Error).message)}finally{setPassword('');setBusy(false)}};
 if(loading)return <><NativeStorageFailureNotice/><main className="signin" aria-busy="true"><div className="signin-card"><p>{tr("app.loading")}</p><DesktopConnectionPanel compact/></div></main></>;
 if(user)return <><NativeStorageFailureNotice/><Workspace key={user.userId} user={user}/></>;
 return <><NativeStorageFailureNotice/><main className="signin"><form className="signin-card local-signin" onSubmit={login}><div className="brand-logo"><img src="/favicon.svg" alt="" aria-hidden="true"/></div><h1>{tr("app.name")}</h1><LanguageSelect/><DesktopConnectionPanel compact mode="accounts"/><label>{tr("auth.email")}<input aria-label={tr("auth.emailLabel")} type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label><label>{tr("auth.password")}<input aria-label={tr("auth.passwordLabel")} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>{error&&<p className="inline-error" role="alert">{translateMessage(error)}</p>}<button className="primary signin-button" type="submit" disabled={busy}>{busy?tr("auth.signingIn"):tr("auth.signIn")}</button></form></main></>}

