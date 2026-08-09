import { lazy,Suspense } from 'react'
import { Navigate,Route,Routes,useLocation,useParams } from 'react-router'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { AppShell } from './AppShell'
import { ErrorState,LoadingState } from '../shared/ui/States'
import { AccessPendingPage,LoginPage,OnboardingPage,ResetPasswordPage,SignupPage } from '../features/auth/AuthPages'
import { InvitePage } from '../features/auth/InvitePage'
import { env } from '../shared/lib/env'
import {useWorkspaceCapabilities} from './useWorkspaceCapabilities'
import type {WorkspaceCapabilities} from '../shared/types/domain'
import {RouteErrorBoundary} from './AppErrorBoundary'

const TodayPage=lazy(()=>import('../features/dashboard/TodayPage').then((module)=>({default:module.TodayPage})))
const CandidatesPage=lazy(()=>import('../features/candidates/CandidatesPage').then((module)=>({default:module.CandidatesPage})))
const CandidateDetailPage=lazy(()=>import('../features/candidates/CandidateDetailPage').then((module)=>({default:module.CandidateDetailPage})))
const JobsPage=lazy(()=>import('../features/jobs/JobsPage').then((module)=>({default:module.JobsPage})))
const JobWorkspacePage=lazy(()=>import('../features/jobs/JobWorkspacePage').then((module)=>({default:module.JobWorkspacePage})))
const ClientsPage=lazy(()=>import('../features/clients/ClientsPage').then((module)=>({default:module.ClientsPage})))
const CompanyDetailPage=lazy(()=>import('../features/core/RecordDetailPages').then((module)=>({default:module.CompanyDetailPage})))
const ContactDetailPage=lazy(()=>import('../features/core/RecordDetailPages').then((module)=>({default:module.ContactDetailPage})))
const PublicReviewPage=lazy(()=>import('../features/submissions/PublicReviewPage').then((module)=>({default:module.PublicReviewPage})))
const PlacementsPage=lazy(()=>import('../features/placements/PlacementsPage').then((module)=>({default:module.PlacementsPage})))
const SettingsPage=lazy(()=>import('../features/settings/SettingsPage').then((module)=>({default:module.SettingsPage})))
const ReportsPage=lazy(()=>import('../features/reports/ReportsPage').then((module)=>({default:module.ReportsPage})))
const ScorecardPage=lazy(()=>import('../features/reports/ScorecardPage').then((module)=>({default:module.ScorecardPage})))
const ImportsPage=lazy(()=>import('../features/imports/ImportsPage').then((module)=>({default:module.ImportsPage})))
const TemplatesPage=lazy(()=>import('../features/templates/TemplatesPage').then((module)=>({default:module.TemplatesPage})))
const AdminCenterPage=lazy(()=>import('../features/settings/AdminCenterPage').then((module)=>({default:module.AdminCenterPage})))
const PersonalSettingsPage=lazy(()=>import('../features/settings/PersonalSettingsPage').then((module)=>({default:module.PersonalSettingsPage})))
// Dev-only design system specimen. The DEV guard must wrap the import() itself, not just the
// <Route>: a top-level lazy(()=>import(...)) is emitted as a chunk by Rollup whether or not the
// route is reachable, so guarding only the route still ships the page. With the ternary, Vite
// folds DEV to false and the dead branch -- and its dynamic import -- is tree-shaken away.
// Asserted by the "styleguide is not reachable in production" test in smoke.spec.ts, which runs
// against a real production build.
const StyleguidePage=import.meta.env.DEV
  ?lazy(()=>import('../features/styleguide/StyleguidePage').then((module)=>({default:module.StyleguidePage})))
  :()=>null

