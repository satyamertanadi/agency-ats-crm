import {useState,type FormEvent} from 'react'
import {Link,Navigate,useNavigate,useSearchParams} from 'react-router-dom'
import {LogIn} from 'lucide-react'
import {supabase} from '../../shared/lib/supabase'
import {env} from '../../shared/lib/env'
import {Button} from '../../shared/ui/Button'
import {Field,Input} from '../../shared/ui/Field'
import {useAuth} from '../../app/AuthProvider'

function AuthFrame({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){return <main className="auth-page"><section className="auth-brand"><p className="eyebrow">Recruitment operating system</p><div className="auth-product-title" aria-hidden="true">{env.productName}</div><p>One secure workspace for candidates, clients, jobs, submissions, placements, and revenue.</p></section><section className="auth-card"><h1>{title}</h1><p>{subtitle}</p>{children}</section></main>}
function safeNext(value:string|null){return value?.startsWith('/')&&!value.startsWith('//')?value:'/app'}

export function LoginPage(){
  const {user}=useAuth();const navigate=useNavigate();const [params]=useSearchParams();const next=safeNext(params.get('next'))
  const [email,setEmail]=useState(env.allowPasswordAuth?'owner@northstar.local':'');const [password,setPassword]=useState(env.allowPasswordAuth?'LocalTest!123':'');const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  if(user)return <Navigate to={next} replace/>
  async function googleLogin(){setBusy(true);setError('');const {error:oauthError}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${window.location.origin}${next}`,scopes:'openid email profile'}});if(oauthError){setError(oauthError.message);setBusy(false)}}
  async function passwordLogin(event:FormEvent){event.preventDefault();setBusy(true);setError('');const result=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(result.error)setError(result.error.message);else navigate(next)}
  return <AuthFrame title="Welcome back" subtitle="Use the exact Google account invited to your agency workspace."><div className="stack"><Button disabled={busy} leadingIcon={<LogIn size={17}/>} onClick={()=>void googleLogin()}>{busy?'Opening Google…':'Continue with Google'}</Button><p className="muted auth-security-note">Access requires an active invitation or membership. Google proves your identity; workspace permissions control your data.</p></div>{env.allowPasswordAuth&&<><div className="auth-divider"><span>Local development</span></div><form onSubmit={passwordLogin} className="stack"><Field label="Email"><Input type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required autoComplete="email"/></Field><Field label="Password"><Input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} required autoComplete="current-password"/></Field><Button variant="secondary" disabled={busy}>Sign in locally</Button></form><div className="auth-links"><Link to="/reset-password">Reset local password</Link>{env.allowSelfServiceOnboarding&&<Link to="/signup">Create local account</Link>}</div></>}{error&&<p className="form-error" role="alert">{error}</p>}</AuthFrame>
}

export function SignupPage(){
  const navigate=useNavigate();const [name,setName]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('')
  if(!env.allowPasswordAuth||!env.allowSelfServiceOnboarding)return <Navigate to="/login" replace/>
  async function submit(event:FormEvent){event.preventDefault();const {error:signError}=await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});if(signError)setError(signError.message);else navigate('/onboarding')}
  return <AuthFrame title="Create a local account" subtitle="Self-service signup is available only in explicitly enabled development environments."><form onSubmit={submit} className="stack"><Field label="Full name"><Input value={name} onChange={(event)=>setName(event.target.value)} required/></Field><Field label="Work email"><Input type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required/></Field><Field label="Password"><Input type="password" minLength={12} value={password} onChange={(event)=>setPassword(event.target.value)} required/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<Button>Create account</Button></form><div className="auth-links"><Link to="/login">Back to sign in</Link></div></AuthFrame>
}

export function ResetPasswordPage(){
  const [email,setEmail]=useState('');const [sent,setSent]=useState(false);const [error,setError]=useState('')
  if(!env.allowPasswordAuth)return <Navigate to="/login" replace/>
  async function submit(event:FormEvent){event.preventDefault();const {error:resetError}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/reset-password`});if(resetError)setError(resetError.message);else setSent(true)}
  return <AuthFrame title="Reset local password" subtitle="Production team members sign in through Google.">{sent?<p className="success-box">Check your inbox for the recovery link.</p>:<form onSubmit={submit} className="stack"><Field label="Email"><Input type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<Button>Send recovery link</Button></form>}<div className="auth-links"><Link to="/login">Back to sign in</Link></div></AuthFrame>
}

export function OnboardingPage(){
  const {user}=useAuth();const navigate=useNavigate();const [name,setName]=useState('');const [slug,setSlug]=useState('');const [currency,setCurrency]=useState('USD');const [error,setError]=useState('')
  if(!user)return <Navigate to="/login"/>;if(!env.allowSelfServiceOnboarding)return <Navigate to="/access-pending" replace/>
  async function submit(event:FormEvent){event.preventDefault();const {error:rpcError}=await supabase.rpc('create_organization',{p_name:name,p_slug:slug,p_currency:currency,p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});if(rpcError)setError(rpcError.message);else{localStorage.setItem('agency_active_org',slug);navigate('/app',{replace:true})}}
  return <AuthFrame title="Create a development workspace" subtitle="Production workspaces are provisioned through the controlled launch process."><form onSubmit={submit} className="stack"><Field label="Agency name"><Input value={name} onChange={(event)=>{setName(event.target.value);setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))}} required/></Field><Field label="Workspace slug"><Input value={slug} onChange={(event)=>setSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/></Field><Field label="Base currency"><Input value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())} maxLength={3} required/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<Button>Create workspace</Button></form></AuthFrame>
}

export function AccessPendingPage(){const {user,signOut}=useAuth();if(!user)return <Navigate to="/login" replace/>;return <AuthFrame title="Access not active" subtitle="This Google account does not have an active agency membership."><div className="stack"><p>Signed in as <strong>{user.email}</strong>.</p><p className="muted">Ask the workspace owner to invite this exact email address, then open the invitation link. No recruitment data is available until membership is active.</p><Button variant="secondary" onClick={()=>void signOut()}>Sign out</Button></div></AuthFrame>}
