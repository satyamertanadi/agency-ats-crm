import {useQuery} from '@tanstack/react-query'
import {hasOrganizationPermission,listTeamMembers} from '../features/core/commercialRepository'
import type {WorkspaceCapabilities} from '../shared/types/domain'
import {useAuth} from './AuthProvider'
import {useOrganization} from './OrganizationProvider'

const permissionKeys=[
  'candidates.write','companies.write','jobs.write','pipeline.move','submissions.write','placements.write',
  'reports.read','reports.team','finance.write','imports.manage','organization.manage','roles.manage',
] as const

const empty:WorkspaceCapabilities={roleKeys:[],canWriteCandidates:false,canWriteClients:false,canWriteJobs:false,canMovePipeline:false,canSubmit:false,canManagePlacements:false,canViewTeamReports:false,canManageFinance:false,canImport:false,canManageWorkspace:false,canManageTemplates:false,canViewAdmin:false,readOnly:true}

export function useWorkspaceCapabilities(){
  const {organization}=useOrganization();const {user}=useAuth()
  return useQuery({
    queryKey:['workspace-capabilities',organization?.id,user?.id],enabled:Boolean(organization&&user),
    queryFn:async():Promise<WorkspaceCapabilities>=>{
      const [members,permissionValues]=await Promise.all([
        listTeamMembers(organization!.id),
        Promise.all(permissionKeys.map(async(key)=>[key,await hasOrganizationPermission(organization!.id,key)] as const)),
      ])
      const current=members.find((member)=>member.user_id===user!.id)
      const roleKeys=(current?.member_roles||[]).map((item)=>item.roles?.role_key).filter((value):value is string=>Boolean(value))
      const permissions=Object.fromEntries(permissionValues) as Record<(typeof permissionKeys)[number],boolean>
      const managementRole=roleKeys.some((role)=>['owner','admin','manager','finance'].includes(role))
      const canViewTeamReports=permissions['reports.team']||(permissions['reports.read']&&managementRole)
      const canManageWorkspace=permissions['organization.manage']||permissions['roles.manage']
      const canManageTemplates=canManageWorkspace
      const canViewAdmin=canViewTeamReports||permissions['finance.write']||permissions['imports.manage']||canManageWorkspace||canManageTemplates
      const canWriteCandidates=permissions['candidates.write'];const canWriteClients=permissions['companies.write'];const canWriteJobs=permissions['jobs.write']
      return {roleKeys,canWriteCandidates,canWriteClients,canWriteJobs,canMovePipeline:permissions['pipeline.move'],canSubmit:permissions['submissions.write'],canManagePlacements:permissions['placements.write'],canViewTeamReports,canManageFinance:permissions['finance.write'],canImport:permissions['imports.manage'],canManageWorkspace,canManageTemplates,canViewAdmin,readOnly:![canWriteCandidates,canWriteClients,canWriteJobs,permissions['pipeline.move'],permissions['submissions.write'],permissions['placements.write']].some(Boolean)}
    },
    placeholderData:empty,
  })
}
