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
  public: {
    Tables: {
      account_activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          description: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      address_book_contacts: {
        Row: {
          address: string | null
          athlete_id: string | null
          coach_user_id: string
          contact_kind: string
          created_at: string
          email: string | null
          id: string
          linked_athlete_id: string | null
          name: string | null
          notes: string | null
          organisation: string | null
          parent_user_id: string | null
          phone: string | null
          phone_alt: string | null
          role_label: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          athlete_id?: string | null
          coach_user_id: string
          contact_kind: string
          created_at?: string
          email?: string | null
          id?: string
          linked_athlete_id?: string | null
          name?: string | null
          notes?: string | null
          organisation?: string | null
          parent_user_id?: string | null
          phone?: string | null
          phone_alt?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          athlete_id?: string | null
          coach_user_id?: string
          contact_kind?: string
          created_at?: string
          email?: string | null
          id?: string
          linked_athlete_id?: string | null
          name?: string | null
          notes?: string | null
          organisation?: string | null
          parent_user_id?: string | null
          phone?: string | null
          phone_alt?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "address_book_contacts_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_book_contacts_linked_athlete_id_fkey"
            columns: ["linked_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_athlete_notes: {
        Row: {
          athlete_id: string
          content: string
          created_at: string
          id: string
          kind: string
          note_date: string
          session_id: string | null
        }
        Insert: {
          athlete_id: string
          content: string
          created_at?: string
          id?: string
          kind: string
          note_date: string
          session_id?: string | null
        }
        Update: {
          athlete_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          note_date?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_athlete_notes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_athlete_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          tokens: number | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          tokens?: number | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_threads: {
        Row: {
          athlete_id: string | null
          coach_id: string
          created_at: string
          id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          athlete_id?: string | null
          coach_id: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string | null
          coach_id?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_threads_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reviews: {
        Row: {
          athlete_id: string
          coach_id: string
          content_md: string
          created_at: string
          id: string
          meta: Json | null
          period_end: string
          period_start: string
          review_type: string | null
          session_id: string | null
          source: string
          thread_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          content_md: string
          created_at?: string
          id?: string
          meta?: Json | null
          period_end: string
          period_start: string
          review_type?: string | null
          session_id?: string | null
          source?: string
          thread_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          content_md?: string
          created_at?: string
          id?: string
          meta?: Json | null
          period_end?: string
          period_start?: string
          review_type?: string | null
          session_id?: string | null
          source?: string
          thread_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reviews_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reviews_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_squad_reviews: {
        Row: {
          athlete_ids: string[]
          coach_id: string
          content_md: string
          created_at: string
          id: string
          period_end: string
          period_start: string
          review_type: string
        }
        Insert: {
          athlete_ids: string[]
          coach_id: string
          content_md: string
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          review_type: string
        }
        Update: {
          athlete_ids?: string[]
          coach_id?: string
          content_md?: string
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          review_type?: string
        }
        Relationships: []
      }
      ai_usage_daily: {
        Row: {
          call_count: number
          used_date: string
          user_id: string
        }
        Insert: {
          call_count?: number
          used_date?: string
          user_id: string
        }
        Update: {
          call_count?: number
          used_date?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_weekly_summaries: {
        Row: {
          athlete_id: string
          generated_at: string
          id: string
          summary_md: string
          week_start: string
        }
        Insert: {
          athlete_id: string
          generated_at?: string
          id?: string
          summary_md: string
          week_start: string
        }
        Update: {
          athlete_id?: string
          generated_at?: string
          id?: string
          summary_md?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_weekly_summaries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_dismissals: {
        Row: {
          alert_type: string
          athlete_id: string
          coach_user_id: string
          created_at: string
          dismissed_date: string
          id: string
        }
        Insert: {
          alert_type: string
          athlete_id: string
          coach_user_id: string
          created_at?: string
          dismissed_date?: string
          id?: string
        }
        Update: {
          alert_type?: string
          athlete_id?: string
          coach_user_id?: string
          created_at?: string
          dismissed_date?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_dismissals_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_blog_posts: {
        Row: {
          athlete_id: string
          content: string
          cover_image_url: string | null
          created_at: string
          excerpt: string
          id: string
          is_published: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          content?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string
          id?: string
          is_published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          content?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string
          id?: string
          is_published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_blog_posts_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_credentials: {
        Row: {
          athlete_id: string
          club_name: string | null
          federation_id: string | null
          membership_number: string | null
          notes: string | null
          registration_expiry: string | null
          registration_status: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          club_name?: string | null
          federation_id?: string | null
          membership_number?: string | null
          notes?: string | null
          registration_expiry?: string | null
          registration_status?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          club_name?: string | null
          federation_id?: string | null
          membership_number?: string | null
          notes?: string | null
          registration_expiry?: string | null
          registration_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_credentials_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_dna_ratings: {
        Row: {
          aerobic_capacity_bucket: string | null
          aerobic_capacity_score: number | null
          anaerobic_capacity_bucket: string | null
          anaerobic_capacity_score: number | null
          athlete_id: string
          consistency_bucket: string | null
          consistency_score: number | null
          consistency_sessions_completed: number | null
          consistency_sessions_planned: number | null
          durability_status: string
          endurance_bucket: string | null
          endurance_score: number | null
          mechanical_efficiency_status: string
          race_intelligence_status: string
          running_economy_status: string
          speed_bucket: string | null
          speed_score: number | null
          status: string
          tactical_awareness_status: string
          updated_at: string
        }
        Insert: {
          aerobic_capacity_bucket?: string | null
          aerobic_capacity_score?: number | null
          anaerobic_capacity_bucket?: string | null
          anaerobic_capacity_score?: number | null
          athlete_id: string
          consistency_bucket?: string | null
          consistency_score?: number | null
          consistency_sessions_completed?: number | null
          consistency_sessions_planned?: number | null
          durability_status?: string
          endurance_bucket?: string | null
          endurance_score?: number | null
          mechanical_efficiency_status?: string
          race_intelligence_status?: string
          running_economy_status?: string
          speed_bucket?: string | null
          speed_score?: number | null
          status?: string
          tactical_awareness_status?: string
          updated_at?: string
        }
        Update: {
          aerobic_capacity_bucket?: string | null
          aerobic_capacity_score?: number | null
          anaerobic_capacity_bucket?: string | null
          anaerobic_capacity_score?: number | null
          athlete_id?: string
          consistency_bucket?: string | null
          consistency_score?: number | null
          consistency_sessions_completed?: number | null
          consistency_sessions_planned?: number | null
          durability_status?: string
          endurance_bucket?: string | null
          endurance_score?: number | null
          mechanical_efficiency_status?: string
          race_intelligence_status?: string
          running_economy_status?: string
          speed_bucket?: string | null
          speed_score?: number | null
          status?: string
          tactical_awareness_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_dna_ratings_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_goals: {
        Row: {
          athlete_id: string
          created_at: string
          created_by: string | null
          distance_m: number | null
          goal_type: string
          id: string
          is_primary: boolean
          notes: string | null
          performance_id: string | null
          priority: string | null
          race_date: string | null
          race_type: string | null
          status: string
          target_date: string | null
          target_time_seconds: number | null
          title: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          created_by?: string | null
          distance_m?: number | null
          goal_type: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          performance_id?: string | null
          priority?: string | null
          race_date?: string | null
          race_type?: string | null
          status?: string
          target_date?: string | null
          target_time_seconds?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          created_by?: string | null
          distance_m?: number | null
          goal_type?: string
          id?: string
          is_primary?: boolean
          notes?: string | null
          performance_id?: string | null
          priority?: string | null
          race_date?: string | null
          race_type?: string | null
          status?: string
          target_date?: string | null
          target_time_seconds?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_goals_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_goals_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_invites: {
        Row: {
          accepted_at: string | null
          athlete_id: string
          coach_user_id: string
          created_at: string
          email: string
          id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          athlete_id: string
          coach_user_id: string
          created_at?: string
          email: string
          id?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          athlete_id?: string
          coach_user_id?: string
          created_at?: string
          email?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_invites_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_join_requests: {
        Row: {
          athlete_id: string
          coach_user_id: string
          created_at: string
          id: string
          message: string | null
          responded_at: string | null
          status: string
          target_user_id: string
        }
        Insert: {
          athlete_id: string
          coach_user_id: string
          created_at?: string
          id?: string
          message?: string | null
          responded_at?: string | null
          status?: string
          target_user_id: string
        }
        Update: {
          athlete_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          message?: string | null
          responded_at?: string | null
          status?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_join_requests_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_load_daily: {
        Row: {
          athlete_id: string
          atl: number | null
          checkin_score: number | null
          combined_load: number | null
          confidence: string | null
          ctl: number | null
          data_days: number | null
          external_load_total: number | null
          load_balance_score: number | null
          load_date: string
          load_ratio: number | null
          readiness_score: number | null
          readiness_status:
            | Database["public"]["Enums"]["readiness_status"]
            | null
          training_load: number | null
          tsb: number | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          atl?: number | null
          checkin_score?: number | null
          combined_load?: number | null
          confidence?: string | null
          ctl?: number | null
          data_days?: number | null
          external_load_total?: number | null
          load_balance_score?: number | null
          load_date: string
          load_ratio?: number | null
          readiness_score?: number | null
          readiness_status?:
            | Database["public"]["Enums"]["readiness_status"]
            | null
          training_load?: number | null
          tsb?: number | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          atl?: number | null
          checkin_score?: number | null
          combined_load?: number | null
          confidence?: string | null
          ctl?: number | null
          data_days?: number | null
          external_load_total?: number | null
          load_balance_score?: number | null
          load_date?: string
          load_ratio?: number | null
          readiness_score?: number | null
          readiness_status?:
            | Database["public"]["Enums"]["readiness_status"]
            | null
          training_load?: number | null
          tsb?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_load_daily_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_personal_calendar_entries: {
        Row: {
          active: boolean
          athlete_id: string
          category: Database["public"]["Enums"]["personal_entry_category"]
          created_at: string
          created_by: string | null
          day_of_week: number | null
          end_time: string | null
          id: string
          injury_id: string | null
          location_text: string | null
          notes: string | null
          specific_date: string | null
          start_time: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          athlete_id: string
          category?: Database["public"]["Enums"]["personal_entry_category"]
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          end_time?: string | null
          id?: string
          injury_id?: string | null
          location_text?: string | null
          notes?: string | null
          specific_date?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          athlete_id?: string
          category?: Database["public"]["Enums"]["personal_entry_category"]
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          end_time?: string | null
          id?: string
          injury_id?: string | null
          location_text?: string | null
          notes?: string | null
          specific_date?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_personal_calendar_entries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_personal_calendar_entries_injury_id_fkey"
            columns: ["injury_id"]
            isOneToOne: false
            referencedRelation: "injuries"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_physio_profile: {
        Row: {
          aerobic_pct: number | null
          anaerobic_pct: number | null
          archetype: string | null
          archetype_override: string | null
          archetype_override_note: string | null
          athlete_id: string
          coaching_note: string | null
          inputs: Json | null
          speed_reserve_bucket: string | null
          speed_reserve_pct: number | null
          status: string
          updated_at: string
        }
        Insert: {
          aerobic_pct?: number | null
          anaerobic_pct?: number | null
          archetype?: string | null
          archetype_override?: string | null
          archetype_override_note?: string | null
          athlete_id: string
          coaching_note?: string | null
          inputs?: Json | null
          speed_reserve_bucket?: string | null
          speed_reserve_pct?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          aerobic_pct?: number | null
          anaerobic_pct?: number | null
          archetype?: string | null
          archetype_override?: string | null
          archetype_override_note?: string | null
          athlete_id?: string
          coaching_note?: string | null
          inputs?: Json | null
          speed_reserve_bucket?: string | null
          speed_reserve_pct?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_physio_profile_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_physiological_tests: {
        Row: {
          athlete_id: string
          confidence: string
          created_at: string
          created_by: string | null
          id: string
          measurement_type: string
          method: string | null
          metric: string
          notes: string | null
          previous_test_date: string | null
          previous_value: number | null
          source: string
          test_date: string
          unit: string | null
          value: number
        }
        Insert: {
          athlete_id: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          id?: string
          measurement_type: string
          method?: string | null
          metric: string
          notes?: string | null
          previous_test_date?: string | null
          previous_value?: number | null
          source: string
          test_date?: string
          unit?: string | null
          value: number
        }
        Update: {
          athlete_id?: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          id?: string
          measurement_type?: string
          method?: string | null
          metric?: string
          notes?: string | null
          previous_test_date?: string | null
          previous_value?: number | null
          source?: string
          test_date?: string
          unit?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "athlete_physiological_tests_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_plan_sessions: {
        Row: {
          athlete_plan_id: string
          id: string
          session_id: string
          week_number: number
        }
        Insert: {
          athlete_plan_id: string
          id?: string
          session_id: string
          week_number: number
        }
        Update: {
          athlete_plan_id?: string
          id?: string
          session_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "athlete_plan_sessions_athlete_plan_id_fkey"
            columns: ["athlete_plan_id"]
            isOneToOne: false
            referencedRelation: "athlete_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_plan_sessions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_plans: {
        Row: {
          athlete_id: string
          created_at: string
          created_by: string | null
          duration_weeks: number
          goal_id: string | null
          id: string
          name: string
          plan_template_id: string | null
          start_date: string
          status: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          created_by?: string | null
          duration_weeks: number
          goal_id?: string | null
          id?: string
          name: string
          plan_template_id?: string | null
          start_date: string
          status?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          created_by?: string | null
          duration_weeks?: number
          goal_id?: string | null
          id?: string
          name?: string
          plan_template_id?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_plans_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_plans_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "athlete_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_plans_plan_template_id_fkey"
            columns: ["plan_template_id"]
            isOneToOne: false
            referencedRelation: "plan_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_profiles: {
        Row: {
          achievements: string[]
          alternate_section_backgrounds: boolean
          athlete_id: string
          bio: string | null
          brand_color: string
          contact: Json | null
          created_at: string
          disciplines: string[]
          donate_label: string | null
          donate_url: string | null
          gallery_aspect: string
          gallery_columns: number
          gallery_image_positions: Json
          gallery_images: string[]
          hero_image_position_x: number
          hero_image_position_y: number
          hero_image_side: string
          hero_image_url: string | null
          id: string
          is_published: boolean
          nav: string
          secondary_color: string | null
          section_density: string
          section_order: Json
          sections_enabled: Json
          slug: string
          sponsors: Json
          stats: Json
          style: string
          tagline: string | null
          theme: string
          training_partners_added: Json
          training_partners_hidden_ids: string[]
          updated_at: string
        }
        Insert: {
          achievements?: string[]
          alternate_section_backgrounds?: boolean
          athlete_id: string
          bio?: string | null
          brand_color?: string
          contact?: Json | null
          created_at?: string
          disciplines?: string[]
          donate_label?: string | null
          donate_url?: string | null
          gallery_aspect?: string
          gallery_columns?: number
          gallery_image_positions?: Json
          gallery_images?: string[]
          hero_image_position_x?: number
          hero_image_position_y?: number
          hero_image_side?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          nav?: string
          secondary_color?: string | null
          section_density?: string
          section_order?: Json
          sections_enabled?: Json
          slug: string
          sponsors?: Json
          stats?: Json
          style?: string
          tagline?: string | null
          theme?: string
          training_partners_added?: Json
          training_partners_hidden_ids?: string[]
          updated_at?: string
        }
        Update: {
          achievements?: string[]
          alternate_section_backgrounds?: boolean
          athlete_id?: string
          bio?: string | null
          brand_color?: string
          contact?: Json | null
          created_at?: string
          disciplines?: string[]
          donate_label?: string | null
          donate_url?: string | null
          gallery_aspect?: string
          gallery_columns?: number
          gallery_image_positions?: Json
          gallery_images?: string[]
          hero_image_position_x?: number
          hero_image_position_y?: number
          hero_image_side?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          nav?: string
          secondary_color?: string | null
          section_density?: string
          section_order?: Json
          sections_enabled?: Json
          slug?: string
          sponsors?: Json
          stats?: Json
          style?: string
          tagline?: string | null
          theme?: string
          training_partners_added?: Json
          training_partners_hidden_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_profiles_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_race_observations: {
        Row: {
          athlete_id: string
          created_at: string
          created_by: string | null
          id: string
          observation: string
          performance_id: string | null
          source_type: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          observation: string
          performance_id?: string | null
          source_type: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          observation?: string
          performance_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_race_observations_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_race_observations_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_race_selections: {
        Row: {
          assigned_by: string | null
          athlete_id: string
          created_at: string
          id: string
          race_schedule_entry_id: string
          selected_event: string | null
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          athlete_id: string
          created_at?: string
          id?: string
          race_schedule_entry_id: string
          selected_event?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          athlete_id?: string
          created_at?: string
          id?: string
          race_schedule_entry_id?: string
          selected_event?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_race_selections_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_race_selections_race_schedule_entry_id_fkey"
            columns: ["race_schedule_entry_id"]
            isOneToOne: false
            referencedRelation: "race_schedule_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_race_selections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_seasons: {
        Row: {
          athlete_id: string
          created_at: string
          end_date: string
          id: string
          label: string
          season_type: string
          start_date: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          end_date: string
          id?: string
          label: string
          season_type: string
          start_date: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          end_date?: string
          id?: string
          label?: string
          season_type?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_seasons_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_strengths_ratings: {
        Row: {
          athlete_id: string
          category: string
          id: string
          note: string | null
          rating: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          athlete_id: string
          category: string
          id?: string
          note?: string | null
          rating?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          athlete_id?: string
          category?: string
          id?: string
          note?: string | null
          rating?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_strengths_ratings_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_training_response_notes: {
        Row: {
          athlete_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_training_response_notes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_training_response_overrides: {
        Row: {
          athlete_id: string
          coach_note: string | null
          dismissed: boolean
          id: string
          observation_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          athlete_id: string
          coach_note?: string | null
          dismissed?: boolean
          id?: string
          observation_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          athlete_id?: string
          coach_note?: string | null
          dismissed?: boolean
          id?: string
          observation_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_training_response_overrides_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_zone_calculator_saves: {
        Row: {
          athlete_id: string
          basis: string
          created_at: string
          created_by: string | null
          id: string
          inputs: Json | null
          label: string
          method: string
          threshold_hr_bpm: number | null
          threshold_pace_sec_per_km: number | null
        }
        Insert: {
          athlete_id: string
          basis: string
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json | null
          label: string
          method: string
          threshold_hr_bpm?: number | null
          threshold_pace_sec_per_km?: number | null
        }
        Update: {
          athlete_id?: string
          basis?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json | null
          label?: string
          method?: string
          threshold_hr_bpm?: number | null
          threshold_pace_sec_per_km?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_zone_calculator_saves_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_zone_profiles: {
        Row: {
          athlete_id: string
          auto_derived: boolean
          hr_max: number | null
          hr_method: string | null
          hr_threshold: number | null
          hr_threshold_source: string
          hr_z1_max: number | null
          hr_z2_max: number | null
          hr_z3_max: number | null
          hr_z4_max: number | null
          hr_z5_max: number | null
          hr_z6_max: number | null
          hr_zones_manual: boolean
          pace_1500_sec_per_km: number | null
          pace_5k_sec_per_km: number | null
          pace_easy_sec_per_km: number | null
          pace_method: string | null
          pace_rep_sec_per_km: number | null
          pace_threshold_sec_per_km: number | null
          pace_threshold_source: string
          pace_z1_max_sec_per_km: number | null
          pace_z2_max_sec_per_km: number | null
          pace_z3_max_sec_per_km: number | null
          pace_z4_max_sec_per_km: number | null
          pace_z5_max_sec_per_km: number | null
          pace_z6_max_sec_per_km: number | null
          pace_zones_manual: boolean
          preferred_zone_basis: string
          updated_at: string
          vdot: number | null
          vdot_source_override: boolean
          vdot_source_performance_id: string | null
        }
        Insert: {
          athlete_id: string
          auto_derived?: boolean
          hr_max?: number | null
          hr_method?: string | null
          hr_threshold?: number | null
          hr_threshold_source?: string
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          hr_z6_max?: number | null
          hr_zones_manual?: boolean
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_method?: string | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
          pace_threshold_source?: string
          pace_z1_max_sec_per_km?: number | null
          pace_z2_max_sec_per_km?: number | null
          pace_z3_max_sec_per_km?: number | null
          pace_z4_max_sec_per_km?: number | null
          pace_z5_max_sec_per_km?: number | null
          pace_z6_max_sec_per_km?: number | null
          pace_zones_manual?: boolean
          preferred_zone_basis?: string
          updated_at?: string
          vdot?: number | null
          vdot_source_override?: boolean
          vdot_source_performance_id?: string | null
        }
        Update: {
          athlete_id?: string
          auto_derived?: boolean
          hr_max?: number | null
          hr_method?: string | null
          hr_threshold?: number | null
          hr_threshold_source?: string
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          hr_z6_max?: number | null
          hr_zones_manual?: boolean
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_method?: string | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
          pace_threshold_source?: string
          pace_z1_max_sec_per_km?: number | null
          pace_z2_max_sec_per_km?: number | null
          pace_z3_max_sec_per_km?: number | null
          pace_z4_max_sec_per_km?: number | null
          pace_z5_max_sec_per_km?: number | null
          pace_z6_max_sec_per_km?: number | null
          pace_zones_manual?: boolean
          preferred_zone_basis?: string
          updated_at?: string
          vdot?: number | null
          vdot_source_override?: boolean
          vdot_source_performance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_zone_profiles_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_zone_profiles_vdot_source_performance_id_fkey"
            columns: ["vdot_source_performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          athlete_status: string
          club: string | null
          created_at: string
          created_by: string | null
          distance_unit: string
          dob: string | null
          email: string | null
          height_cm: number | null
          hr_max: number | null
          hr_rest: number | null
          id: string
          last_checkout_at: string | null
          last_log_at: string | null
          mechanics_level: string
          name: string
          primary_event: string | null
          profile_image_url: string | null
          reminder_evening_local: string | null
          reminder_morning_local: string | null
          reminders_enabled: boolean
          secondary_events: string[] | null
          seed_atl: number | null
          seed_ctl: number | null
          seed_set_at: string | null
          sex: string | null
          speed_profile_manual_400m_sec: number | null
          speed_profile_manual_date: string | null
          speed_profile_manual_reason: string | null
          speed_profile_mode: string
          timezone: string
          training_age_years: number | null
          typical_training_frequency: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          athlete_status?: string
          club?: string | null
          created_at?: string
          created_by?: string | null
          distance_unit?: string
          dob?: string | null
          email?: string | null
          height_cm?: number | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          last_checkout_at?: string | null
          last_log_at?: string | null
          mechanics_level?: string
          name: string
          primary_event?: string | null
          profile_image_url?: string | null
          reminder_evening_local?: string | null
          reminder_morning_local?: string | null
          reminders_enabled?: boolean
          secondary_events?: string[] | null
          seed_atl?: number | null
          seed_ctl?: number | null
          seed_set_at?: string | null
          sex?: string | null
          speed_profile_manual_400m_sec?: number | null
          speed_profile_manual_date?: string | null
          speed_profile_manual_reason?: string | null
          speed_profile_mode?: string
          timezone?: string
          training_age_years?: number | null
          typical_training_frequency?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          athlete_status?: string
          club?: string | null
          created_at?: string
          created_by?: string | null
          distance_unit?: string
          dob?: string | null
          email?: string | null
          height_cm?: number | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          last_checkout_at?: string | null
          last_log_at?: string | null
          mechanics_level?: string
          name?: string
          primary_event?: string | null
          profile_image_url?: string | null
          reminder_evening_local?: string | null
          reminder_morning_local?: string | null
          reminders_enabled?: boolean
          secondary_events?: string[] | null
          seed_atl?: number | null
          seed_ctl?: number | null
          seed_set_at?: string | null
          sex?: string | null
          speed_profile_manual_400m_sec?: number | null
          speed_profile_manual_date?: string | null
          speed_profile_manual_reason?: string | null
          speed_profile_mode?: string
          timezone?: string
          training_age_years?: number | null
          typical_training_frequency?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bicarb_log: {
        Row: {
          athlete_id: string
          created_at: string
          dose_g: number | null
          id: string
          log_date: string
          notes: string | null
          product: string | null
          session_id: string | null
          timing_minutes_before: number | null
          tolerance: number | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          dose_g?: number | null
          id?: string
          log_date: string
          notes?: string | null
          product?: string | null
          session_id?: string | null
          timing_minutes_before?: number | null
          tolerance?: number | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          dose_g?: number | null
          id?: string
          log_date?: string
          notes?: string | null
          product?: string | null
          session_id?: string | null
          timing_minutes_before?: number | null
          tolerance?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bicarb_log_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bicarb_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_athletes: {
        Row: {
          athlete_id: string
          coach_user_id: string
          created_at: string
          id: string
          visible_on_coach_page: boolean
        }
        Insert: {
          athlete_id: string
          coach_user_id: string
          created_at?: string
          id?: string
          visible_on_coach_page?: boolean
        }
        Update: {
          athlete_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          visible_on_coach_page?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "coach_athletes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_blog_posts: {
        Row: {
          coach_user_id: string
          content: string
          cover_image_url: string | null
          created_at: string
          excerpt: string
          id: string
          is_published: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          coach_user_id: string
          content?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string
          id?: string
          is_published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          coach_user_id?: string
          content?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string
          id?: string
          is_published?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_inquiries: {
        Row: {
          coach_user_id: string
          created_at: string
          discipline: string | null
          email: string
          id: string
          message: string | null
          name: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string
          discipline?: string | null
          email: string
          id?: string
          message?: string | null
          name: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          discipline?: string | null
          email?: string
          id?: string
          message?: string | null
          name?: string
        }
        Relationships: []
      }
      coach_personal_calendar_entries: {
        Row: {
          active: boolean
          category: string
          coach_user_id: string
          created_at: string
          day_of_week: number | null
          id: string
          notes: string | null
          specific_date: string | null
          start_time: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          coach_user_id: string
          created_at?: string
          day_of_week?: number | null
          id?: string
          notes?: string | null
          specific_date?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          coach_user_id?: string
          created_at?: string
          day_of_week?: number | null
          id?: string
          notes?: string | null
          specific_date?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_profiles: {
        Row: {
          achievements: Json
          alternate_section_backgrounds: boolean
          bio: string | null
          brand_color: string | null
          certifications: string[] | null
          coach_photo_url: string | null
          coach_user_id: string | null
          coaching_philosophy: string | null
          contact: Json | null
          created_at: string | null
          disciplines: string[] | null
          gallery_aspect: string
          gallery_columns: number
          gallery_image_positions: Json
          gallery_images: string[] | null
          hero_image_position_x: number
          hero_image_position_y: number
          hero_image_side: string
          hero_image_url: string | null
          id: string
          is_published: boolean
          location: Json | null
          logo_image_url: string | null
          logo_initials: string | null
          logo_url: string | null
          name: string
          nav: string | null
          plans: Json | null
          sample_sessions: Json | null
          secondary_color: string | null
          section_density: string
          section_order: Json
          sections_enabled: Json
          slug: string
          sponsors: Json
          stats: Json | null
          style: string | null
          tagline: string | null
          team_name: string | null
          testimonials: Json | null
          theme: string | null
        }
        Insert: {
          achievements?: Json
          alternate_section_backgrounds?: boolean
          bio?: string | null
          brand_color?: string | null
          certifications?: string[] | null
          coach_photo_url?: string | null
          coach_user_id?: string | null
          coaching_philosophy?: string | null
          contact?: Json | null
          created_at?: string | null
          disciplines?: string[] | null
          gallery_aspect?: string
          gallery_columns?: number
          gallery_image_positions?: Json
          gallery_images?: string[] | null
          hero_image_position_x?: number
          hero_image_position_y?: number
          hero_image_side?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          location?: Json | null
          logo_image_url?: string | null
          logo_initials?: string | null
          logo_url?: string | null
          name: string
          nav?: string | null
          plans?: Json | null
          sample_sessions?: Json | null
          secondary_color?: string | null
          section_density?: string
          section_order?: Json
          sections_enabled?: Json
          slug: string
          sponsors?: Json
          stats?: Json | null
          style?: string | null
          tagline?: string | null
          team_name?: string | null
          testimonials?: Json | null
          theme?: string | null
        }
        Update: {
          achievements?: Json
          alternate_section_backgrounds?: boolean
          bio?: string | null
          brand_color?: string | null
          certifications?: string[] | null
          coach_photo_url?: string | null
          coach_user_id?: string | null
          coaching_philosophy?: string | null
          contact?: Json | null
          created_at?: string | null
          disciplines?: string[] | null
          gallery_aspect?: string
          gallery_columns?: number
          gallery_image_positions?: Json
          gallery_images?: string[] | null
          hero_image_position_x?: number
          hero_image_position_y?: number
          hero_image_side?: string
          hero_image_url?: string | null
          id?: string
          is_published?: boolean
          location?: Json | null
          logo_image_url?: string | null
          logo_initials?: string | null
          logo_url?: string | null
          name?: string
          nav?: string | null
          plans?: Json | null
          sample_sessions?: Json | null
          secondary_color?: string | null
          section_density?: string
          section_order?: Json
          sections_enabled?: Json
          slug?: string
          sponsors?: Json
          stats?: Json | null
          style?: string | null
          tagline?: string | null
          team_name?: string | null
          testimonials?: Json | null
          theme?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_coach_user_id_fkey"
            columns: ["coach_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_settings: {
        Row: {
          coach_id: string
          created_at: string
          default_reminder_evening_local: string
          default_reminder_morning_local: string
          reminders_enabled_default: boolean
          updated_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          default_reminder_evening_local?: string
          default_reminder_morning_local?: string
          reminders_enabled_default?: boolean
          updated_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          default_reminder_evening_local?: string
          default_reminder_morning_local?: string
          reminders_enabled_default?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      daily_checkins: {
        Row: {
          athlete_id: string
          checkin_date: string
          created_at: string
          day_note: string | null
          energy: number | null
          fuel_score: number | null
          id: string
          injury_flag: boolean
          injury_notes: string | null
          motivation: number | null
          notes: string | null
          sleep_hours: number | null
          sleep_quality: number | null
          soreness: number | null
          stress: number | null
        }
        Insert: {
          athlete_id: string
          checkin_date: string
          created_at?: string
          day_note?: string | null
          energy?: number | null
          fuel_score?: number | null
          id?: string
          injury_flag?: boolean
          injury_notes?: string | null
          motivation?: number | null
          notes?: string | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          stress?: number | null
        }
        Update: {
          athlete_id?: string
          checkin_date?: string
          created_at?: string
          day_note?: string | null
          energy?: number | null
          fuel_score?: number | null
          id?: string
          injury_flag?: boolean
          injury_notes?: string | null
          motivation?: number | null
          notes?: string | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          stress?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_checkins_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_nutrition: {
        Row: {
          athlete_id: string
          calories: number | null
          carbs_g: number | null
          created_at: string
          fat_g: number | null
          id: string
          notes: string | null
          nutrition_date: string
          protein_g: number | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          calories?: number | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          id?: string
          notes?: string | null
          nutrition_date: string
          protein_g?: number | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          calories?: number | null
          carbs_g?: number | null
          created_at?: string
          fat_g?: number | null
          id?: string
          notes?: string | null
          nutrition_date?: string
          protein_g?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_nutrition_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_vitals: {
        Row: {
          athlete_id: string
          created_at: string
          external_notes: string | null
          hydration: number | null
          id: string
          recovery_modalities: string[] | null
          resting_hr: number | null
          sleep_hours: number | null
          updated_at: string
          vitals_date: string
          weight_kg: number | null
        }
        Insert: {
          athlete_id: string
          created_at?: string
          external_notes?: string | null
          hydration?: number | null
          id?: string
          recovery_modalities?: string[] | null
          resting_hr?: number | null
          sleep_hours?: number | null
          updated_at?: string
          vitals_date: string
          weight_kg?: number | null
        }
        Update: {
          athlete_id?: string
          created_at?: string
          external_notes?: string | null
          hydration?: number | null
          id?: string
          recovery_modalities?: string[] | null
          resting_hr?: number | null
          sleep_hours?: number | null
          updated_at?: string
          vitals_date?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_vitals_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_layouts: {
        Row: {
          created_at: string
          dashboard_role: string
          hidden_widgets: Json
          id: string
          updated_at: string
          user_id: string
          widget_order: Json
        }
        Insert: {
          created_at?: string
          dashboard_role: string
          hidden_widgets?: Json
          id?: string
          updated_at?: string
          user_id: string
          widget_order?: Json
        }
        Update: {
          created_at?: string
          dashboard_role?: string
          hidden_widgets?: Json
          id?: string
          updated_at?: string
          user_id?: string
          widget_order?: Json
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          body: string
          created_at: string
          edited_at: string | null
          id: string
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      event_entries: {
        Row: {
          athlete_id: string
          athlete_race_selection_id: string | null
          attachment_url: string | null
          bib_number: string | null
          checkin_notes: string | null
          confirmation_number: string | null
          created_at: string
          entry_status: string | null
          event_date: string | null
          event_name: string
          id: string
          location: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          athlete_race_selection_id?: string | null
          attachment_url?: string | null
          bib_number?: string | null
          checkin_notes?: string | null
          confirmation_number?: string | null
          created_at?: string
          entry_status?: string | null
          event_date?: string | null
          event_name: string
          id?: string
          location?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          athlete_race_selection_id?: string | null
          attachment_url?: string | null
          bib_number?: string | null
          checkin_notes?: string | null
          confirmation_number?: string | null
          created_at?: string
          entry_status?: string | null
          event_date?: string | null
          event_name?: string
          id?: string
          location?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_entries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_entries_athlete_race_selection_id_fkey"
            columns: ["athlete_race_selection_id"]
            isOneToOne: false
            referencedRelation: "athlete_race_selections"
            referencedColumns: ["id"]
          },
        ]
      }
      external_load: {
        Row: {
          athlete_id: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          intensity: number | null
          load_date: string
          load_kind: Database["public"]["Enums"]["external_load_kind"]
        }
        Insert: {
          athlete_id: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          intensity?: number | null
          load_date: string
          load_kind: Database["public"]["Enums"]["external_load_kind"]
        }
        Update: {
          athlete_id?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          intensity?: number | null
          load_date?: string
          load_kind?: Database["public"]["Enums"]["external_load_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "external_load_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      family_contact_sharing: {
        Row: {
          athlete_id: string
          email: string | null
          phone: string | null
          share_contact: boolean
          updated_at: string
        }
        Insert: {
          athlete_id: string
          email?: string | null
          phone?: string | null
          share_contact?: boolean
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          email?: string | null
          phone?: string | null
          share_contact?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_contact_sharing_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      gear_items: {
        Row: {
          athlete_id: string
          brand: string
          created_at: string
          gear_type: string
          id: string
          is_favourite: boolean
          is_retired: boolean
          is_spike: boolean
          model: string
          nickname: string | null
          notes: string | null
          purchase_date: string | null
          rating: number | null
          retirement_target_km: number | null
          shoe_category: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          brand: string
          created_at?: string
          gear_type: string
          id?: string
          is_favourite?: boolean
          is_retired?: boolean
          is_spike?: boolean
          model: string
          nickname?: string | null
          notes?: string | null
          purchase_date?: string | null
          rating?: number | null
          retirement_target_km?: number | null
          shoe_category?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          brand?: string
          created_at?: string
          gear_type?: string
          id?: string
          is_favourite?: boolean
          is_retired?: boolean
          is_spike?: boolean
          model?: string
          nickname?: string | null
          notes?: string | null
          purchase_date?: string | null
          rating?: number | null
          retirement_target_km?: number | null
          shoe_category?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gear_items_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      group_chat_messages: {
        Row: {
          body: string
          created_at: string
          edited_at: string | null
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          sender_id?: string
        }
        Relationships: []
      }
      injuries: {
        Row: {
          archived: boolean
          athlete_id: string
          body_part: string
          body_region: string | null
          created_at: string
          hcp_name: string | null
          id: string
          next_appt_at: string | null
          notes: string | null
          onset_date: string
          resolved_date: string | null
          seeing_hcp: boolean
          severity: number | null
          side: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          athlete_id: string
          body_part: string
          body_region?: string | null
          created_at?: string
          hcp_name?: string | null
          id?: string
          next_appt_at?: string | null
          notes?: string | null
          onset_date: string
          resolved_date?: string | null
          seeing_hcp?: boolean
          severity?: number | null
          side?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          athlete_id?: string
          body_part?: string
          body_region?: string | null
          created_at?: string
          hcp_name?: string | null
          id?: string
          next_appt_at?: string | null
          notes?: string | null
          onset_date?: string
          resolved_date?: string | null
          seeing_hcp?: boolean
          severity?: number | null
          side?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "injuries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      injury_appointments: {
        Row: {
          appt_at: string
          athlete_id: string
          calendar_entry_id: string | null
          created_at: string
          hcp_name: string | null
          id: string
          injury_id: string
          notes: string | null
        }
        Insert: {
          appt_at: string
          athlete_id: string
          calendar_entry_id?: string | null
          created_at?: string
          hcp_name?: string | null
          id?: string
          injury_id: string
          notes?: string | null
        }
        Update: {
          appt_at?: string
          athlete_id?: string
          calendar_entry_id?: string | null
          created_at?: string
          hcp_name?: string | null
          id?: string
          injury_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "injury_appointments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_appointments_calendar_entry_id_fkey"
            columns: ["calendar_entry_id"]
            isOneToOne: false
            referencedRelation: "athlete_personal_calendar_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_appointments_injury_id_fkey"
            columns: ["injury_id"]
            isOneToOne: false
            referencedRelation: "injuries"
            referencedColumns: ["id"]
          },
        ]
      }
      injury_updates: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          injury_id: string
          notes: string | null
          severity: number | null
          update_date: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          injury_id: string
          notes?: string | null
          severity?: number | null
          update_date: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          injury_id?: string
          notes?: string | null
          severity?: number | null
          update_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "injury_updates_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_updates_injury_id_fkey"
            columns: ["injury_id"]
            isOneToOne: false
            referencedRelation: "injuries"
            referencedColumns: ["id"]
          },
        ]
      }
      interval_results: {
        Row: {
          actual_distance_m: number | null
          actual_pace_sec_per_km: number | null
          actual_time_seconds: number | null
          adjustment_note: string | null
          cadence: number | null
          created_at: string
          effort: number | null
          hr_avg: number | null
          hr_end: number | null
          hr_end_recovery: number | null
          hr_max: number | null
          id: string
          lactate_mmol: number | null
          lactate_taken: boolean
          lactate_timing: string | null
          notes: string | null
          rep_number: number
          rep_trace: Json | null
          set_number: number
          step_id: string
          stride_length_cm: number | null
        }
        Insert: {
          actual_distance_m?: number | null
          actual_pace_sec_per_km?: number | null
          actual_time_seconds?: number | null
          adjustment_note?: string | null
          cadence?: number | null
          created_at?: string
          effort?: number | null
          hr_avg?: number | null
          hr_end?: number | null
          hr_end_recovery?: number | null
          hr_max?: number | null
          id?: string
          lactate_mmol?: number | null
          lactate_taken?: boolean
          lactate_timing?: string | null
          notes?: string | null
          rep_number: number
          rep_trace?: Json | null
          set_number?: number
          step_id: string
          stride_length_cm?: number | null
        }
        Update: {
          actual_distance_m?: number | null
          actual_pace_sec_per_km?: number | null
          actual_time_seconds?: number | null
          adjustment_note?: string | null
          cadence?: number | null
          created_at?: string
          effort?: number | null
          hr_avg?: number | null
          hr_end?: number | null
          hr_end_recovery?: number | null
          hr_max?: number | null
          id?: string
          lactate_mmol?: number | null
          lactate_taken?: boolean
          lactate_timing?: string | null
          notes?: string | null
          rep_number?: number
          rep_trace?: Json | null
          set_number?: number
          step_id?: string
          stride_length_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interval_results_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      lactate_spot_checks: {
        Row: {
          athlete_id: string
          check_date: string
          context: string | null
          created_at: string
          id: string
          mmol: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          check_date: string
          context?: string | null
          created_at?: string
          id?: string
          mmol: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          check_date?: string
          context?: string | null
          created_at?: string
          id?: string
          mmol?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lactate_spot_checks_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      mechanics_workout_templates: {
        Row: {
          cadence_max: number
          cadence_min: number
          gct_max_ms: number
          gct_min_ms: number
          label: string
          level: string
          notes: string | null
          sourced_from_doc: boolean
          stride_max_m: number
          stride_min_m: number
          updated_at: string
          vo_max_cm: number
          vo_min_cm: number
          workout_type: string
        }
        Insert: {
          cadence_max: number
          cadence_min: number
          gct_max_ms: number
          gct_min_ms: number
          label: string
          level: string
          notes?: string | null
          sourced_from_doc?: boolean
          stride_max_m: number
          stride_min_m: number
          updated_at?: string
          vo_max_cm: number
          vo_min_cm: number
          workout_type: string
        }
        Update: {
          cadence_max?: number
          cadence_min?: number
          gct_max_ms?: number
          gct_min_ms?: number
          label?: string
          level?: string
          notes?: string | null
          sourced_from_doc?: boolean
          stride_max_m?: number
          stride_min_m?: number
          updated_at?: string
          vo_max_cm?: number
          vo_min_cm?: number
          workout_type?: string
        }
        Relationships: []
      }
      message_broadcasts: {
        Row: {
          body: string
          coach_id: string
          created_at: string
          edited_at: string | null
          id: string
          recipient_count: number
        }
        Insert: {
          body: string
          coach_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          recipient_count?: number
        }
        Update: {
          body?: string
          coach_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          recipient_count?: number
        }
        Relationships: []
      }
      noticeboard_media: {
        Row: {
          created_at: string | null
          file_url: string
          id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_url: string
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_url?: string
          id?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      noticeboard_posts: {
        Row: {
          author_id: string
          body: string | null
          created_at: string
          edited_at: string | null
          event_date: string | null
          id: string
          link_url: string | null
          location_id: string | null
          meta: Json
          pinned: boolean
          post_type: Database["public"]["Enums"]["noticeboard_post_type"]
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string | null
          created_at?: string
          edited_at?: string | null
          event_date?: string | null
          id?: string
          link_url?: string | null
          location_id?: string | null
          meta?: Json
          pinned?: boolean
          post_type?: Database["public"]["Enums"]["noticeboard_post_type"]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string | null
          created_at?: string
          edited_at?: string | null
          event_date?: string | null
          id?: string
          link_url?: string | null
          location_id?: string | null
          meta?: Json
          pinned?: boolean
          post_type?: Database["public"]["Enums"]["noticeboard_post_type"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "noticeboard_posts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      noticeboard_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "noticeboard_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "noticeboard_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          delivery_channels: Json
          id: string
          kind: string
          link: string | null
          push_attempts: number
          pushed_at: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          delivery_channels?: Json
          id?: string
          kind: string
          link?: string | null
          push_attempts?: number
          pushed_at?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          delivery_channels?: Json
          id?: string
          kind?: string
          link?: string | null
          push_attempts?: number
          pushed_at?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      parent_athlete_links: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          invited_by_coach_id: string
          parent_user_id: string
          status: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          invited_by_coach_id: string
          parent_user_id: string
          status?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          invited_by_coach_id?: string
          parent_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_athlete_links_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_invites: {
        Row: {
          accepted_at: string | null
          athlete_id: string
          coach_user_id: string | null
          created_at: string
          email: string
          id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          athlete_id: string
          coach_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          athlete_id?: string
          coach_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_invites_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_reminders: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          delivered_at: string | null
          id: string
          kind: string
          message: string | null
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          kind: string
          message?: string | null
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          kind?: string
          message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_reminders_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      performances: {
        Row: {
          age_group: string | null
          age_group_place: number | null
          athlete_id: string
          conditions: Json | null
          context: string | null
          course_name: string | null
          created_at: string
          distance_adjustment_mode: string | null
          distance_m: number
          event_name: string | null
          excluded_from_pb: boolean
          field_size: number | null
          fit_file_id: string | null
          id: string
          is_course_best: boolean
          is_pb: boolean
          is_public: boolean
          is_season_best: boolean
          is_year_best: boolean
          notes: string | null
          overall_place: number | null
          performance_date: string
          race_event_access: boolean
          race_event_id: string | null
          race_type: string | null
          round: string | null
          session_id: string | null
          splits: Json | null
          time_seconds: number
        }
        Insert: {
          age_group?: string | null
          age_group_place?: number | null
          athlete_id: string
          conditions?: Json | null
          context?: string | null
          course_name?: string | null
          created_at?: string
          distance_adjustment_mode?: string | null
          distance_m: number
          event_name?: string | null
          excluded_from_pb?: boolean
          field_size?: number | null
          fit_file_id?: string | null
          id?: string
          is_course_best?: boolean
          is_pb?: boolean
          is_public?: boolean
          is_season_best?: boolean
          is_year_best?: boolean
          notes?: string | null
          overall_place?: number | null
          performance_date: string
          race_event_access?: boolean
          race_event_id?: string | null
          race_type?: string | null
          round?: string | null
          session_id?: string | null
          splits?: Json | null
          time_seconds: number
        }
        Update: {
          age_group?: string | null
          age_group_place?: number | null
          athlete_id?: string
          conditions?: Json | null
          context?: string | null
          course_name?: string | null
          created_at?: string
          distance_adjustment_mode?: string | null
          distance_m?: number
          event_name?: string | null
          excluded_from_pb?: boolean
          field_size?: number | null
          fit_file_id?: string | null
          id?: string
          is_course_best?: boolean
          is_pb?: boolean
          is_public?: boolean
          is_season_best?: boolean
          is_year_best?: boolean
          notes?: string | null
          overall_place?: number | null
          performance_date?: string
          race_event_access?: boolean
          race_event_id?: string | null
          race_type?: string | null
          round?: string | null
          session_id?: string | null
          splits?: Json | null
          time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "performances_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_fit_file_id_fkey"
            columns: ["fit_file_id"]
            isOneToOne: false
            referencedRelation: "session_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_race_event_id_fkey"
            columns: ["race_event_id"]
            isOneToOne: false
            referencedRelation: "race_events"
            referencedColumns: ["id"]
          },
        ]
      }
      person_contact_details: {
        Row: {
          address: string | null
          email: string | null
          phone: string | null
          phone_alt: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          email?: string | null
          phone?: string | null
          phone_alt?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          email?: string | null
          phone?: string | null
          phone_alt?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_deliveries: {
        Row: {
          channels: string[]
          coach_user_id: string
          created_at: string
          date_range_end: string
          date_range_start: string
          export_detail_level: string
          id: string
          noticeboard_post_id: string | null
          scope_label: string | null
          scope_type: string | null
          summary: string
        }
        Insert: {
          channels?: string[]
          coach_user_id: string
          created_at?: string
          date_range_end: string
          date_range_start: string
          export_detail_level?: string
          id?: string
          noticeboard_post_id?: string | null
          scope_label?: string | null
          scope_type?: string | null
          summary: string
        }
        Update: {
          channels?: string[]
          coach_user_id?: string
          created_at?: string
          date_range_end?: string
          date_range_start?: string
          export_detail_level?: string
          id?: string
          noticeboard_post_id?: string | null
          scope_label?: string | null
          scope_type?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_deliveries_noticeboard_post_id_fkey"
            columns: ["noticeboard_post_id"]
            isOneToOne: false
            referencedRelation: "noticeboard_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_delivery_recipients: {
        Row: {
          athlete_id: string
          created_at: string
          delivery_id: string
          email_status: string
          email_to: string | null
          id: string
          notified_in_app: boolean
        }
        Insert: {
          athlete_id: string
          created_at?: string
          delivery_id: string
          email_status?: string
          email_to?: string | null
          id?: string
          notified_in_app?: boolean
        }
        Update: {
          athlete_id?: string
          created_at?: string
          delivery_id?: string
          email_status?: string
          email_to?: string | null
          id?: string
          notified_in_app?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "plan_delivery_recipients_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_delivery_recipients_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "plan_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_template_sessions: {
        Row: {
          day_of_week: number
          effort_type: string
          id: string
          notes: string | null
          plan_template_id: string
          session_template_id: string | null
          steps: Json | null
          title: string
          week_number: number
        }
        Insert: {
          day_of_week: number
          effort_type: string
          id?: string
          notes?: string | null
          plan_template_id: string
          session_template_id?: string | null
          steps?: Json | null
          title: string
          week_number: number
        }
        Update: {
          day_of_week?: number
          effort_type?: string
          id?: string
          notes?: string | null
          plan_template_id?: string
          session_template_id?: string | null
          steps?: Json | null
          title?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_template_sessions_plan_template_id_fkey"
            columns: ["plan_template_id"]
            isOneToOne: false
            referencedRelation: "plan_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_template_sessions_session_template_id_fkey"
            columns: ["session_template_id"]
            isOneToOne: false
            referencedRelation: "session_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_templates: {
        Row: {
          created_at: string
          created_by: string | null
          days_per_week: number
          description: string | null
          distance_focus: string | null
          duration_weeks: number
          id: string
          is_system: boolean
          level: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days_per_week: number
          description?: string | null
          distance_focus?: string | null
          duration_weeks: number
          id?: string
          is_system?: boolean
          level?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days_per_week?: number
          description?: string | null
          distance_focus?: string | null
          duration_weeks?: number
          id?: string
          is_system?: boolean
          level?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_subscription_active: boolean
          anthropic_api_key: string | null
          anthropic_api_key_last4: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          profile_image_url: string | null
          timezone: string | null
          units: string
          updated_at: string
        }
        Insert: {
          ai_subscription_active?: boolean
          anthropic_api_key?: string | null
          anthropic_api_key_last4?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          profile_image_url?: string | null
          timezone?: string | null
          units?: string
          updated_at?: string
        }
        Update: {
          ai_subscription_active?: boolean
          anthropic_api_key?: string | null
          anthropic_api_key_last4?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          profile_image_url?: string | null
          timezone?: string | null
          units?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      race_calendar_groups: {
        Row: {
          applied_at: string
          applied_by: string | null
          calendar_id: string
          training_group_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          calendar_id: string
          training_group_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          calendar_id?: string
          training_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_calendar_groups_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "race_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_calendar_groups_training_group_id_fkey"
            columns: ["training_group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      race_calendars: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          season: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          season?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          season?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      race_entry_rules: {
        Row: {
          closes_time: string
          closes_weekday: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          opens_min_days_before: number | null
          opens_time: string | null
          opens_weekday: number | null
          updated_at: string
        }
        Insert: {
          closes_time: string
          closes_weekday: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          opens_min_days_before?: number | null
          opens_time?: string | null
          opens_weekday?: number | null
          updated_at?: string
        }
        Update: {
          closes_time?: string
          closes_weekday?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          opens_min_days_before?: number | null
          opens_time?: string | null
          opens_weekday?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      race_events: {
        Row: {
          created_at: string
          created_by: string
          distance_m: number | null
          event_date: string | null
          id: string
          location: string | null
          name: string
          race_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          distance_m?: number | null
          event_date?: string | null
          id?: string
          location?: string | null
          name: string
          race_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          distance_m?: number | null
          event_date?: string | null
          id?: string
          location?: string | null
          name?: string
          race_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      race_schedule_entries: {
        Row: {
          calendar_id: string | null
          created_at: string
          created_by: string
          entry_closes: string | null
          entry_opens: string | null
          entry_rule_id: string | null
          entry_url: string | null
          event_date: string
          events_offered: string[]
          id: string
          location: string | null
          location_id: string | null
          name: string
          race_type: string | null
          raw_text: string | null
          source: string
          training_group_id: string | null
          updated_at: string
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string
          created_by?: string
          entry_closes?: string | null
          entry_opens?: string | null
          entry_rule_id?: string | null
          entry_url?: string | null
          event_date: string
          events_offered?: string[]
          id?: string
          location?: string | null
          location_id?: string | null
          name: string
          race_type?: string | null
          raw_text?: string | null
          source?: string
          training_group_id?: string | null
          updated_at?: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          created_by?: string
          entry_closes?: string | null
          entry_opens?: string | null
          entry_rule_id?: string | null
          entry_url?: string | null
          event_date?: string
          events_offered?: string[]
          id?: string
          location?: string | null
          location_id?: string | null
          name?: string
          race_type?: string | null
          raw_text?: string | null
          source?: string
          training_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_schedule_entries_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "race_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_schedule_entries_entry_rule_id_fkey"
            columns: ["entry_rule_id"]
            isOneToOne: false
            referencedRelation: "race_entry_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_schedule_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_schedule_entries_training_group_id_fkey"
            columns: ["training_group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_ai_suggestions: {
        Row: {
          alternative_reasoning: string
          alternative_strategy: string
          alternative_strategy_label: string
          created_at: string
          created_by: string | null
          id: string
          plan_id: string
          primary_strategy: string
          primary_strategy_label: string
          reasoning: string
          risks: string
          status: string
          suggested_splits: Json
          tactical_decision_points: Json
        }
        Insert: {
          alternative_reasoning: string
          alternative_strategy: string
          alternative_strategy_label: string
          created_at?: string
          created_by?: string | null
          id?: string
          plan_id: string
          primary_strategy: string
          primary_strategy_label: string
          reasoning: string
          risks: string
          status?: string
          suggested_splits?: Json
          tactical_decision_points?: Json
        }
        Update: {
          alternative_reasoning?: string
          alternative_strategy?: string
          alternative_strategy_label?: string
          created_at?: string
          created_by?: string | null
          id?: string
          plan_id?: string
          primary_strategy?: string
          primary_strategy_label?: string
          reasoning?: string
          risks?: string
          status?: string
          suggested_splits?: Json
          tactical_decision_points?: Json
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_ai_suggestions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "race_tactics_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_suggestion: boolean
          plan_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_suggestion?: boolean
          plan_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_suggestion?: boolean
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_comments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "race_tactics_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_decision_points: {
        Row: {
          action_text: string
          created_at: string
          created_by: string | null
          distance_m: number
          id: string
          notes: string | null
          plan_id: string
          trigger_text: string
        }
        Insert: {
          action_text: string
          created_at?: string
          created_by?: string | null
          distance_m: number
          id?: string
          notes?: string | null
          plan_id: string
          trigger_text: string
        }
        Update: {
          action_text?: string
          created_at?: string
          created_by?: string | null
          distance_m?: number
          id?: string
          notes?: string | null
          plan_id?: string
          trigger_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_decision_points_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "race_tactics_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_plans: {
        Row: {
          athlete_id: string
          athlete_intentions: string | null
          conditions: Json | null
          created_at: string
          created_by: string | null
          current_pb_seconds: number | null
          event_name: string
          event_tactics: Json | null
          goal_time_seconds: number
          id: string
          linked_session_id: string | null
          published_at: string | null
          race_date: string | null
          race_distance_m: number
          race_type: string
          split_increment_m: number
          splits: Json
          status: string
          strategy: string
          target_pb_seconds: number | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          athlete_intentions?: string | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          current_pb_seconds?: number | null
          event_name: string
          event_tactics?: Json | null
          goal_time_seconds: number
          id?: string
          linked_session_id?: string | null
          published_at?: string | null
          race_date?: string | null
          race_distance_m: number
          race_type?: string
          split_increment_m: number
          splits?: Json
          status?: string
          strategy?: string
          target_pb_seconds?: number | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          athlete_intentions?: string | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          current_pb_seconds?: number | null
          event_name?: string
          event_tactics?: Json | null
          goal_time_seconds?: number
          id?: string
          linked_session_id?: string | null
          published_at?: string | null
          race_date?: string | null
          race_distance_m?: number
          race_type?: string
          split_increment_m?: number
          splits?: Json
          status?: string
          strategy?: string
          target_pb_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_plans_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_tactics_plans_linked_session_id_fkey"
            columns: ["linked_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_post_race: {
        Row: {
          actual_splits: Json
          athlete_how_it_felt: string | null
          athlete_what_different: string | null
          athlete_what_learned: string | null
          coach_what_didnt: string | null
          coach_what_to_change: string | null
          coach_what_worked: string | null
          created_at: string
          created_by: string | null
          decision_point_notes: Json
          finishing_position: string | null
          id: string
          linked_performance_id: string | null
          plan_id: string
          updated_at: string
        }
        Insert: {
          actual_splits?: Json
          athlete_how_it_felt?: string | null
          athlete_what_different?: string | null
          athlete_what_learned?: string | null
          coach_what_didnt?: string | null
          coach_what_to_change?: string | null
          coach_what_worked?: string | null
          created_at?: string
          created_by?: string | null
          decision_point_notes?: Json
          finishing_position?: string | null
          id?: string
          linked_performance_id?: string | null
          plan_id: string
          updated_at?: string
        }
        Update: {
          actual_splits?: Json
          athlete_how_it_felt?: string | null
          athlete_what_different?: string | null
          athlete_what_learned?: string | null
          coach_what_didnt?: string | null
          coach_what_to_change?: string | null
          coach_what_worked?: string | null
          created_at?: string
          created_by?: string | null
          decision_point_notes?: Json
          finishing_position?: string | null
          id?: string
          linked_performance_id?: string | null
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_post_race_linked_performance_id_fkey"
            columns: ["linked_performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_tactics_post_race_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "race_tactics_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      race_tactics_private_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string
          plan_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          plan_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_tactics_private_notes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "race_tactics_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_session_points: {
        Row: {
          cadence: number | null
          created_at: string
          distance_m: number | null
          elapsed_s: number
          elevation_m: number | null
          file_id: string | null
          gct_balance_pct: number | null
          ground_contact_time_ms: number | null
          hr: number | null
          id: number
          lat: number | null
          lng: number | null
          pace_sec_per_km: number | null
          segment_type: string | null
          session_id: string
          step_id: string | null
          temperature_c: number | null
          vertical_oscillation_cm: number | null
        }
        Insert: {
          cadence?: number | null
          created_at?: string
          distance_m?: number | null
          elapsed_s: number
          elevation_m?: number | null
          file_id?: string | null
          gct_balance_pct?: number | null
          ground_contact_time_ms?: number | null
          hr?: number | null
          id?: number
          lat?: number | null
          lng?: number | null
          pace_sec_per_km?: number | null
          segment_type?: string | null
          session_id: string
          step_id?: string | null
          temperature_c?: number | null
          vertical_oscillation_cm?: number | null
        }
        Update: {
          cadence?: number | null
          created_at?: string
          distance_m?: number | null
          elapsed_s?: number
          elevation_m?: number | null
          file_id?: string | null
          gct_balance_pct?: number | null
          ground_contact_time_ms?: number | null
          hr?: number | null
          id?: number
          lat?: number | null
          lng?: number | null
          pace_sec_per_km?: number | null
          segment_type?: string | null
          session_id?: string
          step_id?: string | null
          temperature_c?: number | null
          vertical_oscillation_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_session_points_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "session_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_session_points_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_session_points_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_sessions: {
        Row: {
          athlete_id: string
          created_at: string
          duration_minutes: number | null
          felt_after: number | null
          id: string
          modality: string
          notes: string | null
          provider: string | null
          session_date: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          duration_minutes?: number | null
          felt_after?: number | null
          id?: string
          modality: string
          notes?: string | null
          provider?: string | null
          session_date: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          duration_minutes?: number | null
          felt_after?: number | null
          id?: string
          modality?: string
          notes?: string | null
          provider?: string | null
          session_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          period_end: string
          period_start: string
          report_type: string
          run_by: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          report_type: string
          run_by: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          report_type?: string
          run_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      session_adjustment_rules: {
        Row: {
          adjusted_summary: string
          adjustment_type: string
          id: string
          intent: Database["public"]["Enums"]["session_intent"]
          readiness_status: Database["public"]["Enums"]["readiness_status"]
          reason: string | null
        }
        Insert: {
          adjusted_summary: string
          adjustment_type: string
          id?: string
          intent: Database["public"]["Enums"]["session_intent"]
          readiness_status: Database["public"]["Enums"]["readiness_status"]
          reason?: string | null
        }
        Update: {
          adjusted_summary?: string
          adjustment_type?: string
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"]
          readiness_status?: Database["public"]["Enums"]["readiness_status"]
          reason?: string | null
        }
        Relationships: []
      }
      session_adjustments: {
        Row: {
          adjusted: Json | null
          applied_at: string | null
          athlete_id: string
          created_at: string
          id: string
          is_applied: boolean
          original: Json | null
          reason: string | null
          rule_id: string | null
          session_id: string
        }
        Insert: {
          adjusted?: Json | null
          applied_at?: string | null
          athlete_id: string
          created_at?: string
          id?: string
          is_applied?: boolean
          original?: Json | null
          reason?: string | null
          rule_id?: string | null
          session_id: string
        }
        Update: {
          adjusted?: Json | null
          applied_at?: string | null
          athlete_id?: string
          created_at?: string
          id?: string
          is_applied?: boolean
          original?: Json | null
          reason?: string | null
          rule_id?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_adjustments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_adjustments_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "session_adjustment_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_adjustments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          athlete_id: string
          confirmed_by: string | null
          created_at: string
          id: string
          session_id: string
          source: Database["public"]["Enums"]["attendance_source"]
        }
        Insert: {
          athlete_id: string
          confirmed_by?: string | null
          created_at?: string
          id?: string
          session_id: string
          source?: Database["public"]["Enums"]["attendance_source"]
        }
        Update: {
          athlete_id?: string
          confirmed_by?: string | null
          created_at?: string
          id?: string
          session_id?: string
          source?: Database["public"]["Enums"]["attendance_source"]
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_comments: {
        Row: {
          athlete_id: string
          author_id: string
          body: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          author_id: string
          body: string
          created_at?: string
          id?: string
          session_id: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_comments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_comments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_fatigue: {
        Row: {
          athlete_id: string
          cadence_drift_pct: number | null
          computed_at: string
          duration_seconds: number | null
          efficiency_score: number | null
          hr_drift_bpm: number | null
          method: string
          pace_drift_pct: number | null
          rep_count: number
          session_id: string
          step_id: string
          stride_drift_pct: number | null
        }
        Insert: {
          athlete_id: string
          cadence_drift_pct?: number | null
          computed_at?: string
          duration_seconds?: number | null
          efficiency_score?: number | null
          hr_drift_bpm?: number | null
          method: string
          pace_drift_pct?: number | null
          rep_count: number
          session_id: string
          step_id: string
          stride_drift_pct?: number | null
        }
        Update: {
          athlete_id?: string
          cadence_drift_pct?: number | null
          computed_at?: string
          duration_seconds?: number | null
          efficiency_score?: number | null
          hr_drift_bpm?: number | null
          method?: string
          pace_drift_pct?: number | null
          rep_count?: number
          session_id?: string
          step_id?: string
          stride_drift_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_fatigue_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_fatigue_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_fatigue_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      session_files: {
        Row: {
          activity_type: string | null
          athlete_id: string
          block_type: string
          created_at: string
          file_kind: string
          id: string
          interval_auto_detected: boolean
          is_primary_workout: boolean
          lap_count: number
          lap_intensity_present: boolean
          mapped_step_id: string | null
          original_filename: string | null
          parse_error: string | null
          parse_summary: Json
          parsed_at: string | null
          recovery_lap_count: number
          session_id: string | null
          started_at: string | null
          storage_path: string
          total_distance_m: number | null
          total_time_s: number | null
          updated_at: string
          work_lap_count: number
          zone_time_rebuilt_at: string | null
        }
        Insert: {
          activity_type?: string | null
          athlete_id: string
          block_type?: string
          created_at?: string
          file_kind: string
          id?: string
          interval_auto_detected?: boolean
          is_primary_workout?: boolean
          lap_count?: number
          lap_intensity_present?: boolean
          mapped_step_id?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parse_summary?: Json
          parsed_at?: string | null
          recovery_lap_count?: number
          session_id?: string | null
          started_at?: string | null
          storage_path: string
          total_distance_m?: number | null
          total_time_s?: number | null
          updated_at?: string
          work_lap_count?: number
          zone_time_rebuilt_at?: string | null
        }
        Update: {
          activity_type?: string | null
          athlete_id?: string
          block_type?: string
          created_at?: string
          file_kind?: string
          id?: string
          interval_auto_detected?: boolean
          is_primary_workout?: boolean
          lap_count?: number
          lap_intensity_present?: boolean
          mapped_step_id?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parse_summary?: Json
          parsed_at?: string | null
          recovery_lap_count?: number
          session_id?: string | null
          started_at?: string | null
          storage_path?: string
          total_distance_m?: number | null
          total_time_s?: number | null
          updated_at?: string
          work_lap_count?: number
          zone_time_rebuilt_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_files_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_files_mapped_step_id_fkey"
            columns: ["mapped_step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_files_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_fuel_events: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          note: string
          rep_number: number | null
          session_id: string
          step_id: string | null
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          note: string
          rep_number?: number | null
          session_id: string
          step_id?: string | null
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          note?: string
          rep_number?: number | null
          session_id?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_fuel_events_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_fuel_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_fuel_events_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      session_gear: {
        Row: {
          athlete_id: string
          created_at: string
          gear_id: string
          id: string
          session_id: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          gear_id: string
          id?: string
          session_id: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          gear_id?: string
          id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_gear_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_gear_gear_id_fkey"
            columns: ["gear_id"]
            isOneToOne: false
            referencedRelation: "gear_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_gear_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_insights: {
        Row: {
          athlete_id: string
          created_at: string
          end_of_day_note: string | null
          feel_score: number | null
          id: string
          niggles: string | null
          session_id: string
          updated_at: string
          was_difficult: string | null
          went_well: string | null
        }
        Insert: {
          athlete_id: string
          created_at?: string
          end_of_day_note?: string | null
          feel_score?: number | null
          id?: string
          niggles?: string | null
          session_id: string
          updated_at?: string
          was_difficult?: string | null
          went_well?: string | null
        }
        Update: {
          athlete_id?: string
          created_at?: string
          end_of_day_note?: string | null
          feel_score?: number | null
          id?: string
          niggles?: string | null
          session_id?: string
          updated_at?: string
          was_difficult?: string | null
          went_well?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_insights_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_insights_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_templates: {
        Row: {
          created_at: string
          id: string
          intent: Database["public"]["Enums"]["session_intent"]
          is_long_run: boolean
          name: string
          notes: string | null
          owner_user_id: string
          structure: Database["public"]["Enums"]["session_structure"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          intent: Database["public"]["Enums"]["session_intent"]
          is_long_run?: boolean
          name: string
          notes?: string | null
          owner_user_id: string
          structure: Database["public"]["Enums"]["session_structure"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"]
          is_long_run?: boolean
          name?: string
          notes?: string | null
          owner_user_id?: string
          structure?: Database["public"]["Enums"]["session_structure"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_zone_time: {
        Row: {
          athlete_id: string
          boundaries_computed_at: string | null
          hr_z1_max: number | null
          hr_z2_max: number | null
          hr_z3_max: number | null
          hr_z4_max: number | null
          hr_z5_max: number | null
          id: string
          meters: number
          pace_5k_sec_per_km: number | null
          seconds: number
          session_id: string
          source: Database["public"]["Enums"]["zone_source"]
          updated_at: string
          zone: Database["public"]["Enums"]["zone_band"]
        }
        Insert: {
          athlete_id: string
          boundaries_computed_at?: string | null
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          id?: string
          meters?: number
          pace_5k_sec_per_km?: number | null
          seconds?: number
          session_id: string
          source?: Database["public"]["Enums"]["zone_source"]
          updated_at?: string
          zone: Database["public"]["Enums"]["zone_band"]
        }
        Update: {
          athlete_id?: string
          boundaries_computed_at?: string | null
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          id?: string
          meters?: number
          pace_5k_sec_per_km?: number | null
          seconds?: number
          session_id?: string
          source?: Database["public"]["Enums"]["zone_source"]
          updated_at?: string
          zone?: Database["public"]["Enums"]["zone_band"]
        }
        Relationships: [
          {
            foreignKeyName: "session_zone_time_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_zone_time_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          activity_type: string | null
          altitude_m: number | null
          applied_from_template_id: string | null
          athlete_id: string
          average_temp_c: number | null
          avg_hr: number | null
          completed_at: string | null
          completion_pct: number | null
          created_at: string
          created_by: string
          data_source: string | null
          day_type: Database["public"]["Enums"]["session_day_type"]
          distance_adjustment_m: number | null
          distance_adjustment_mode: string | null
          distance_adjustments: Json | null
          easy_avg_pace_sec_per_km: number | null
          fueling_carbs_g: number | null
          fueling_fluid_ml: number | null
          fueling_notes: string | null
          fueling_sodium_mg: number | null
          gym_category: string | null
          gym_intensity: string | null
          gym_subtype: string | null
          hr_drift_pct: number | null
          id: string
          intent: Database["public"]["Enums"]["session_intent"] | null
          is_long_run: boolean
          is_planned: boolean
          location: string | null
          location_id: string | null
          max_hr: number | null
          needs_review: boolean | null
          notes: string | null
          pace_decay_pct: number | null
          race_step_id: string | null
          review_dismissed_at: string | null
          rpe: number | null
          same_day_ignored_ids: string[]
          session_date: string
          source: Database["public"]["Enums"]["session_source"]
          structure: Database["public"]["Enums"]["session_structure"] | null
          terrain: string | null
          time_of_day: string | null
          title: string
          total_distance_m: number | null
          total_moving_time_seconds: number | null
          total_time_seconds: number | null
          updated_at: string
          venue: string | null
          weather: string | null
          wind_kph: number | null
          wind_direction_deg: number | null
          work_avg_cadence: number | null
          work_avg_hr: number | null
          work_avg_pace_sec_per_km: number | null
          work_distance_m: number | null
          work_time_s: number | null
          zone_basis: Database["public"]["Enums"]["zone_basis"]
        }
        Insert: {
          activity_type?: string | null
          altitude_m?: number | null
          applied_from_template_id?: string | null
          athlete_id: string
          average_temp_c?: number | null
          avg_hr?: number | null
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by: string
          data_source?: string | null
          day_type?: Database["public"]["Enums"]["session_day_type"]
          distance_adjustment_m?: number | null
          distance_adjustment_mode?: string | null
          distance_adjustments?: Json | null
          easy_avg_pace_sec_per_km?: number | null
          fueling_carbs_g?: number | null
          fueling_fluid_ml?: number | null
          fueling_notes?: string | null
          fueling_sodium_mg?: number | null
          gym_category?: string | null
          gym_intensity?: string | null
          gym_subtype?: string | null
          hr_drift_pct?: number | null
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"] | null
          is_long_run?: boolean
          is_planned?: boolean
          location?: string | null
          location_id?: string | null
          max_hr?: number | null
          needs_review?: boolean | null
          notes?: string | null
          pace_decay_pct?: number | null
          race_step_id?: string | null
          review_dismissed_at?: string | null
          rpe?: number | null
          same_day_ignored_ids?: string[]
          session_date: string
          source?: Database["public"]["Enums"]["session_source"]
          structure?: Database["public"]["Enums"]["session_structure"] | null
          terrain?: string | null
          time_of_day?: string | null
          title: string
          total_distance_m?: number | null
          total_moving_time_seconds?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          venue?: string | null
          weather?: string | null
          wind_kph?: number | null
          wind_direction_deg?: number | null
          work_avg_cadence?: number | null
          work_avg_hr?: number | null
          work_avg_pace_sec_per_km?: number | null
          work_distance_m?: number | null
          work_time_s?: number | null
          zone_basis?: Database["public"]["Enums"]["zone_basis"]
        }
        Update: {
          activity_type?: string | null
          altitude_m?: number | null
          applied_from_template_id?: string | null
          athlete_id?: string
          average_temp_c?: number | null
          avg_hr?: number | null
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by?: string
          data_source?: string | null
          day_type?: Database["public"]["Enums"]["session_day_type"]
          distance_adjustment_m?: number | null
          distance_adjustment_mode?: string | null
          distance_adjustments?: Json | null
          easy_avg_pace_sec_per_km?: number | null
          fueling_carbs_g?: number | null
          fueling_fluid_ml?: number | null
          fueling_notes?: string | null
          fueling_sodium_mg?: number | null
          gym_category?: string | null
          gym_intensity?: string | null
          gym_subtype?: string | null
          hr_drift_pct?: number | null
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"] | null
          is_long_run?: boolean
          is_planned?: boolean
          location?: string | null
          location_id?: string | null
          max_hr?: number | null
          needs_review?: boolean | null
          notes?: string | null
          pace_decay_pct?: number | null
          race_step_id?: string | null
          review_dismissed_at?: string | null
          rpe?: number | null
          same_day_ignored_ids?: string[]
          session_date?: string
          source?: Database["public"]["Enums"]["session_source"]
          structure?: Database["public"]["Enums"]["session_structure"] | null
          terrain?: string | null
          time_of_day?: string | null
          title?: string
          total_distance_m?: number | null
          total_moving_time_seconds?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          venue?: string | null
          weather?: string | null
          wind_kph?: number | null
          wind_direction_deg?: number | null
          work_avg_cadence?: number | null
          work_avg_hr?: number | null
          work_avg_pace_sec_per_km?: number | null
          work_distance_m?: number | null
          work_time_s?: number | null
          zone_basis?: Database["public"]["Enums"]["zone_basis"]
        }
        Relationships: [
          {
            foreignKeyName: "sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_race_step_id_fkey"
            columns: ["race_step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_training_overrides: {
        Row: {
          cancelled: boolean
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          location_text: string | null
          notes: string | null
          occurrence_date: string
          schedule_id: string
          start_time: string | null
          time_of_day:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at: string
        }
        Insert: {
          cancelled?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          location_text?: string | null
          notes?: string | null
          occurrence_date: string
          schedule_id: string
          start_time?: string | null
          time_of_day?:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at?: string
        }
        Update: {
          cancelled?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          location_text?: string | null
          notes?: string | null
          occurrence_date?: string
          schedule_id?: string
          start_time?: string | null
          time_of_day?:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_training_overrides_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_training_overrides_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "squad_training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_training_sessions: {
        Row: {
          active: boolean
          coach_user_id: string
          created_at: string
          day_of_week: number | null
          day_type: Database["public"]["Enums"]["training_day_type"]
          group_id: string | null
          id: string
          location_id: string | null
          location_text: string | null
          notes: string | null
          specific_date: string | null
          squad_label: string
          start_time: string | null
          time_of_day:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          coach_user_id: string
          created_at?: string
          day_of_week?: number | null
          day_type?: Database["public"]["Enums"]["training_day_type"]
          group_id?: string | null
          id?: string
          location_id?: string | null
          location_text?: string | null
          notes?: string | null
          specific_date?: string | null
          squad_label: string
          start_time?: string | null
          time_of_day?:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          coach_user_id?: string
          created_at?: string
          day_of_week?: number | null
          day_type?: Database["public"]["Enums"]["training_day_type"]
          group_id?: string | null
          id?: string
          location_id?: string | null
          location_text?: string | null
          notes?: string | null
          specific_date?: string | null
          squad_label?: string
          start_time?: string | null
          time_of_day?:
            | Database["public"]["Enums"]["training_time_of_day"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_training_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_training_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      steps: {
        Row: {
          counts_toward_distance: boolean
          created_at: string
          fuel_note: string | null
          id: string
          is_ladder: boolean
          kind: Database["public"]["Enums"]["step_kind"]
          notes: string | null
          recovery_between_reps_distance_m: number | null
          recovery_between_reps_mode: string | null
          recovery_between_reps_seconds: number | null
          recovery_between_reps_target_kind: string | null
          recovery_between_sets_distance_m: number | null
          recovery_between_sets_mode: string | null
          recovery_between_sets_seconds: number | null
          recovery_between_sets_target_kind: string | null
          recovery_mode: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m: number | null
          recovery_target_kind:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds: number | null
          reps: number
          session_id: string
          set_count: number
          step_order: number
          target_distance_m: number | null
          target_kind: Database["public"]["Enums"]["target_kind"] | null
          target_mode: string | null
          target_pace_sec_per_km: number | null
          target_rpe: number | null
          target_threshold_hr_pct: number | null
          target_threshold_pace_pct: number | null
          target_time_seconds: number | null
          target_zone: string | null
        }
        Insert: {
          counts_toward_distance?: boolean
          created_at?: string
          fuel_note?: string | null
          id?: string
          is_ladder?: boolean
          kind: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_between_reps_distance_m?: number | null
          recovery_between_reps_mode?: string | null
          recovery_between_reps_seconds?: number | null
          recovery_between_reps_target_kind?: string | null
          recovery_between_sets_distance_m?: number | null
          recovery_between_sets_mode?: string | null
          recovery_between_sets_seconds?: number | null
          recovery_between_sets_target_kind?: string | null
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          session_id: string
          set_count?: number
          step_order: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_mode?: string | null
          target_pace_sec_per_km?: number | null
          target_rpe?: number | null
          target_threshold_hr_pct?: number | null
          target_threshold_pace_pct?: number | null
          target_time_seconds?: number | null
          target_zone?: string | null
        }
        Update: {
          counts_toward_distance?: boolean
          created_at?: string
          fuel_note?: string | null
          id?: string
          is_ladder?: boolean
          kind?: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_between_reps_distance_m?: number | null
          recovery_between_reps_mode?: string | null
          recovery_between_reps_seconds?: number | null
          recovery_between_reps_target_kind?: string | null
          recovery_between_sets_distance_m?: number | null
          recovery_between_sets_mode?: string | null
          recovery_between_sets_seconds?: number | null
          recovery_between_sets_target_kind?: string | null
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          session_id?: string
          set_count?: number
          step_order?: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_mode?: string | null
          target_pace_sec_per_km?: number | null
          target_rpe?: number | null
          target_threshold_hr_pct?: number | null
          target_threshold_pace_pct?: number | null
          target_time_seconds?: number | null
          target_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "steps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      template_steps: {
        Row: {
          counts_toward_distance: boolean
          created_at: string
          id: string
          is_ladder: boolean
          kind: Database["public"]["Enums"]["step_kind"]
          notes: string | null
          recovery_between_reps_distance_m: number | null
          recovery_between_reps_mode: string | null
          recovery_between_reps_seconds: number | null
          recovery_between_reps_target_kind: string
          recovery_between_sets_distance_m: number | null
          recovery_between_sets_mode: string | null
          recovery_between_sets_seconds: number | null
          recovery_between_sets_target_kind: string
          recovery_mode: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m: number | null
          recovery_target_kind:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds: number | null
          reps: number
          set_count: number
          step_order: number
          target_distance_m: number | null
          target_kind: Database["public"]["Enums"]["target_kind"] | null
          target_mode: string | null
          target_pace_sec_per_km: number | null
          target_rpe: number | null
          target_threshold_hr_pct: number | null
          target_threshold_pace_pct: number | null
          target_time_seconds: number | null
          target_zone: string | null
          template_id: string
        }
        Insert: {
          counts_toward_distance?: boolean
          created_at?: string
          id?: string
          is_ladder?: boolean
          kind: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_between_reps_distance_m?: number | null
          recovery_between_reps_mode?: string | null
          recovery_between_reps_seconds?: number | null
          recovery_between_reps_target_kind?: string
          recovery_between_sets_distance_m?: number | null
          recovery_between_sets_mode?: string | null
          recovery_between_sets_seconds?: number | null
          recovery_between_sets_target_kind?: string
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          set_count?: number
          step_order: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_mode?: string | null
          target_pace_sec_per_km?: number | null
          target_rpe?: number | null
          target_threshold_hr_pct?: number | null
          target_threshold_pace_pct?: number | null
          target_time_seconds?: number | null
          target_zone?: string | null
          template_id: string
        }
        Update: {
          counts_toward_distance?: boolean
          created_at?: string
          id?: string
          is_ladder?: boolean
          kind?: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_between_reps_distance_m?: number | null
          recovery_between_reps_mode?: string | null
          recovery_between_reps_seconds?: number | null
          recovery_between_reps_target_kind?: string
          recovery_between_sets_distance_m?: number | null
          recovery_between_sets_mode?: string | null
          recovery_between_sets_seconds?: number | null
          recovery_between_sets_target_kind?: string
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          set_count?: number
          step_order?: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_mode?: string | null
          target_pace_sec_per_km?: number | null
          target_rpe?: number | null
          target_threshold_hr_pct?: number | null
          target_threshold_pace_pct?: number | null
          target_time_seconds?: number | null
          target_zone?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "session_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      training_group_members: {
        Row: {
          added_at: string
          added_by: string | null
          athlete_id: string
          group_id: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          athlete_id: string
          group_id: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          athlete_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_group_members_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      training_groups: {
        Row: {
          coach_user_id: string
          color: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          coach_user_id: string
          color?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          coach_user_id?: string
          color?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      training_locations: {
        Row: {
          address: string | null
          altitude_m: number | null
          created_at: string
          created_by: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          surface: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          altitude_m?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          surface?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          altitude_m?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          surface?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      training_routes: {
        Row: {
          athlete_id: string | null
          created_at: string
          created_by: string
          distance_m: number | null
          elevation_gain_m: number | null
          id: string
          location_id: string | null
          location_name: string | null
          name: string
          path: Json
          source_session_id: string | null
          start_lat: number | null
          start_lng: number | null
        }
        Insert: {
          athlete_id?: string | null
          created_at?: string
          created_by: string
          distance_m?: number | null
          elevation_gain_m?: number | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          name: string
          path: Json
          source_session_id?: string | null
          start_lat?: number | null
          start_lng?: number | null
        }
        Update: {
          athlete_id?: string | null
          created_at?: string
          created_by?: string
          distance_m?: number | null
          elevation_gain_m?: number | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          name?: string
          path?: Json
          source_session_id?: string | null
          start_lat?: number | null
          start_lng?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_routes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_routes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "training_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_routes_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      athlete_weekly_distance: {
        Row: {
          athlete_id: string | null
          distance_m: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_zone_time_weekly: {
        Row: {
          athlete_id: string | null
          meters: number | null
          seconds: number | null
          source: Database["public"]["Enums"]["zone_source"] | null
          week_start: string | null
          zone: Database["public"]["Enums"]["zone_band"] | null
        }
        Relationships: [
          {
            foreignKeyName: "session_zone_time_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ai_consume_quota: {
        Args: { _limit: number; _user_id: string }
        Returns: boolean
      }
      apply_starting_fitness: {
        Args: { _athlete_id: string; _seed_atl: number; _seed_ctl: number }
        Returns: undefined
      }
      can_access_athlete: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_race_calendar: {
        Args: { _calendar_id: string; _user_id: string }
        Returns: boolean
      }
      claim_athlete_invite: { Args: { _token: string }; Returns: Json }
      claim_parent_invite: { Args: { _token: string }; Returns: Json }
      compute_continuous_fatigue: {
        Args: { _session_id: string }
        Returns: undefined
      }
      compute_session_completion: {
        Args: { _session_id: string }
        Returns: undefined
      }
      compute_session_fatigue: {
        Args: { _session_id: string }
        Returns: undefined
      }
      compute_vdot: {
        Args: { _distance_m: number; _time_seconds: number }
        Returns: number
      }
      create_birthday_posts: { Args: never; Returns: undefined }
      create_parent_invite: {
        Args: { _athlete_id: string; _email: string }
        Returns: Json
      }
      dna_bucket_from_score: { Args: { _score: number }; Returns: string }
      external_load_score: {
        Args: { _athlete_id: string; _date: string }
        Returns: number
      }
      get_athlete_biomechanics_trend: {
        Args: { _athlete_id: string; _limit?: number; _segment_type?: string }
        Returns: {
          avg_cadence: number
          avg_gct_ms: number
          avg_vo_cm: number
          biomechanical_fatigue_score: number
          biomechanical_score: number
          dominant_zone: string
          gct_balance_pct: number
          hr_drift_bpm: number
          mechanical_stability_score: number
          mei_score: number
          overall_economy_score: number
          pace_hr_efficiency_score: number
          rhythm_score: number
          session_date: string
          session_id: string
          session_title: string
          stride_length_m: number
          vertical_efficiency_score: number
          vo_drift_cm: number
          workout_type: string
        }[]
      }
      get_athlete_fitness_history: {
        Args: { _athlete_id: string; _recent_weeks?: number }
        Returns: {
          ctl_end: number
          distance_m: number
          duration_seconds: number
          granularity: string
          period_start: string
          tss: number
        }[]
      }
      get_athlete_records: {
        Args: { _athlete_id: string }
        Returns: {
          label: string
          record_key: string
          session_date: string
          session_id: string
          session_title: string
          unit: string
          value: number
        }[]
      }
      get_athlete_speed_economy_curve: {
        Args: { _athlete_id: string; _limit?: number; _zone?: string }
        Returns: {
          avg_biomechanical_score: number
          pace_bucket_center_sec_per_km: number
          session_count: number
        }[]
      }
      get_invite_by_token: {
        Args: { _token: string }
        Returns: {
          athlete_name: string
          coach_name: string
          invited_email: string
          kind: string
          status: string
        }[]
      }
      get_parent_invite_by_token: {
        Args: { _token: string }
        Returns: {
          athlete_name: string
          coach_name: string
          invited_email: string
          status: string
        }[]
      }
      has_race_event_access: {
        Args: { _race_event_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_athlete_self: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      is_coach_of: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      is_parent_of: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      leave_parent_role: { Args: never; Returns: Json }
      notify_plan_delivery: {
        Args: {
          _athlete_id: string
          _body: string
          _data: Json
          _link: string
          _title: string
        }
        Returns: undefined
      }
      owns_race_calendar: {
        Args: { _calendar_id: string; _user_id: string }
        Returns: boolean
      }
      purge_account_activity_log: { Args: never; Returns: undefined }
      recompute_athlete_dna: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      recompute_athlete_pbs: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      recompute_athlete_zone_profile: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      recompute_fit_import_session_dates: {
        Args: { _athlete_id: string }
        Returns: {
          new_date: string
          new_title: string
          old_date: string
          old_title: string
          session_id: string
        }[]
      }
      recompute_fit_import_session_dates_for_all_corrected_athletes: {
        Args: never
        Returns: {
          athlete_id: string
          athlete_name: string
          sessions_touched: number
        }[]
      }
      recompute_physio_profile: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      recompute_readiness: {
        Args: { _athlete_id: string; _date: string }
        Returns: undefined
      }
      recompute_readiness_all: { Args: { _date: string }; Returns: undefined }
      recompute_readiness_range: {
        Args: { _athlete_id: string; _from_date: string; _to_date: string }
        Returns: undefined
      }
      recompute_readiness_range_all: {
        Args: { _from_date: string; _to_date: string }
        Returns: undefined
      }
      recompute_session_intent: {
        Args: { _session_id: string }
        Returns: {
          new_intent: string
          old_intent: string
        }[]
      }
      recompute_session_totals: {
        Args: { _session_id: string }
        Returns: undefined
      }
      recompute_session_zones: {
        Args: { _session_id: string }
        Returns: undefined
      }
      request_athlete_join_by_email: {
        Args: { _athlete_name?: string; _email: string; _message?: string }
        Returns: Json
      }
      reset_hr_zones_to_auto: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      reset_pace_zones_to_auto: {
        Args: { _athlete_id: string }
        Returns: undefined
      }
      reset_vdot_to_auto: { Args: { _athlete_id: string }; Returns: undefined }
      respond_to_join_request: {
        Args: { _accept: boolean; _request_id: string }
        Returns: Json
      }
      session_training_load: { Args: { _session_id: string }; Returns: number }
      set_hr_threshold_manual:
        | {
            Args: { _athlete_id: string; _hr_threshold: number }
            Returns: undefined
          }
        | {
            Args: {
              _athlete_id: string
              _hr_threshold: number
              _source?: string
            }
            Returns: undefined
          }
      set_pace_auto_method: {
        Args: { _athlete_id: string; _method: string }
        Returns: undefined
      }
      set_pace_threshold_manual:
        | {
            Args: { _athlete_id: string; _threshold_sec_per_km: number }
            Returns: undefined
          }
        | {
            Args: {
              _athlete_id: string
              _source?: string
              _threshold_sec_per_km: number
            }
            Returns: undefined
          }
      set_vdot_source_performance: {
        Args: { _athlete_id: string; _performance_id: string }
        Returns: undefined
      }
      submit_coach_inquiry: {
        Args: {
          p_discipline: string
          p_email: string
          p_message: string
          p_name: string
          p_slug: string
        }
        Returns: undefined
      }
      toggle_coach_athlete_visibility: {
        Args: { p_coach_athlete_id: string; p_visible: boolean }
        Returns: undefined
      }
      vdot_threshold_pace_sec_per_km: {
        Args: { _vdot: number }
        Returns: number
      }
      zones_from_hr_threshold: {
        Args: { _hr_threshold: number }
        Returns: {
          z1_max: number
          z2_max: number
          z3_max: number
          z4_max: number
          z5_max: number
          z6_max: number
        }[]
      }
      zones_from_pace_threshold: {
        Args: { _threshold_sec_per_km: number }
        Returns: {
          z1_max: number
          z2_max: number
          z3_max: number
          z4_max: number
          z5_max: number
          z6_max: number
        }[]
      }
    }
    Enums: {
      app_role: "coach" | "athlete" | "admin" | "manager" | "parent"
      attendance_source: "auto_gps" | "manual"
      external_load_kind:
        | "work"
        | "gym"
        | "other_sport"
        | "school"
        | "travel"
        | "other"
      noticeboard_post_type:
        | "announcement"
        | "result"
        | "upcoming_race"
        | "training_event"
        | "birthday"
        | "resource"
      personal_entry_category:
        | "work_shift"
        | "appointment"
        | "personal"
        | "other"
      readiness_status: "green" | "amber" | "red"
      recovery_mode: "standing" | "walk" | "jog" | "float"
      session_day_type:
        | "training"
        | "race"
        | "recovery"
        | "cross_training"
        | "rest"
      session_intent:
        | "easy"
        | "aerobic"
        | "tempo"
        | "threshold"
        | "vo2"
        | "anaerobic"
        | "speed"
        | "time_trial"
      session_source: "manual" | "synced" | "fit_import"
      session_structure: "continuous" | "reps_intervals" | "intervals"
      step_kind: "warmup" | "work" | "recovery" | "cooldown" | "strides"
      target_kind: "time" | "distance"
      training_day_type:
        | "group_session"
        | "individual_program"
        | "rest"
        | "optional"
        | "long_run"
        | "cross_training"
        | "sport_specific_training"
        | "sport_specific_game_event"
        | "Session"
      training_time_of_day: "am" | "pm"
      zone_band: "z1" | "z2" | "z3" | "z4" | "z5" | "z6"
      zone_basis: "hr" | "pace" | "none"
      zone_source: "pace" | "hr"
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
  public: {
    Enums: {
      app_role: ["coach", "athlete", "admin", "manager", "parent"],
      attendance_source: ["auto_gps", "manual"],
      external_load_kind: [
        "work",
        "gym",
        "other_sport",
        "school",
        "travel",
        "other",
      ],
      noticeboard_post_type: [
        "announcement",
        "result",
        "upcoming_race",
        "training_event",
        "birthday",
        "resource",
      ],
      personal_entry_category: [
        "work_shift",
        "appointment",
        "personal",
        "other",
      ],
      readiness_status: ["green", "amber", "red"],
      recovery_mode: ["standing", "walk", "jog", "float"],
      session_day_type: [
        "training",
        "race",
        "recovery",
        "cross_training",
        "rest",
      ],
      session_intent: [
        "easy",
        "aerobic",
        "tempo",
        "threshold",
        "vo2",
        "anaerobic",
        "speed",
        "time_trial",
      ],
      session_source: ["manual", "synced", "fit_import"],
      session_structure: ["continuous", "reps_intervals", "intervals"],
      step_kind: ["warmup", "work", "recovery", "cooldown", "strides"],
      target_kind: ["time", "distance"],
      training_day_type: [
        "group_session",
        "individual_program",
        "rest",
        "optional",
        "long_run",
        "cross_training",
        "sport_specific_training",
        "sport_specific_game_event",
        "Session",
      ],
      training_time_of_day: ["am", "pm"],
      zone_band: ["z1", "z2", "z3", "z4", "z5", "z6"],
      zone_basis: ["hr", "pace", "none"],
      zone_source: ["pace", "hr"],
    },
  },
} as const
