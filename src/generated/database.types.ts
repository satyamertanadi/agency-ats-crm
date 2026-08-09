export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          activity_type: string
          actor_name_snapshot: string | null
          created_at: string
          created_by: string
          direction: string | null
          id: string
          occurred_at: string
          organization_id: string
          owner_member_id: string | null
          subject: string | null
          summary: string
        }
        Insert: {
          activity_type: string
          actor_name_snapshot?: string | null
          created_at?: string
          created_by: string
          direction?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          owner_member_id?: string | null
          subject?: string | null
          summary: string
        }
        Update: {
          activity_type?: string
          actor_name_snapshot?: string | null
          created_at?: string
          created_by?: string
          direction?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          owner_member_id?: string | null
          subject?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_created_by_profiles_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_links: {
        Row: {
          activity_id: string
          candidate_id: string | null
          candidate_submission_id: string | null
          company_id: string | null
          contact_id: string | null
          id: string
          job_id: string | null
          organization_id: string
          placement_id: string | null
        }
        Insert: {
          activity_id: string
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          placement_id?: string | null
        }
        Update: {
          activity_id?: string
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          placement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_links_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_links_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_evaluations: {
        Row: {
          candidate_id: string
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          evaluation_type: string
          evidence: Json
          failure_code: string | null
          failure_message: string | null
          id: string
          input_hash: string | null
          input_tokens: number | null
          input_versions: Json
          job_id: string | null
          matched_requirements: Json
          missing_requirements: Json
          model: string
          organization_id: string
          output_tokens: number | null
          prompt_version: string
          provider: string
          raw_response: Json | null
          requested_by: string | null
          score: number | null
          status: string
          summary: string | null
          uncertainties: Json
        }
        Insert: {
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          evaluation_type: string
          evidence?: Json
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          input_hash?: string | null
          input_tokens?: number | null
          input_versions?: Json
          job_id?: string | null
          matched_requirements?: Json
          missing_requirements?: Json
          model: string
          organization_id: string
          output_tokens?: number | null
          prompt_version: string
          provider: string
          raw_response?: Json | null
          requested_by?: string | null
          score?: number | null
          status: string
          summary?: string | null
          uncertainties?: Json
        }
        Update: {
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          evaluation_type?: string
          evidence?: Json
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          input_hash?: string | null
          input_tokens?: number | null
          input_versions?: Json
          job_id?: string | null
          matched_requirements?: Json
          missing_requirements?: Json
          model?: string
          organization_id?: string
          output_tokens?: number | null
          prompt_version?: string
          provider?: string
          raw_response?: Json | null
          requested_by?: string | null
          score?: number | null
          status?: string
          summary?: string | null
          uncertainties?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_evaluations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evaluations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          status: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id: string
          payload?: Json
          priority?: number
          status?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          priority?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_consents: {
        Row: {
          candidate_id: string
          evidence: string | null
          id: string
          legal_basis: string | null
          notice_version: string | null
          occurred_at: string
          organization_id: string
          recorded_by: string | null
          status: string
        }
        Insert: {
          candidate_id: string
          evidence?: string | null
          id?: string
          legal_basis?: string | null
          notice_version?: string | null
          occurred_at?: string
          organization_id: string
          recorded_by?: string | null
          status: string
        }
        Update: {
          candidate_id?: string
          evidence?: string | null
          id?: string
          legal_basis?: string | null
          notice_version?: string | null
          occurred_at?: string
          organization_id?: string
          recorded_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_consents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_consents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_cv_parses: {
        Row: {
          accepted_at: string | null
          accepted_candidate_id: string | null
          attempts: number
          created_at: string
          error_code: string | null
          error_message: string | null
          expires_at: string
          extracted_data: Json | null
          field_evidence: Json
          id: string
          input_tokens: number | null
          matched_candidate_id: string | null
          mime_type: string
          model: string | null
          organization_id: string
          original_filename: string
          output_tokens: number | null
          processing_started_at: string | null
          prompt_version: string
          provider: string
          size_bytes: number
          status: string
          storage_path: string
          target_candidate_id: string | null
          uncertainties: Json
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_candidate_id?: string | null
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string
          extracted_data?: Json | null
          field_evidence?: Json
          id: string
          input_tokens?: number | null
          matched_candidate_id?: string | null
          mime_type: string
          model?: string | null
          organization_id: string
          original_filename: string
          output_tokens?: number | null
          processing_started_at?: string | null
          prompt_version?: string
          provider?: string
          size_bytes: number
          status?: string
          storage_path: string
          target_candidate_id?: string | null
          uncertainties?: Json
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          accepted_at?: string | null
          accepted_candidate_id?: string | null
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string
          extracted_data?: Json | null
          field_evidence?: Json
          id?: string
          input_tokens?: number | null
          matched_candidate_id?: string | null
          mime_type?: string
          model?: string | null
          organization_id?: string
          original_filename?: string
          output_tokens?: number | null
          processing_started_at?: string | null
          prompt_version?: string
          provider?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          target_candidate_id?: string | null
          uncertainties?: Json
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_cv_parses_accepted_candidate_id_fkey"
            columns: ["accepted_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_cv_parses_matched_candidate_id_fkey"
            columns: ["matched_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_cv_parses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_cv_parses_target_candidate_id_fkey"
            columns: ["target_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_education: {
        Row: {
          candidate_id: string
          degree: string | null
          ended_on: string | null
          ended_on_precision: string | null
          field_of_study: string | null
          id: string
          institution: string
          organization_id: string
          sort_order: number
          started_on: string | null
          started_on_precision: string | null
        }
        Insert: {
          candidate_id: string
          degree?: string | null
          ended_on?: string | null
          ended_on_precision?: string | null
          field_of_study?: string | null
          id?: string
          institution: string
          organization_id: string
          sort_order?: number
          started_on?: string | null
          started_on_precision?: string | null
        }
        Update: {
          candidate_id?: string
          degree?: string | null
          ended_on?: string | null
          ended_on_precision?: string | null
          field_of_study?: string | null
          id?: string
          institution?: string
          organization_id?: string
          sort_order?: number
          started_on?: string | null
          started_on_precision?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_education_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_education_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_employment: {
        Row: {
          candidate_id: string
          company_name: string
          ended_on: string | null
          ended_on_precision: string | null
          id: string
          is_current: boolean
          location: string | null
          organization_id: string
          sort_order: number
          started_on: string | null
          started_on_precision: string | null
          summary: string | null
          title: string
        }
        Insert: {
          candidate_id: string
          company_name: string
          ended_on?: string | null
          ended_on_precision?: string | null
          id?: string
          is_current?: boolean
          location?: string | null
          organization_id: string
          sort_order?: number
          started_on?: string | null
          started_on_precision?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          candidate_id?: string
          company_name?: string
          ended_on?: string | null
          ended_on_precision?: string | null
          id?: string
          is_current?: boolean
          location?: string | null
          organization_id?: string
          sort_order?: number
          started_on?: string | null
          started_on_precision?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_employment_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_employment_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_languages: {
        Row: {
          candidate_id: string
          id: string
          language: string
          organization_id: string
          proficiency: string | null
        }
        Insert: {
          candidate_id: string
          id?: string
          language: string
          organization_id: string
          proficiency?: string | null
        }
        Update: {
          candidate_id?: string
          id?: string
          language?: string
          organization_id?: string
          proficiency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_languages_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_languages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_merge_history: {
        Row: {
          id: string
          kept_candidate_id: string
          merged_at: string
          merged_by: string
          merged_candidate_id: string
          organization_id: string
          reason: string
        }
        Insert: {
          id?: string
          kept_candidate_id: string
          merged_at?: string
          merged_by: string
          merged_candidate_id: string
          organization_id: string
          reason: string
        }
        Update: {
          id?: string
          kept_candidate_id?: string
          merged_at?: string
          merged_by?: string
          merged_candidate_id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_merge_history_kept_candidate_id_fkey"
            columns: ["kept_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_merge_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_preferred_locations: {
        Row: {
          candidate_id: string
          location: string
          organization_id: string
        }
        Insert: {
          candidate_id: string
          location: string
          organization_id: string
        }
        Update: {
          candidate_id?: string
          location?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_preferred_locations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_preferred_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_private_details: {
        Row: {
          candidate_id: string
          canonical_email: string | null
          consent_expires_at: string | null
          consent_status: string
          current_salary: number | null
          email: string | null
          expected_salary: number | null
          legal_hold: boolean
          organization_id: string
          phone: string | null
          salary_currency: string | null
          updated_at: string
          work_authorization: string | null
        }
        Insert: {
          candidate_id: string
          canonical_email?: string | null
          consent_expires_at?: string | null
          consent_status?: string
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          legal_hold?: boolean
          organization_id: string
          phone?: string | null
          salary_currency?: string | null
          updated_at?: string
          work_authorization?: string | null
        }
        Update: {
          candidate_id?: string
          canonical_email?: string | null
          consent_expires_at?: string | null
          consent_status?: string
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          legal_hold?: boolean
          organization_id?: string
          phone?: string | null
          salary_currency?: string | null
          updated_at?: string
          work_authorization?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_private_details_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_private_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_versions: {
        Row: {
          ai_evaluation_id: string
          anonymized: boolean
          candidate_id: string
          created_at: string
          created_by: string
          docx_document_id: string | null
          edited_field_count: number | null
          export_failure_reason: string | null
          exported_formats: string[]
          finalization_ms: number | null
          finalized_at: string | null
          generated_content: Json
          generation_ms: number
          id: string
          input_hash: string
          input_versions: Json
          job_id: string
          organization_id: string
          pdf_document_id: string | null
          reviewed_content: Json | null
          status: string
          submitted_at: string | null
          template_id: string
          template_snapshot: Json
          template_version: number
          version: number
        }
        Insert: {
          ai_evaluation_id: string
          anonymized?: boolean
          candidate_id: string
          created_at?: string
          created_by: string
          docx_document_id?: string | null
          edited_field_count?: number | null
          export_failure_reason?: string | null
          exported_formats?: string[]
          finalization_ms?: number | null
          finalized_at?: string | null
          generated_content: Json
          generation_ms?: number
          id?: string
          input_hash: string
          input_versions?: Json
          job_id: string
          organization_id: string
          pdf_document_id?: string | null
          reviewed_content?: Json | null
          status?: string
          submitted_at?: string | null
          template_id: string
          template_snapshot: Json
          template_version: number
          version?: number
        }
        Update: {
          ai_evaluation_id?: string
          anonymized?: boolean
          candidate_id?: string
          created_at?: string
          created_by?: string
          docx_document_id?: string | null
          edited_field_count?: number | null
          export_failure_reason?: string | null
          exported_formats?: string[]
          finalization_ms?: number | null
          finalized_at?: string | null
          generated_content?: Json
          generation_ms?: number
          id?: string
          input_hash?: string
          input_versions?: Json
          job_id?: string
          organization_id?: string
          pdf_document_id?: string | null
          reviewed_content?: Json | null
          status?: string
          submitted_at?: string | null
          template_id?: string
          template_snapshot?: Json
          template_version?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_versions_ai_evaluation_id_fkey"
            columns: ["ai_evaluation_id"]
            isOneToOne: false
            referencedRelation: "ai_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_docx_document_id_fkey"
            columns: ["docx_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_pdf_document_id_fkey"
            columns: ["pdf_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_search_documents: {
        Row: {
          candidate_id: string
          extracted_content: Json
          organization_id: string
          search_vector: unknown
          updated_at: string
        }
        Insert: {
          candidate_id: string
          extracted_content?: Json
          organization_id: string
          search_vector?: unknown
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          extracted_content?: Json
          organization_id?: string
          search_vector?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_search_documents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_search_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_skills: {
        Row: {
          candidate_id: string
          organization_id: string
          proficiency: string | null
          skill_id: string
          years_experience: number | null
        }
        Insert: {
          candidate_id: string
          organization_id: string
          proficiency?: string | null
          skill_id: string
          years_experience?: number | null
        }
        Update: {
          candidate_id?: string
          organization_id?: string
          proficiency?: string | null
          skill_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_skills_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_submissions: {
        Row: {
          availability: string | null
          candidate_summary: string
          created_at: string
          currency: string | null
          expected_salary: number | null
          id: string
          interview_availability: string | null
          job_candidate_id: string
          motivation: string | null
          notice_period: string | null
          organization_id: string
          package_id: string
          recruiter_comments: string | null
          relevant_experience: string | null
          relocation_willingness: string | null
          salary: number | null
          status: string
          suitability_assessment: string | null
        }
        Insert: {
          availability?: string | null
          candidate_summary: string
          created_at?: string
          currency?: string | null
          expected_salary?: number | null
          id?: string
          interview_availability?: string | null
          job_candidate_id: string
          motivation?: string | null
          notice_period?: string | null
          organization_id: string
          package_id: string
          recruiter_comments?: string | null
          relevant_experience?: string | null
          relocation_willingness?: string | null
          salary?: number | null
          status?: string
          suitability_assessment?: string | null
        }
        Update: {
          availability?: string | null
          candidate_summary?: string
          created_at?: string
          currency?: string | null
          expected_salary?: number | null
          id?: string
          interview_availability?: string | null
          job_candidate_id?: string
          motivation?: string | null
          notice_period?: string | null
          organization_id?: string
          package_id?: string
          recruiter_comments?: string | null
          relevant_experience?: string | null
          relocation_willingness?: string | null
          salary?: number | null
          status?: string
          suitability_assessment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_submissions_job_candidate_id_fkey"
            columns: ["job_candidate_id"]
            isOneToOne: false
            referencedRelation: "job_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_submissions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "submission_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_tags: {
        Row: {
          candidate_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          candidate_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          candidate_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_tags_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          availability: string | null
          created_at: string
          created_by: string
          current_company: string | null
          current_position: string | null
          deleted_at: string | null
          full_name: string
          id: string
          last_contacted_at: string | null
          linkedin_url: string | null
          location: string | null
          notice_period_days: number | null
          organization_id: string
          owner_member_id: string | null
          portfolio_url: string | null
          source: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          availability?: string | null
          created_at?: string
          created_by: string
          current_company?: string | null
          current_position?: string | null
          deleted_at?: string | null
          full_name: string
          id?: string
          last_contacted_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          notice_period_days?: number | null
          organization_id: string
          owner_member_id?: string | null
          portfolio_url?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          availability?: string | null
          created_at?: string
          created_by?: string
          current_company?: string | null
          current_position?: string | null
          deleted_at?: string | null
          full_name?: string
          id?: string
          last_contacted_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          notice_period_days?: number | null
          organization_id?: string
          owner_member_id?: string | null
          portfolio_url?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_terms: {
        Row: {
          agreement_document_url: string | null
          approval_status: string
          company_id: string
          created_at: string
          created_by: string
          currency: string
          effective_from: string
          effective_to: string | null
          fee_percentage: number | null
          fee_type: string
          fixed_fee: number | null
          guarantee_days: number
          id: string
          notes: string | null
          organization_id: string
          payment_terms_days: number | null
          replacement_terms: string | null
          status: string
          tax_treatment: string | null
          updated_at: string
        }
        Insert: {
          agreement_document_url?: string | null
          approval_status?: string
          company_id: string
          created_at?: string
          created_by: string
          currency: string
          effective_from?: string
          effective_to?: string | null
          fee_percentage?: number | null
          fee_type: string
          fixed_fee?: number | null
          guarantee_days?: number
          id?: string
          notes?: string | null
          organization_id: string
          payment_terms_days?: number | null
          replacement_terms?: string | null
          status?: string
          tax_treatment?: string | null
          updated_at?: string
        }
        Update: {
          agreement_document_url?: string | null
          approval_status?: string
          company_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          fee_percentage?: number | null
          fee_type?: string
          fixed_fee?: number | null
          guarantee_days?: number
          id?: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number | null
          replacement_terms?: string | null
          status?: string
          tax_treatment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_terms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_status: string
          business_development_stage: string
          company_size: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          industry: string | null
          location: string | null
          name: string
          notes_summary: string | null
          organization_id: string
          owner_member_id: string | null
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          account_status?: string
          business_development_stage?: string
          company_size?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          location?: string | null
          name: string
          notes_summary?: string | null
          organization_id: string
          owner_member_id?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          account_status?: string
          business_development_stage?: string
          company_size?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          location?: string | null
          name?: string
          notes_summary?: string | null
          organization_id?: string
          owner_member_id?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      company_tags: {
        Row: {
          company_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          company_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          company_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string
          contact_status: string
          created_at: string
          created_by: string
          decision_authority: string | null
          deleted_at: string | null
          email: string | null
          full_name: string
          id: string
          last_contacted_at: string | null
          linkedin_url: string | null
          next_follow_up_at: string | null
          organization_id: string
          phone: string | null
          position: string | null
          relationship_owner_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          contact_status?: string
          created_at?: string
          created_by: string
          decision_authority?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          last_contacted_at?: string | null
          linkedin_url?: string | null
          next_follow_up_at?: string | null
          organization_id: string
          phone?: string | null
          position?: string | null
          relationship_owner_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          contact_status?: string
          created_at?: string
          created_by?: string
          decision_authority?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          last_contacted_at?: string | null
          linkedin_url?: string | null
          next_follow_up_at?: string | null
          organization_id?: string
          phone?: string | null
          position?: string | null
          relationship_owner_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      document_links: {
        Row: {
          candidate_id: string | null
          candidate_submission_id: string | null
          company_id: string | null
          contact_id: string | null
          document_id: string
          id: string
          job_id: string | null
          organization_id: string
          placement_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          document_id: string
          id?: string
          job_id?: string | null
          organization_id: string
          placement_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          document_id?: string
          id?: string
          job_id?: string | null
          organization_id?: string
          placement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_links_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_links_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          document_type: string
          file_name: string
          id: string
          is_current: boolean
          mime_type: string
          organization_id: string
          original_filename: string | null
          size_bytes: number
          storage_path: string
          uploaded_by: string
          version: number
          visibility: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          document_type: string
          file_name: string
          id?: string
          is_current?: boolean
          mime_type: string
          organization_id: string
          original_filename?: string | null
          size_bytes: number
          storage_path: string
          uploaded_by: string
          version?: number
          visibility?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          document_type?: string
          file_name?: string
          id?: string
          is_current?: boolean
          mime_type?: string
          organization_id?: string
          original_filename?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          created_at: string
          email_type: string
          error_code: string | null
          error_message: string | null
          id: string
          organization_id: string
          provider: string
          provider_message_id: string | null
          recipient_email: string
          related_entity_id: string | null
          related_entity_type: string | null
          request_key: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_type: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          provider?: string
          provider_message_id?: string | null
          recipient_email: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          request_key?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_type?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          provider?: string
          provider_message_id?: string | null
          recipient_email?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          request_key?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_payloads: {
        Row: {
          created_at: string
          delivery_id: string
          expires_at: string
          organization_id: string
          secret_token: string
        }
        Insert: {
          created_at?: string
          delivery_id: string
          expires_at: string
          organization_id: string
          secret_token: string
        }
        Update: {
          created_at?: string
          delivery_id?: string
          expires_at?: string
          organization_id?: string
          secret_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_payloads_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "email_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_payloads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string | null
          export_type: string
          id: string
          organization_id: string
          requested_by: string
          status: string
          storage_path: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          export_type: string
          id?: string
          organization_id: string
          requested_by: string
          status?: string
          storage_path?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          export_type?: string
          id?: string
          organization_id?: string
          requested_by?: string
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          calendar_id: string
          connected_at: string
          created_at: string
          disconnected_at: string | null
          google_email: string
          id: string
          last_error: string | null
          last_error_at: string | null
          last_synced_at: string | null
          member_id: string
          organization_id: string
          scopes: string[]
          status: string
          token_secret_id: string | null
          updated_at: string
        }
        Insert: {
          calendar_id?: string
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          google_email: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_synced_at?: string | null
          member_id: string
          organization_id: string
          scopes?: string[]
          status?: string
          token_secret_id?: string | null
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          google_email?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_synced_at?: string | null
          member_id?: string
          organization_id?: string
          scopes?: string[]
          status?: string
          token_secret_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_connections_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_calendar_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_calendar_connections_token_secret_id_fkey"
            columns: ["token_secret_id"]
            isOneToOne: false
            referencedRelation: "google_calendar_secrets"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_secrets: {
        Row: {
          connection_id: string
          created_at: string
          encrypted_refresh_token: string
          encryption_version: number
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          encrypted_refresh_token: string
          encryption_version?: number
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          encrypted_refresh_token?: string
          encryption_version?: number
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "google_calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      google_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          member_id: string
          organization_id: string
          return_path: string
          state_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          member_id: string
          organization_id: string
          return_path?: string
          state_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          member_id?: string
          organization_id?: string
          return_path?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_oauth_states_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guarantee_events: {
        Row: {
          created_at: string
          created_by: string
          event_type: string
          id: string
          notes: string | null
          occurred_on: string
          organization_id: string
          placement_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          notes?: string | null
          occurred_on?: string
          organization_id: string
          placement_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          organization_id?: string
          placement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guarantee_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guarantee_events_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      import_change_log: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          import_id: string
          operation: string
          organization_id: string
          previous_data: Json | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
          import_id: string
          operation?: string
          organization_id: string
          previous_data?: Json | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
          import_id?: string
          operation?: string
          organization_id?: string
          previous_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "import_change_log_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_change_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_entity_mappings: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          import_id: string
          legacy_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          import_id: string
          legacy_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          import_id?: string
          legacy_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_entity_mappings_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_entity_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          duplicate_candidate_id: string | null
          errors: Json
          id: number
          import_id: string
          mapped_data: Json | null
          organization_id: string
          row_number: number
          source_data: Json
          status: string
        }
        Insert: {
          duplicate_candidate_id?: string | null
          errors?: Json
          id?: never
          import_id: string
          mapped_data?: Json | null
          organization_id: string
          row_number: number
          source_data: Json
          status?: string
        }
        Update: {
          duplicate_candidate_id?: string | null
          errors?: Json
          id?: never
          import_id?: string
          mapped_data?: Json | null
          organization_id?: string
          row_number?: number
          source_data?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_duplicate_candidate_id_fkey"
            columns: ["duplicate_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          entity_type: string
          failed_rows: number
          file_name: string
          id: string
          mapping: Json
          organization_id: string
          reconciliation_summary: Json
          rollback_reason: string | null
          rolled_back_at: string | null
          source_filename: string | null
          source_format: string | null
          status: string
          total_rows: number
          valid_rows: number
          validation_summary: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          entity_type: string
          failed_rows?: number
          file_name: string
          id?: string
          mapping?: Json
          organization_id: string
          reconciliation_summary?: Json
          rollback_reason?: string | null
          rolled_back_at?: string | null
          source_filename?: string | null
          source_format?: string | null
          status?: string
          total_rows?: number
          valid_rows?: number
          validation_summary?: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          entity_type?: string
          failed_rows?: number
          file_name?: string
          id?: string
          mapping?: Json
          organization_id?: string
          reconciliation_summary?: Json
          rollback_reason?: string | null
          rolled_back_at?: string | null
          source_filename?: string | null
          source_format?: string | null
          status?: string
          total_rows?: number
          valid_rows?: number
          validation_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          configuration: Json
          created_at: string
          id: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          id?: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_attendees: {
        Row: {
          contact_id: string | null
          external_email: string | null
          external_name: string | null
          id: string
          interview_id: string
          member_id: string | null
          organization_id: string
        }
        Insert: {
          contact_id?: string | null
          external_email?: string | null
          external_name?: string | null
          id?: string
          interview_id: string
          member_id?: string | null
          organization_id: string
        }
        Update: {
          contact_id?: string | null
          external_email?: string | null
          external_name?: string | null
          id?: string
          interview_id?: string
          member_id?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_attendees_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_attendees_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_attendees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          attendee_emails: string[]
          calendar_event_id: string | null
          calendar_event_url: string | null
          calendar_last_error: string | null
          calendar_last_synced_at: string | null
          calendar_retry_count: number
          calendar_sync_status: string
          calendar_sync_version: number
          calendar_synced_version: number
          cancelled_at: string | null
          create_google_meet: boolean
          created_at: string
          created_by: string
          ends_at: string
          id: string
          interview_type: string | null
          job_candidate_id: string
          location: string | null
          meeting_url: string | null
          notes: string | null
          organization_id: string
          organizer_member_id: string | null
          stage_label: string | null
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          attendee_emails?: string[]
          calendar_event_id?: string | null
          calendar_event_url?: string | null
          calendar_last_error?: string | null
          calendar_last_synced_at?: string | null
          calendar_retry_count?: number
          calendar_sync_status?: string
          calendar_sync_version?: number
          calendar_synced_version?: number
          cancelled_at?: string | null
          create_google_meet?: boolean
          created_at?: string
          created_by: string
          ends_at: string
          id?: string
          interview_type?: string | null
          job_candidate_id: string
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          organization_id: string
          organizer_member_id?: string | null
          stage_label?: string | null
          starts_at: string
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          attendee_emails?: string[]
          calendar_event_id?: string | null
          calendar_event_url?: string | null
          calendar_last_error?: string | null
          calendar_last_synced_at?: string | null
          calendar_retry_count?: number
          calendar_sync_status?: string
          calendar_sync_version?: number
          calendar_synced_version?: number
          cancelled_at?: string | null
          create_google_meet?: boolean
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          interview_type?: string | null
          job_candidate_id?: string
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          organization_id?: string
          organizer_member_id?: string | null
          stage_label?: string | null
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_job_candidate_id_fkey"
            columns: ["job_candidate_id"]
            isOneToOne: false
            referencedRelation: "job_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_organizer_member_id_fkey"
            columns: ["organizer_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_candidates: {
        Row: {
          added_at: string
          added_by: string
          candidate_id: string
          closed_at: string | null
          current_stage_id: string
          id: string
          job_id: string
          organization_id: string
          owner_member_id: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          added_at?: string
          added_by: string
          candidate_id: string
          closed_at?: string | null
          current_stage_id: string
          id?: string
          job_id: string
          organization_id: string
          owner_member_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          added_at?: string
          added_by?: string
          candidate_id?: string
          closed_at?: string | null
          current_stage_id?: string
          id?: string
          job_id?: string
          organization_id?: string
          owner_member_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_candidates_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_candidates_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_candidates_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_contacts: {
        Row: {
          contact_id: string
          is_primary: boolean
          job_id: string
          organization_id: string
        }
        Insert: {
          contact_id: string
          is_primary?: boolean
          job_id: string
          organization_id: string
        }
        Update: {
          contact_id?: string
          is_primary?: boolean
          job_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_contacts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_tags: {
        Row: {
          job_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          job_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          job_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_tags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      job_target_companies: {
        Row: {
          company_name: string
          id: string
          job_id: string
          mode: string
          organization_id: string
        }
        Insert: {
          company_name: string
          id?: string
          job_id: string
          mode: string
          organization_id: string
        }
        Update: {
          company_name?: string
          id?: string
          job_id?: string
          mode?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_target_companies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_target_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_team_members: {
        Row: {
          job_id: string
          member_id: string
          organization_id: string
          team_role: string | null
        }
        Insert: {
          job_id: string
          member_id: string
          organization_id: string
          team_role?: string | null
        }
        Update: {
          job_id?: string
          member_id?: string
          organization_id?: string
          team_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_team_members_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          client_visible_notes: string | null
          company_id: string
          created_at: string
          created_by: string
          currency: string | null
          deleted_at: string | null
          description: string | null
          employment_type: string | null
          fixed_fee: number | null
          id: string
          internal_notes: string | null
          location: string | null
          opened_at: string | null
          organization_id: string
          owner_member_id: string | null
          pipeline_id: string | null
          placement_fee_percentage: number | null
          priority: string
          requirements: string | null
          salary_max: number | null
          salary_min: number | null
          status: string
          target_close_date: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_visible_notes?: string | null
          company_id: string
          created_at?: string
          created_by: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          employment_type?: string | null
          fixed_fee?: number | null
          id?: string
          internal_notes?: string | null
          location?: string | null
          opened_at?: string | null
          organization_id: string
          owner_member_id?: string | null
          pipeline_id?: string | null
          placement_fee_percentage?: number | null
          priority?: string
          requirements?: string | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string
          target_close_date?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_visible_notes?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          employment_type?: string | null
          fixed_fee?: number | null
          id?: string
          internal_notes?: string | null
          location?: string | null
          opened_at?: string | null
          organization_id?: string
          owner_member_id?: string | null
          pipeline_id?: string | null
          placement_fee_percentage?: number | null
          priority?: string
          requirements?: string | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string
          target_close_date?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_pipeline_fk"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      member_roles: {
        Row: {
          member_id: string
          role_id: string
        }
        Insert: {
          member_id: string
          role_id: string
        }
        Update: {
          member_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      note_links: {
        Row: {
          candidate_id: string | null
          candidate_submission_id: string | null
          company_id: string | null
          contact_id: string | null
          id: string
          job_id: string | null
          note_id: string
          organization_id: string
          placement_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          note_id: string
          organization_id: string
          placement_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          note_id?: string
          organization_id?: string
          placement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "note_links_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          id: string
          job_candidate_id: string
          notes: string | null
          offered_at: string
          organization_id: string
          salary: number
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency: string
          id?: string
          job_candidate_id: string
          notes?: string | null
          offered_at?: string
          organization_id: string
          salary: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          job_candidate_id?: string
          notes?: string | null
          offered_at?: string
          organization_id?: string
          salary?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_job_candidate_id_fkey"
            columns: ["job_candidate_id"]
            isOneToOne: false
            referencedRelation: "job_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          delivery_error: string | null
          delivery_id: string | null
          delivery_status: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          organization_id: string
          provider: string
          revoked_at: string | null
          role_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_id?: string | null
          delivery_status?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          last_sent_at?: string | null
          organization_id: string
          provider?: string
          revoked_at?: string | null
          role_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_id?: string | null
          delivery_status?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_sent_at?: string | null
          organization_id?: string
          provider?: string
          revoked_at?: string | null
          role_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          is_vendor_support: boolean
          job_title: string | null
          joined_at: string
          organization_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_vendor_support?: boolean
          job_title?: string | null
          joined_at?: string
          organization_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_vendor_support?: boolean
          job_title?: string | null
          joined_at?: string
          organization_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          allowed_email_domains: string[]
          calendar_sync_enabled: boolean
          candidate_retention_months: number
          default_submission_expiry_days: number
          document_migration_completed: boolean
          logo_path: string | null
          organization_id: string
          primary_color: string
          require_invitation: boolean
          settings: Json
          support_email: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_email_domains?: string[]
          calendar_sync_enabled?: boolean
          candidate_retention_months?: number
          default_submission_expiry_days?: number
          document_migration_completed?: boolean
          logo_path?: string | null
          organization_id: string
          primary_color?: string
          require_invitation?: boolean
          settings?: Json
          support_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_email_domains?: string[]
          calendar_sync_enabled?: boolean
          candidate_retention_months?: number
          default_submission_expiry_days?: number
          document_migration_completed?: boolean
          logo_path?: string | null
          organization_id?: string
          primary_color?: string
          require_invitation?: boolean
          settings?: Json
          support_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          base_currency: string
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          name: string
          onboarding_completed_at: string | null
          pilot_status: string
          salary_period: string
          seat_limit: number
          slug: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          name: string
          onboarding_completed_at?: string | null
          pilot_status?: string
          salary_period?: string
          seat_limit?: number
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          name?: string
          onboarding_completed_at?: string | null
          pilot_status?: string
          salary_period?: string
          seat_limit?: number
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          description: string
          key: string
        }
        Insert: {
          description: string
          key: string
        }
        Update: {
          description?: string
          key?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string | null
          id: string
          is_client_visible: boolean
          name: string
          organization_id: string
          phase_key: string | null
          pipeline_id: string
          position: number
          stage_key: string
          stage_type: string
        }
        Insert: {
          color?: string | null
          id?: string
          is_client_visible?: boolean
          name: string
          organization_id: string
          phase_key?: string | null
          pipeline_id: string
          position: number
          stage_key: string
          stage_type?: string
        }
        Update: {
          color?: string | null
          id?: string
          is_client_visible?: boolean
          name?: string
          organization_id?: string
          phase_key?: string | null
          pipeline_id?: string
          position?: number
          stage_key?: string
          stage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          job_id: string | null
          kind: string
          name: string
          organization_id: string
          source_pipeline_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          job_id?: string | null
          kind: string
          name: string
          organization_id: string
          source_pipeline_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          job_id?: string | null
          kind?: string
          name?: string
          organization_id?: string
          source_pipeline_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_source_pipeline_id_fkey"
            columns: ["source_pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      placement_invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_on: string | null
          id: string
          invoice_reference: string | null
          issued_on: string | null
          notes: string | null
          organization_id: string
          paid_on: string | null
          placement_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          due_on?: string | null
          id?: string
          invoice_reference?: string | null
          issued_on?: string | null
          notes?: string | null
          organization_id: string
          paid_on?: string | null
          placement_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_on?: string | null
          id?: string
          invoice_reference?: string | null
          issued_on?: string | null
          notes?: string | null
          organization_id?: string
          paid_on?: string | null
          placement_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "placement_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_invoices_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      placement_revenue_splits: {
        Row: {
          id: string
          member_id: string
          organization_id: string
          placement_id: string
          split_amount: number | null
          split_percentage: number
        }
        Insert: {
          id?: string
          member_id: string
          organization_id: string
          placement_id: string
          split_amount?: number | null
          split_percentage: number
        }
        Update: {
          id?: string
          member_id?: string
          organization_id?: string
          placement_id?: string
          split_amount?: number | null
          split_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "placement_revenue_splits_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_revenue_splits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_revenue_splits_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
        ]
      }
      placements: {
        Row: {
          candidate_id: string
          commercial_term_id: string | null
          company_id: string
          created_at: string
          created_by: string
          currency: string
          fee_percentage: number | null
          fee_source: string | null
          fixed_fee: number | null
          guarantee_days: number
          guarantee_ends_on: string | null
          id: string
          job_candidate_id: string
          job_id: string
          notes: string | null
          offer_id: string | null
          organization_id: string
          owner_member_id: string | null
          placement_fee: number
          replacement_status: string | null
          salary: number
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          commercial_term_id?: string | null
          company_id: string
          created_at?: string
          created_by: string
          currency: string
          fee_percentage?: number | null
          fee_source?: string | null
          fixed_fee?: number | null
          guarantee_days?: number
          guarantee_ends_on?: string | null
          id?: string
          job_candidate_id: string
          job_id: string
          notes?: string | null
          offer_id?: string | null
          organization_id: string
          owner_member_id?: string | null
          placement_fee: number
          replacement_status?: string | null
          salary: number
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          commercial_term_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          fee_percentage?: number | null
          fee_source?: string | null
          fixed_fee?: number | null
          guarantee_days?: number
          guarantee_ends_on?: string | null
          id?: string
          job_candidate_id?: string
          job_id?: string
          notes?: string | null
          offer_id?: string | null
          organization_id?: string
          owner_member_id?: string | null
          placement_fee?: number
          replacement_status?: string | null
          salary?: number
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "placements_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_commercial_term_id_fkey"
            columns: ["commercial_term_id"]
            isOneToOne: false
            referencedRelation: "commercial_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_job_candidate_id_fkey"
            columns: ["job_candidate_id"]
            isOneToOne: true
            referencedRelation: "job_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accepted_terms_at: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_seen_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          accepted_terms_at?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          accepted_terms_at?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_submission_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          last_accessed_at: string | null
          organization_id: string
          package_id: string
          recipient_email: string | null
          recipient_name: string | null
          revoked_at: string | null
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          last_accessed_at?: string | null
          organization_id: string
          package_id: string
          recipient_email?: string | null
          recipient_name?: string | null
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          organization_id?: string
          package_id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_submission_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_submission_links_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "submission_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_link_events: {
        Row: {
          event_type: string
          id: number
          ip_hash: string | null
          link_id: string
          occurred_at: string
        }
        Insert: {
          event_type: string
          id?: never
          ip_hash?: string | null
          link_id: string
          occurred_at?: string
        }
        Update: {
          event_type?: string
          id?: never
          ip_hash?: string | null
          link_id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_link_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "referral_links"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          label: string | null
          member_id: string | null
          organization_id: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          label?: string | null
          member_id?: string | null
          organization_id: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          member_id?: string | null
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_links_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          candidate_email: string | null
          candidate_full_name: string
          candidate_linkedin_url: string | null
          candidate_note: string | null
          created_at: string
          created_candidate_id: string | null
          id: string
          organization_id: string
          referral_link_id: string | null
          referrer_email: string | null
          referrer_member_id: string | null
          referrer_name: string | null
          resume_path: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_job_id: string | null
        }
        Insert: {
          candidate_email?: string | null
          candidate_full_name: string
          candidate_linkedin_url?: string | null
          candidate_note?: string | null
          created_at?: string
          created_candidate_id?: string | null
          id?: string
          organization_id: string
          referral_link_id?: string | null
          referrer_email?: string | null
          referrer_member_id?: string | null
          referrer_name?: string | null
          resume_path?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_job_id?: string | null
        }
        Update: {
          candidate_email?: string | null
          candidate_full_name?: string
          candidate_linkedin_url?: string | null
          candidate_note?: string | null
          created_at?: string
          created_candidate_id?: string | null
          id?: string
          organization_id?: string
          referral_link_id?: string | null
          referrer_email?: string | null
          referrer_member_id?: string | null
          referrer_name?: string | null
          resume_path?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_created_candidate_id_fkey"
            columns: ["created_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referral_link_id_fkey"
            columns: ["referral_link_id"]
            isOneToOne: false
            referencedRelation: "referral_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_member_id_fkey"
            columns: ["referrer_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_target_job_id_fkey"
            columns: ["target_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          organization_id: string
          role_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          role_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          role_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          columns: Json
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          is_shared: boolean
          name: string
          organization_id: string
          owner_member_id: string
          resource: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name: string
          organization_id: string
          owner_member_id: string
          resource: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          is_shared?: boolean
          name?: string
          organization_id?: string
          owner_member_id?: string
          resource?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          id: string
          name: string
          normalized_name: string
          organization_id: string
        }
        Insert: {
          id?: string
          name: string
          normalized_name: string
          organization_id: string
        }
        Update: {
          id?: string
          name?: string
          normalized_name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_history: {
        Row: {
          changed_by: string | null
          from_stage_id: string | null
          id: string
          job_candidate_id: string
          note: string | null
          occurred_at: string
          organization_id: string
          source: string
          to_stage_id: string
        }
        Insert: {
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          job_candidate_id: string
          note?: string | null
          occurred_at?: string
          organization_id: string
          source?: string
          to_stage_id: string
        }
        Update: {
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          job_candidate_id?: string
          note?: string | null
          occurred_at?: string
          organization_id?: string
          source?: string
          to_stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_history_job_candidate_id_fkey"
            columns: ["job_candidate_id"]
            isOneToOne: false
            referencedRelation: "job_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_documents: {
        Row: {
          candidate_submission_id: string
          created_at: string
          document_id: string
          organization_id: string
        }
        Insert: {
          candidate_submission_id: string
          created_at?: string
          document_id: string
          organization_id: string
        }
        Update: {
          candidate_submission_id?: string
          created_at?: string
          document_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_documents_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_feedback: {
        Row: {
          candidate_submission_id: string
          comments: string | null
          created_at: string
          decision: string
          id: string
          link_id: string
          organization_id: string
          reviewer_name: string | null
          updated_at: string
        }
        Insert: {
          candidate_submission_id: string
          comments?: string | null
          created_at?: string
          decision: string
          id?: string
          link_id: string
          organization_id: string
          reviewer_name?: string | null
          updated_at?: string
        }
        Update: {
          candidate_submission_id?: string
          comments?: string | null
          created_at?: string
          decision?: string
          id?: string
          link_id?: string
          organization_id?: string
          reviewer_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_feedback_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_feedback_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "public_submission_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_link_events: {
        Row: {
          event_type: string
          id: number
          ip_hash: string | null
          link_id: string
          occurred_at: string
        }
        Insert: {
          event_type: string
          id?: never
          ip_hash?: string | null
          link_id: string
          occurred_at?: string
        }
        Update: {
          event_type?: string
          id?: never
          ip_hash?: string | null
          link_id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_link_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "public_submission_links"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_packages: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string
          id: string
          job_id: string
          message: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          job_id: string
          message?: string | null
          organization_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string
          message?: string | null
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_packages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_packages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_links: {
        Row: {
          candidate_id: string | null
          candidate_submission_id: string | null
          company_id: string | null
          contact_id: string | null
          id: string
          job_id: string | null
          organization_id: string
          placement_id: string | null
          task_id: string
        }
        Insert: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          placement_id?: string | null
          task_id: string
        }
        Update: {
          candidate_id?: string | null
          candidate_submission_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          placement_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_candidate_submission_id_fkey"
            columns: ["candidate_submission_id"]
            isOneToOne: false
            referencedRelation: "candidate_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          delivered_at: string | null
          id: string
          organization_id: string
          remind_at: string
          task_id: string
        }
        Insert: {
          delivered_at?: string | null
          id?: string
          organization_id: string
          remind_at: string
          task_id: string
        }
        Update: {
          delivered_at?: string | null
          id?: string
          organization_id?: string
          remind_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          due_at: string | null
          id: string
          organization_id: string
          owner_member_id: string | null
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id: string
          owner_member_id?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id?: string
          owner_member_id?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          configuration: Json
          content: string
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          template_type: string
          updated_at: string
          updated_by: string | null
          variables: Json
          version: number
        }
        Insert: {
          configuration?: Json
          content: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          template_type: string
          updated_at?: string
          updated_by?: string | null
          variables?: Json
          version?: number
        }
        Update: {
          configuration?: Json
          content?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          template_type?: string
          updated_at?: string
          updated_by?: string | null
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_product_events: {
        Row: {
          action_key: string | null
          actor_user_id: string | null
          destination: string | null
          event_name: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          surface: string
        }
        Insert: {
          action_key?: string | null
          actor_user_id?: string | null
          destination?: string | null
          event_name: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          surface: string
        }
        Update: {
          action_key?: string | null
          actor_user_id?: string | null
          destination?: string | null
          event_name?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_product_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_candidate_cv_parse: {
        Args: {
          p_organization_id: string
          p_parse_id: string
          p_payload: Json
          p_target_candidate_id?: string
        }
        Returns: string
      }
      accept_organization_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      accept_referral: {
        Args: { p_organization_id: string; p_referral_id: string }
        Returns: Json
      }
      add_candidates_to_job: {
        Args: {
          p_candidate_ids: string[]
          p_job_id: string
          p_organization_id: string
          p_stage_id?: string
        }
        Returns: {
          added_at: string
          added_by: string
          candidate_id: string
          closed_at: string | null
          current_stage_id: string
          id: string
          job_id: string
          organization_id: string
          owner_member_id: string | null
          source: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_candidates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      anonymize_candidate_for_retention: {
        Args: {
          p_as_of?: string
          p_candidate_id: string
          p_removed_storage_paths?: string[]
        }
        Returns: boolean
      }
      archive_candidate_profile_template: {
        Args: { p_organization_id: string; p_template_id: string }
        Returns: undefined
      }
      audit_function_grants: {
        Args: never
        Returns: {
          function_name: string
          granted_roles: string[]
        }[]
      }
      candidate_is_due_for_retention: {
        Args: { p_as_of?: string; p_candidate_id: string }
        Returns: boolean
      }
      candidate_profile_token_spend_this_month: {
        Args: { p_organization_id: string }
        Returns: number
      }
      candidate_retention_storage_paths: {
        Args: { p_candidate_id: string }
        Returns: string[]
      }
      capture_prospect: {
        Args: {
          p_job_id?: string
          p_kind: string
          p_organization_id: string
          p_payload: Json
        }
        Returns: Json
      }
      capture_prospects_bulk: {
        Args: {
          p_items: Json
          p_job_id?: string
          p_kind: string
          p_organization_id: string
        }
        Returns: Json
      }
      configure_founding_partner: {
        Args: { p_enabled?: boolean; p_organization_id: string }
        Returns: undefined
      }
      create_candidate_with_profile: {
        Args: {
          p_candidate: Json
          p_education?: Json
          p_employment?: Json
          p_languages?: Json
          p_organization_id: string
          p_private?: Json
          p_skills?: Json
        }
        Returns: string
      }
      create_invitation_delivery: {
        Args: {
          p_email: string
          p_expiry_days?: number
          p_organization_id: string
          p_request_key: string
          p_role_id: string
        }
        Returns: Json
      }
      create_job_with_details: {
        Args: {
          p_company_id: string
          p_details?: Json
          p_organization_id: string
          p_owner_member_id?: string
          p_title: string
        }
        Returns: string
      }
      create_job_with_pipeline: {
        Args: {
          p_company_id: string
          p_organization_id: string
          p_owner_member_id?: string
          p_title: string
        }
        Returns: string
      }
      create_organization: {
        Args: {
          p_currency?: string
          p_name: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      create_organization_invitation: {
        Args: {
          p_email: string
          p_expiry_days?: number
          p_organization_id: string
          p_role_id: string
        }
        Returns: Json
      }
      create_placement_from_offer: {
        Args: {
          p_fee: number
          p_fee_source?: string
          p_guarantee_days?: number
          p_offer_id: string
        }
        Returns: string
      }
      create_placement_revenue_split: {
        Args: {
          p_member_id: string
          p_organization_id: string
          p_percentage: number
          p_placement_id: string
        }
        Returns: string
      }
      create_referral_link: {
        Args: {
          p_expiry_days?: number
          p_label?: string
          p_member_id?: string
          p_organization_id: string
        }
        Returns: Json
      }
      create_submission_delivery: {
        Args: {
          p_contact_id?: string
          p_expiry_days?: number
          p_items: Json
          p_job_id: string
          p_message?: string
          p_organization_id: string
          p_recipient_email?: string
          p_recipient_name?: string
          p_request_key: string
          p_title: string
        }
        Returns: Json
      }
      create_submission_package: {
        Args: {
          p_contact_id?: string
          p_expiry_days?: number
          p_items: Json
          p_job_id: string
          p_message?: string
          p_organization_id: string
          p_recipient_email?: string
          p_recipient_name?: string
          p_title: string
        }
        Returns: Json
      }
      create_task_with_link: {
        Args: {
          p_description?: string
          p_due_at?: string
          p_link_id?: string
          p_link_type?: string
          p_organization_id: string
          p_owner_member_id?: string
          p_priority?: string
          p_title: string
        }
        Returns: string
      }
      default_candidate_profile_configuration: {
        Args: { p_language?: string }
        Returns: Json
      }
      finalize_candidate_profile: {
        Args: {
          p_anonymized: boolean
          p_docx_document_id: string
          p_edited_field_count?: number
          p_organization_id: string
          p_pdf_document_id?: string
          p_profile_version_id: string
          p_reviewed_content: Json
        }
        Returns: string
      }
      finalize_email_delivery: {
        Args: {
          p_delivery_id: string
          p_error_code?: string
          p_error_message?: string
          p_provider_message_id?: string
          p_status: string
        }
        Returns: string
      }
      get_my_access_state: { Args: never; Returns: Json }
      has_permission: {
        Args: { p_organization_id: string; p_permission: string }
        Returns: boolean
      }
      is_organization_member: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      list_candidate_skill_names: {
        Args: { p_organization_id: string }
        Returns: {
          name: string
        }[]
      }
      list_candidate_tag_names: {
        Args: { p_organization_id: string }
        Returns: {
          name: string
        }[]
      }
      list_candidates_due_for_retention: {
        Args: { p_as_of?: string; p_limit?: number }
        Returns: {
          candidate_id: string
          storage_paths: string[]
        }[]
      }
      list_company_pipeline: {
        Args: { p_organization_id: string }
        Returns: {
          account_status: string
          active_candidates: number
          business_development_stage: string
          contact_count: number
          currency: string
          expected_open_fee: number
          fee_percentage: number
          fee_type: string
          fixed_fee: number
          guarantee_days: number
          id: string
          industry: string
          last_activity_at: string
          location: string
          name: string
          next_follow_up_at: string
          open_jobs: number
          owner_member_id: string
          owner_name: string
          placements: number
          terms_effective_to: string
          terms_status: string
          updated_at: string
        }[]
      }
      list_job_health: {
        Args: { p_candidate_id?: string; p_organization_id: string }
        Returns: {
          already_in_job: boolean
          candidate_count: number
          company_id: string
          company_name: string
          currency: string
          days_open: number
          expected_fee: number
          fee_percentage: number
          fee_source: string
          fixed_fee: number
          id: string
          last_activity_at: string
          location: string
          next_action: string
          opened_at: string
          owner_member_id: string
          owner_name: string
          phase_counts: Json
          pipeline_id: string
          priority: string
          salary_max: number
          salary_min: number
          status: string
          title: string
          updated_at: string
          waiting_count: number
        }[]
      }
      log_activity: {
        Args: {
          p_actor?: string
          p_direction?: string
          p_links?: Json
          p_occurred_at?: string
          p_organization_id: string
          p_subject?: string
          p_summary: string
          p_type: string
        }
        Returns: string
      }
      log_manual_activity: {
        Args: {
          p_direction?: string
          p_links?: Json
          p_occurred_at?: string
          p_organization_id: string
          p_subject?: string
          p_summary: string
          p_type: string
        }
        Returns: string
      }
      lookup_prospects_by_linkedin: {
        Args: { p_linkedin_urls: string[]; p_organization_id: string }
        Returns: Json
      }
      mark_calendar_sync_failed: {
        Args: { p_interview_id: string; p_message: string }
        Returns: undefined
      }
      merge_candidates: {
        Args: {
          p_kept_candidate_id: string
          p_merged_candidate_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: string
      }
      move_job_candidate_stage: {
        Args: {
          p_job_candidate_id: string
          p_note?: string
          p_source?: string
          p_stage_id: string
        }
        Returns: {
          added_at: string
          added_by: string
          candidate_id: string
          closed_at: string | null
          current_stage_id: string
          id: string
          job_id: string
          organization_id: string
          owner_member_id: string | null
          source: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "job_candidates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      normalize_email: { Args: { value: string }; Returns: string }
      preview_candidate_retention: {
        Args: { p_organization_id: string }
        Returns: {
          due_count: number
          legal_hold_count: number
          oldest_due_at: string
        }[]
      }
      provision_initial_organization_owner: {
        Args: {
          p_currency?: string
          p_name: string
          p_owner_email: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      queue_interview_cancellation: {
        Args: { p_interview_id: string; p_organization_id: string }
        Returns: {
          delivery_id: string
          delivery_status: string
          recipient_email: string
        }[]
      }
      record_audit_event: {
        Args: {
          p_action: string
          p_entity_id?: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id: string
        }
        Returns: undefined
      }
      record_candidate_profile_export_failure: {
        Args: {
          p_organization_id: string
          p_profile_version_id: string
          p_reason: string
        }
        Returns: undefined
      }
      redact_expired_import_payloads: {
        Args: { p_before?: string }
        Returns: number
      }
      replace_candidate_profile_section: {
        Args: {
          p_candidate_id: string
          p_items: Json
          p_organization_id: string
          p_section: string
        }
        Returns: undefined
      }
      request_ip_hash: { Args: never; Returns: string }
      resolve_referral_link: { Args: { p_token: string }; Returns: Json }
      resolve_submission_documents: {
        Args: { p_token: string }
        Returns: {
          document_id: string
          filename: string
          mime_type: string
          storage_path: string
        }[]
      }
      resolve_submission_link: { Args: { p_token: string }; Returns: Json }
      revoke_organization_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      revoke_submission_link: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      save_candidate_profile_template: {
        Args: {
          p_configuration: Json
          p_is_default?: boolean
          p_name: string
          p_organization_id: string
          p_template_id: string
        }
        Returns: string
      }
      search_candidates_page: {
        Args: {
          p_availability?: string
          p_consent_status?: string
          p_direction?: string
          p_limit?: number
          p_location?: string
          p_offset?: number
          p_organization_id: string
          p_owner_member_id?: string
          p_query?: string
          p_skill?: string
          p_sort?: string
          p_source?: string
          p_status?: string
          p_tag?: string
        }
        Returns: {
          availability: string
          consent_status: string
          created_at: string
          current_company: string
          current_position: string
          full_name: string
          id: string
          linkedin_url: string
          location: string
          organization_id: string
          owner_member_id: string
          owner_name: string
          skill_names: string[]
          source: string
          status: string
          tag_names: string[]
          total_count: number
          updated_at: string
        }[]
      }
      search_workspace: {
        Args: { p_limit?: number; p_organization_id: string; p_query: string }
        Returns: {
          entity_id: string
          entity_type: string
          rank: number
          subtitle: string
          title: string
        }[]
      }
      seed_organization_roles: {
        Args: { p_organization_id: string }
        Returns: {
          role_id: string
          role_key: string
        }[]
      }
      set_candidate_legal_hold: {
        Args: {
          p_candidate_id: string
          p_legal_hold: boolean
          p_organization_id: string
          p_reason: string
        }
        Returns: undefined
      }
      set_company_bd_stage: {
        Args: {
          p_company_id: string
          p_note?: string
          p_organization_id: string
          p_stage: string
        }
        Returns: {
          account_status: string
          business_development_stage: string
          company_size: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          industry: string | null
          location: string | null
          name: string
          notes_summary: string | null
          organization_id: string
          owner_member_id: string | null
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_company_default_fee: {
        Args: {
          p_agreement_document_url?: string
          p_approval_status?: string
          p_company_id: string
          p_currency: string
          p_fee_percentage: number
          p_fee_type: string
          p_fixed_fee: number
          p_guarantee_days?: number
          p_notes?: string
          p_organization_id: string
          p_payment_terms_days?: number
          p_replacement_terms?: string
          p_tax_treatment?: string
        }
        Returns: string
      }
      storage_prefix_organization: { Args: { p_name: string }; Returns: string }
      submit_internal_referral: {
        Args: { p_organization_id: string; p_payload: Json }
        Returns: string
      }
      submit_referral: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      submit_submission_feedback: {
        Args: {
          p_candidate_submission_id: string
          p_comments?: string
          p_decision: string
          p_reviewer_name?: string
          p_token: string
        }
        Returns: Json
      }
      update_candidate_profile: {
        Args: {
          p_candidate: Json
          p_candidate_id: string
          p_organization_id: string
          p_private: Json
        }
        Returns: undefined
      }
      update_candidate_with_profile: {
        Args: {
          p_candidate: Json
          p_candidate_id: string
          p_education?: Json
          p_employment?: Json
          p_languages?: Json
          p_organization_id: string
          p_private: Json
          p_skills?: Json
        }
        Returns: undefined
      }
      update_member_access: {
        Args: {
          p_member_id: string
          p_organization_id: string
          p_role_id: string
          p_status: string
        }
        Returns: undefined
      }
      update_organization_salary_period: {
        Args: { p_organization_id: string; p_salary_period: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
