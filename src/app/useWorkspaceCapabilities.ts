import {useQuery} from '@tanstack/react-query'
import {getWorkspaceCapabilities} from '../features/core/commercialRepository'
import type {WorkspaceCapabilities} from '../shared/types/domain'
import {useAuth} from './AuthProvider'
import {useOrganization} from './OrganizationProvider'

const empty:WorkspaceCapabilities={roleKeys:[],canWriteCandidates:false,canWriteClients:false,canWriteJobs:false,canMovePipeline:false,canSubmit:false,canManageInterviews:false,canManageOffers:false,canManagePlacements:false,canManageCommercialTerms:false,canViewTeamReports:false,canManageFinance:false,canImport:false,canManageOrganization:false,canManageWorkspace:false,canManageTemplates:false,canViewAdmin:false,readOnly:true,canUseInterviewIntelligence:false,canViewOwnInterviewQuality:false,canReviewTeamInterviewQuality:false,canConfigureInterviewIntelligence:false}

/* One RPC, not sixteen. This used to fan out 15 has_permission() calls plus listTeamMembers on every
 * mount, with CapabilityRoute gating most routes behind the result -- see
 * get_my_workspace_capabilities in 20260810010000_workspace_capabilities_rpc.sql, which also owns
 * the derivation of canViewTeamReports / canViewAdmin / readOnly so those rules live next to the
 * permissions that enforce them rather than being re-implemented here. */
export function useWorkspaceCapabilities(){
  const {organization}=useOrganization();const {user}=useAuth()
  return useQuery({
    queryKey:['workspace-capabilities',organization?.id,user?.id],enabled:Boolean(organization&&user),
    queryFn:()=>getWorkspaceCapabilities(organization!.id),
    placeholderData:empty,
  })
}
