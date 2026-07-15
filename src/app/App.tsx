import { lazy,Suspense } from 'react'
import { Navigate,Route,Routes,useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useOrganization } from './OrganizationProvider'
import { AppShell } from './AppShell'
import { LoadingState } from '../shared/ui/States'
import { AccessPendingPage,LoginPage,OnboardingPage,ResetPasswordPage,SignupPage } from '../features/auth/AuthPages'
import { InvitePage } from '../features/auth/InvitePage'
import { env } from '../shared/lib/env'

const DashboardPage=lazy(()=>import('../features/dashboard/DashboardPage').then((module)=>({default:module.DashboardPage})))
const CandidatesPage=lazy(()=>import('../features/candidates/CandidatesPage').then((module)=>({default:module.CandidatesPage})))
const CandidateDetailPage=lazy(()=>import('../features/candidates/CandidateDetailPage').then((module)=>({default:module.CandidateDetailPage})))
const CompaniesPage=lazy(()=>import('../features/companies/CompaniesPage').then((module)=>({default:module.CompaniesPage})))
const ContactsPage=lazy(()=>import('../features/contacts/ContactsPage').then((module)=>({default:module.ContactsPage})))
const JobsPage=lazy(()=>import('../features/jobs/JobsPage').then((module)=>({default:module.JobsPage})))
const CompanyDetailPage=lazy(()=>import('../features/core/RecordDetailPages').then((module)=>({default:module.CompanyDetailPage})))
const ContactDetailPage=lazy(()=>import('../features/core/RecordDetailPages').then((module)=>({default:module.ContactDetailPage})))
const JobDetailPage=lazy(()=>import('../features/core/RecordDetailPages').then((module)=>({default:module.JobDetailPage})))
const PipelinePage=lazy(()=>import('../features/pipelines/PipelinePage').then((module)=>({default:module.PipelinePage})))
const SubmissionsPage=lazy(()=>import('../features/submissions/SubmissionsPage').then((module)=>({default:module.SubmissionsPage})))
const PublicReviewPage=lazy(()=>import('../features/submissions/PublicReviewPage').then((module)=>({default:module.PublicReviewPage})))
const DeliveryPage=lazy(()=>import('../features/delivery/DeliveryPage').then((module)=>({default:module.DeliveryPage})))
const TasksPage=lazy(()=>import('../features/activities/TasksPage').then((module)=>({default:module.TasksPage})))
const PlacementsPage=lazy(()=>import('../features/placements/PlacementsPage').then((module)=>({default:module.PlacementsPage})))
const SearchPage=lazy(()=>import('../features/search/SearchPage').then((module)=>({default:module.SearchPage})))
const SettingsPage=lazy(()=>import('../features/settings/SettingsPage').then((module)=>({default:module.SettingsPage})))
const ReportsPage=lazy(()=>import('../features/reports/ReportsPage').then((module)=>({default:module.ReportsPage})))
const ImportsPage=lazy(()=>import('../features/imports/ImportsPage').then((module)=>({default:module.ImportsPage})))

function Protected(){const {user,loading}=useAuth();const {memberships,loading:orgLoading}=useOrganization();const location=useLocation();if(loading||orgLoading)return <LoadingState label="Opening workspace…"/>;if(!user)return <Navigate to={`/login?next=${encodeURIComponent(location.pathname+location.search)}`} replace/>;if(memberships.length===0)return <Navigate to={env.allowSelfServiceOnboarding?'/onboarding':'/access-pending'} replace/>;return <AppShell/>}
function WorkspaceIndex(){const {organization}=useOrganization();return <Navigate to={`/app/${organization?.slug||'workspace'}/dashboard`} replace/>}

export function App(){return <Suspense fallback={<LoadingState label="Loading view…"/>}><Routes>
  <Route path="/login" element={<LoginPage/>}/><Route path="/signup" element={<SignupPage/>}/><Route path="/reset-password" element={<ResetPasswordPage/>}/><Route path="/onboarding" element={<OnboardingPage/>}/><Route path="/access-pending" element={<AccessPendingPage/>}/><Route path="/invite/:token" element={<InvitePage/>}/><Route path="/review/:token" element={<PublicReviewPage/>}/>
  <Route element={<Protected/>}><Route path="/app" element={<WorkspaceIndex/>}/><Route path="/app/:organizationSlug"><Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<DashboardPage/>}/><Route path="candidates" element={<CandidatesPage/>}/><Route path="candidates/:candidateId" element={<CandidateDetailPage/>}/><Route path="companies" element={<CompaniesPage/>}/><Route path="companies/:companyId" element={<CompanyDetailPage/>}/><Route path="contacts" element={<ContactsPage/>}/><Route path="contacts/:contactId" element={<ContactDetailPage/>}/><Route path="jobs" element={<JobsPage/>}/><Route path="jobs/:jobId" element={<JobDetailPage/>}/><Route path="jobs/:jobId/pipeline" element={<PipelinePage/>}/><Route path="submissions" element={<SubmissionsPage/>}/><Route path="delivery" element={<DeliveryPage/>}/><Route path="placements" element={<PlacementsPage/>}/><Route path="tasks" element={<TasksPage/>}/><Route path="search" element={<SearchPage/>}/><Route path="reports" element={<ReportsPage/>}/><Route path="imports" element={<ImportsPage/>}/><Route path="settings" element={<SettingsPage/>}/></Route></Route>
  <Route path="*" element={<Navigate to="/app" replace/>}/>
</Routes></Suspense>}