function Protected(){const {user,loading,error:authError}=useAuth();const {memberships,organization,loading:orgLoading,error:orgError,refresh}=useOrganization();const location=useLocation();if(authError||orgError)return <ErrorState error={authError||orgError} retry={orgError?()=>void refresh():undefined}/>;if(loading||orgLoading||(user&&memberships.length>0&&!organization))return <LoadingState label="Opening workspace…"/>;if(!user)return <Navigate to={`/login?next=${encodeURIComponent(location.pathname+location.search)}`} replace/>;if(memberships.length===0)return <Navigate to={env.allowSelfServiceOnboarding?'/onboarding':'/access-pending'} replace/>;return <AppShell/>}
function WorkspaceIndex(){const {organization}=useOrganization();return <Navigate to={`/app/${organization?.slug||'workspace'}/today`} replace/>}
function WorkspaceHome(){return <Navigate to="today" replace/>}
// Bookmarked legacy URLs (dashboard, companies, submissions, ...) still resolve to their
// consultant-first equivalent rather than 404ing, now that no organization is ever routed to the
// legacy pages themselves.
function LegacyRedirect({area}:{area:string}){const {organizationSlug='workspace',companyId,jobId}=useParams();const location=useLocation();const suffix=companyId?`/${companyId}`:jobId?`/${jobId}`:'';return <Navigate to={`/app/${organizationSlug}/${area}${suffix}${location.search}`} replace/>}
function CapabilityRoute({capability,children}:{capability:keyof WorkspaceCapabilities;children:React.ReactNode}){const {organization}=useOrganization();const capabilities=useWorkspaceCapabilities();if(!organization||capabilities.isLoading)return <LoadingState label="Checking access…"/>;return capabilities.data?.[capability]?children:<Navigate to={`/app/${organization.slug}/today`} replace/>}

export function App(){return <RouteErrorBoundary><Suspense fallback={<LoadingState label="Loading view…"/>}><Routes>
  <Route path="/login" element={<LoginPage/>}/><Route path="/signup" element={<SignupPage/>}/><Route path="/reset-password" element={<ResetPasswordPage/>}/><Route path="/onboarding" element={<OnboardingPage/>}/><Route path="/access-pending" element={<AccessPendingPage/>}/><Route path="/invite/:token" element={<InvitePage/>}/><Route path="/review/:token" element={<PublicReviewPage/>}/>
  <Route element={<Protected/>}><Route path="/app" element={<WorkspaceIndex/>}/><Route path="/app/:organizationSlug"><Route index element={<WorkspaceHome/>}/><Route path="today" element={<TodayPage/>}/><Route path="candidates" element={<CandidatesPage/>}/><Route path="candidates/:candidateId" element={<CandidateDetailPage/>}/><Route path="clients" element={<ClientsPage/>}/><Route path="scorecard" element={<ScorecardPage/>}/><Route path="clients/:companyId" element={<CompanyDetailPage/>}/><Route path="clients/:companyId/contacts/:contactId" element={<ContactDetailPage/>}/><Route path="jobs" element={<JobsPage/>}/><Route path="jobs/:jobId" element={<JobWorkspacePage/>}/><Route path="admin" element={<AdminCenterPage/>}/><Route path="admin/personal" element={<PersonalSettingsPage/>}/><Route path="admin/reports" element={<CapabilityRoute capability="canViewTeamReports"><ReportsPage/></CapabilityRoute>}/><Route path="admin/finance" element={<CapabilityRoute capability="canManagePlacements"><PlacementsPage/></CapabilityRoute>}/><Route path="admin/imports" element={<CapabilityRoute capability="canImport"><ImportsPage/></CapabilityRoute>}/><Route path="admin/templates" element={<CapabilityRoute capability="canManageTemplates"><TemplatesPage/></CapabilityRoute>}/><Route path="admin/workspace" element={<CapabilityRoute capability="canManageWorkspace"><SettingsPage/></CapabilityRoute>}/>
  <Route path="dashboard" element={<LegacyRedirect area="today"/>}/><Route path="companies" element={<LegacyRedirect area="clients"/>}/><Route path="companies/:companyId" element={<LegacyRedirect area="clients"/>}/><Route path="contacts" element={<LegacyRedirect area="clients"/>}/><Route path="contacts/:contactId" element={<ContactDetailPage/>}/><Route path="jobs/:jobId/pipeline" element={<LegacyRedirect area="jobs"/>}/><Route path="submissions" element={<LegacyRedirect area="today"/>}/><Route path="delivery" element={<LegacyRedirect area="today"/>}/><Route path="tasks" element={<LegacyRedirect area="today"/>}/><Route path="search" element={<LegacyRedirect area="today"/>}/><Route path="placements" element={<LegacyRedirect area="admin/finance"/>}/><Route path="reports" element={<LegacyRedirect area="admin/reports"/>}/><Route path="imports" element={<LegacyRedirect area="admin/imports"/>}/><Route path="templates" element={<LegacyRedirect area="admin/templates"/>}/><Route path="settings" element={<LegacyRedirect area="admin/personal"/>}/><Route path="admin/pipeline" element={<LegacyRedirect area="admin"/>}/></Route></Route>
  {import.meta.env.DEV&&<Route path="/styleguide" element={<StyleguidePage/>}/>}
  <Route path="*" element={<Navigate to="/app" replace/>}/>
</Routes></Suspense></RouteErrorBoundary>}
