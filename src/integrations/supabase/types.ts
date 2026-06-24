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
          review_type: string
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
          review_type: string
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
          review_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reviews_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
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
      athlete_physio_profile: {
        Row: {
          aerobic_pct: number | null
          anaerobic_pct: number | null
          archetype: string | null
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
      athlete_zone_profiles: {
        Row: {
          athlete_id: string
          auto_derived: boolean
          hr_max: number | null
          hr_z1_max: number | null
          hr_z2_max: number | null
          hr_z3_max: number | null
          hr_z4_max: number | null
          hr_z5_max: number | null
          hr_zones_manual: boolean
          pace_1500_sec_per_km: number | null
          pace_5k_sec_per_km: number | null
          pace_easy_sec_per_km: number | null
          pace_rep_sec_per_km: number | null
          pace_threshold_sec_per_km: number | null
          pace_zones_manual: boolean
          updated_at: string
        }
        Insert: {
          athlete_id: string
          auto_derived?: boolean
          hr_max?: number | null
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          hr_zones_manual?: boolean
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
          pace_zones_manual?: boolean
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          auto_derived?: boolean
          hr_max?: number | null
          hr_z1_max?: number | null
          hr_z2_max?: number | null
          hr_z3_max?: number | null
          hr_z4_max?: number | null
          hr_z5_max?: number | null
          hr_zones_manual?: boolean
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
          pace_zones_manual?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_zone_profiles_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          created_at: string
          created_by: string | null
          distance_unit: string
          dob: string | null
          hr_max: number | null
          hr_rest: number | null
          id: string
          last_checkout_at: string | null
          last_log_at: string | null
          name: string
          primary_event: string | null
          profile_image_url: string | null
          reminder_evening_local: string | null
          reminder_morning_local: string | null
          reminders_enabled: boolean
          sex: string | null
          timezone: string
          training_age_years: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          distance_unit?: string
          dob?: string | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          last_checkout_at?: string | null
          last_log_at?: string | null
          name: string
          primary_event?: string | null
          profile_image_url?: string | null
          reminder_evening_local?: string | null
          reminder_morning_local?: string | null
          reminders_enabled?: boolean
          sex?: string | null
          timezone?: string
          training_age_years?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          distance_unit?: string
          dob?: string | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          last_checkout_at?: string | null
          last_log_at?: string | null
          name?: string
          primary_event?: string | null
          profile_image_url?: string | null
          reminder_evening_local?: string | null
          reminder_morning_local?: string | null
          reminders_enabled?: boolean
          sex?: string | null
          timezone?: string
          training_age_years?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      coach_athletes: {
        Row: {
          athlete_id: string
          coach_user_id: string
          created_at: string
          id: string
        }
        Insert: {
          athlete_id: string
          coach_user_id: string
          created_at?: string
          id?: string
        }
        Update: {
          athlete_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
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
      noticeboard_posts: {
        Row: {
          author_id: string
          body: string | null
          created_at: string
          edited_at: string | null
          event_date: string | null
          id: string
          link_url: string | null
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
          meta?: Json
          pinned?: boolean
          post_type?: Database["public"]["Enums"]["noticeboard_post_type"]
          title?: string
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          distance_m: number
          event_name: string | null
          field_size: number | null
          fit_file_id: string | null
          id: string
          is_pb: boolean
          notes: string | null
          overall_place: number | null
          performance_date: string
          round: string | null
          splits: Json | null
          time_seconds: number
        }
        Insert: {
          age_group?: string | null
          age_group_place?: number | null
          athlete_id: string
          conditions?: Json | null
          context?: string | null
          created_at?: string
          distance_m: number
          event_name?: string | null
          field_size?: number | null
          fit_file_id?: string | null
          id?: string
          is_pb?: boolean
          notes?: string | null
          overall_place?: number | null
          performance_date: string
          round?: string | null
          splits?: Json | null
          time_seconds: number
        }
        Update: {
          age_group?: string | null
          age_group_place?: number | null
          athlete_id?: string
          conditions?: Json | null
          context?: string | null
          created_at?: string
          distance_m?: number
          event_name?: string | null
          field_size?: number | null
          fit_file_id?: string | null
          id?: string
          is_pb?: boolean
          notes?: string | null
          overall_place?: number | null
          performance_date?: string
          round?: string | null
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
        ]
      }
      profiles: {
        Row: {
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
      raw_session_points: {
        Row: {
          cadence: number | null
          created_at: string
          elapsed_s: number
          elevation_m: number | null
          file_id: string | null
          ground_contact_time_ms: number | null
          hr: number | null
          id: number
          lat: number | null
          lng: number | null
          pace_sec_per_km: number | null
          segment_type: string | null
          session_id: string
          step_id: string | null
          vertical_oscillation_cm: number | null
        }
        Insert: {
          cadence?: number | null
          created_at?: string
          elapsed_s: number
          elevation_m?: number | null
          file_id?: string | null
          ground_contact_time_ms?: number | null
          hr?: number | null
          id?: number
          lat?: number | null
          lng?: number | null
          pace_sec_per_km?: number | null
          segment_type?: string | null
          session_id: string
          step_id?: string | null
          vertical_oscillation_cm?: number | null
        }
        Update: {
          cadence?: number | null
          created_at?: string
          elapsed_s?: number
          elevation_m?: number | null
          file_id?: string | null
          ground_contact_time_ms?: number | null
          hr?: number | null
          id?: number
          lat?: number | null
          lng?: number | null
          pace_sec_per_km?: number | null
          segment_type?: string | null
          session_id?: string
          step_id?: string | null
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
          created_at: string
          file_kind: string
          id: string
          mapped_step_id: string | null
          original_filename: string | null
          parse_error: string | null
          parsed_at: string | null
          session_id: string | null
          started_at: string | null
          storage_path: string
          total_distance_m: number | null
          total_time_s: number | null
          updated_at: string
        }
        Insert: {
          activity_type?: string | null
          athlete_id: string
          created_at?: string
          file_kind: string
          id?: string
          mapped_step_id?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parsed_at?: string | null
          session_id?: string | null
          started_at?: string | null
          storage_path: string
          total_distance_m?: number | null
          total_time_s?: number | null
          updated_at?: string
        }
        Update: {
          activity_type?: string | null
          athlete_id?: string
          created_at?: string
          file_kind?: string
          id?: string
          mapped_step_id?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parsed_at?: string | null
          session_id?: string | null
          started_at?: string | null
          storage_path?: string
          total_distance_m?: number | null
          total_time_s?: number | null
          updated_at?: string
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
          avg_hr: number | null
          completed_at: string | null
          completion_pct: number | null
          created_at: string
          created_by: string
          data_source: string | null
          day_type: Database["public"]["Enums"]["session_day_type"]
          fueling_notes: string | null
          hr_drift_pct: number | null
          id: string
          intent: Database["public"]["Enums"]["session_intent"] | null
          is_long_run: boolean
          is_planned: boolean
          location_id: string | null
          max_hr: number | null
          needs_review: boolean | null
          notes: string | null
          pace_decay_pct: number | null
          rpe: number | null
          session_date: string
          source: Database["public"]["Enums"]["session_source"]
          structure: Database["public"]["Enums"]["session_structure"] | null
          terrain: string | null
          title: string
          total_distance_m: number | null
          total_time_seconds: number | null
          updated_at: string
          weather: string | null
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
          avg_hr?: number | null
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by: string
          data_source?: string | null
          day_type?: Database["public"]["Enums"]["session_day_type"]
          fueling_notes?: string | null
          hr_drift_pct?: number | null
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"] | null
          is_long_run?: boolean
          is_planned?: boolean
          location_id?: string | null
          max_hr?: number | null
          needs_review?: boolean | null
          notes?: string | null
          pace_decay_pct?: number | null
          rpe?: number | null
          session_date: string
          source?: Database["public"]["Enums"]["session_source"]
          structure?: Database["public"]["Enums"]["session_structure"] | null
          terrain?: string | null
          title: string
          total_distance_m?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          weather?: string | null
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
          avg_hr?: number | null
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by?: string
          data_source?: string | null
          day_type?: Database["public"]["Enums"]["session_day_type"]
          fueling_notes?: string | null
          hr_drift_pct?: number | null
          id?: string
          intent?: Database["public"]["Enums"]["session_intent"] | null
          is_long_run?: boolean
          is_planned?: boolean
          location_id?: string | null
          max_hr?: number | null
          needs_review?: boolean | null
          notes?: string | null
          pace_decay_pct?: number | null
          rpe?: number | null
          session_date?: string
          source?: Database["public"]["Enums"]["session_source"]
          structure?: Database["public"]["Enums"]["session_structure"] | null
          terrain?: string | null
          title?: string
          total_distance_m?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          weather?: string | null
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
          session_id: string
          set_count: number
          step_order: number
          target_distance_m: number | null
          target_kind: Database["public"]["Enums"]["target_kind"] | null
          target_pace_sec_per_km: number | null
          target_time_seconds: number | null
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
          session_id: string
          set_count?: number
          step_order: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_pace_sec_per_km?: number | null
          target_time_seconds?: number | null
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
          session_id?: string
          set_count?: number
          step_order?: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_pace_sec_per_km?: number | null
          target_time_seconds?: number | null
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
          target_pace_sec_per_km: number | null
          target_time_seconds: number | null
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
          target_pace_sec_per_km?: number | null
          target_time_seconds?: number | null
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
          target_pace_sec_per_km?: number | null
          target_time_seconds?: number | null
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
      can_access_athlete: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      claim_athlete_invite: { Args: { _token: string }; Returns: Json }
      compute_session_completion: {
        Args: { _session_id: string }
        Returns: undefined
      }
      compute_session_fatigue: {
        Args: { _session_id: string }
        Returns: undefined
      }
      create_birthday_posts: { Args: never; Returns: undefined }
      external_load_score: {
        Args: { _athlete_id: string; _date: string }
        Returns: number
      }
      get_invite_by_token: {
        Args: { _token: string }
        Returns: {
          athlete_name: string
          coach_name: string
          invited_email: string
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_coach_of: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
      }
      recompute_athlete_zone_profile: {
        Args: { _athlete_id: string }
        Returns: undefined
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
      respond_to_join_request: {
        Args: { _accept: boolean; _request_id: string }
        Returns: Json
      }
      session_training_load: { Args: { _session_id: string }; Returns: number }
    }
    Enums: {
      app_role: "coach" | "athlete" | "admin" | "manager"
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
      session_structure: "continuous" | "reps_intervals"
      step_kind: "warmup" | "work" | "recovery" | "cooldown" | "strides"
      target_kind: "time" | "distance"
      zone_band: "z1" | "z2" | "z3" | "z4" | "z5"
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
      app_role: ["coach", "athlete", "admin", "manager"],
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
      session_structure: ["continuous", "reps_intervals"],
      step_kind: ["warmup", "work", "recovery", "cooldown", "strides"],
      target_kind: ["time", "distance"],
      zone_band: ["z1", "z2", "z3", "z4", "z5"],
      zone_basis: ["hr", "pace", "none"],
      zone_source: ["pace", "hr"],
    },
  },
} as const
