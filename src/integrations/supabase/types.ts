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
      athlete_load_daily: {
        Row: {
          athlete_id: string
          atl: number | null
          combined_load: number | null
          ctl: number | null
          external_load_total: number | null
          load_date: string
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
          combined_load?: number | null
          ctl?: number | null
          external_load_total?: number | null
          load_date: string
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
          combined_load?: number | null
          ctl?: number | null
          external_load_total?: number | null
          load_date?: string
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
          pace_1500_sec_per_km: number | null
          pace_5k_sec_per_km: number | null
          pace_easy_sec_per_km: number | null
          pace_rep_sec_per_km: number | null
          pace_threshold_sec_per_km: number | null
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
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
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
          pace_1500_sec_per_km?: number | null
          pace_5k_sec_per_km?: number | null
          pace_easy_sec_per_km?: number | null
          pace_rep_sec_per_km?: number | null
          pace_threshold_sec_per_km?: number | null
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
          dob: string | null
          hr_max: number | null
          hr_rest: number | null
          id: string
          name: string
          primary_event: string | null
          sex: string | null
          training_age_years: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dob?: string | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          name: string
          primary_event?: string | null
          sex?: string | null
          training_age_years?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dob?: string | null
          hr_max?: number | null
          hr_rest?: number | null
          id?: string
          name?: string
          primary_event?: string | null
          sex?: string | null
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
          cadence: number | null
          created_at: string
          hr_avg: number | null
          hr_end: number | null
          hr_end_recovery: number | null
          hr_max: number | null
          id: string
          notes: string | null
          rep_number: number
          step_id: string
        }
        Insert: {
          actual_distance_m?: number | null
          actual_pace_sec_per_km?: number | null
          actual_time_seconds?: number | null
          cadence?: number | null
          created_at?: string
          hr_avg?: number | null
          hr_end?: number | null
          hr_end_recovery?: number | null
          hr_max?: number | null
          id?: string
          notes?: string | null
          rep_number: number
          step_id: string
        }
        Update: {
          actual_distance_m?: number | null
          actual_pace_sec_per_km?: number | null
          actual_time_seconds?: number | null
          cadence?: number | null
          created_at?: string
          hr_avg?: number | null
          hr_end?: number | null
          hr_end_recovery?: number | null
          hr_max?: number | null
          id?: string
          notes?: string | null
          rep_number?: number
          step_id?: string
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
      performances: {
        Row: {
          athlete_id: string
          context: string | null
          created_at: string
          distance_m: number
          id: string
          is_pb: boolean
          notes: string | null
          performance_date: string
          time_seconds: number
        }
        Insert: {
          athlete_id: string
          context?: string | null
          created_at?: string
          distance_m: number
          id?: string
          is_pb?: boolean
          notes?: string | null
          performance_date: string
          time_seconds: number
        }
        Update: {
          athlete_id?: string
          context?: string | null
          created_at?: string
          distance_m?: number
          id?: string
          is_pb?: boolean
          notes?: string | null
          performance_date?: string
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
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_adjustment_rules: {
        Row: {
          adjusted_summary: string
          adjustment_type: string
          category: Database["public"]["Enums"]["session_category"]
          id: string
          readiness_status: Database["public"]["Enums"]["readiness_status"]
          reason: string | null
        }
        Insert: {
          adjusted_summary: string
          adjustment_type: string
          category: Database["public"]["Enums"]["session_category"]
          id?: string
          readiness_status: Database["public"]["Enums"]["readiness_status"]
          reason?: string | null
        }
        Update: {
          adjusted_summary?: string
          adjustment_type?: string
          category?: Database["public"]["Enums"]["session_category"]
          id?: string
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
      sessions: {
        Row: {
          athlete_id: string
          avg_hr: number | null
          category: Database["public"]["Enums"]["session_category"]
          completed_at: string | null
          completion_pct: number | null
          created_at: string
          created_by: string
          hr_drift_pct: number | null
          id: string
          is_planned: boolean
          notes: string | null
          pace_decay_pct: number | null
          rpe: number | null
          session_date: string
          source: Database["public"]["Enums"]["session_source"]
          terrain: string | null
          title: string
          total_distance_m: number | null
          total_time_seconds: number | null
          updated_at: string
          weather: string | null
          zone_basis: Database["public"]["Enums"]["zone_basis"]
        }
        Insert: {
          athlete_id: string
          avg_hr?: number | null
          category?: Database["public"]["Enums"]["session_category"]
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by: string
          hr_drift_pct?: number | null
          id?: string
          is_planned?: boolean
          notes?: string | null
          pace_decay_pct?: number | null
          rpe?: number | null
          session_date: string
          source?: Database["public"]["Enums"]["session_source"]
          terrain?: string | null
          title: string
          total_distance_m?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          weather?: string | null
          zone_basis?: Database["public"]["Enums"]["zone_basis"]
        }
        Update: {
          athlete_id?: string
          avg_hr?: number | null
          category?: Database["public"]["Enums"]["session_category"]
          completed_at?: string | null
          completion_pct?: number | null
          created_at?: string
          created_by?: string
          hr_drift_pct?: number | null
          id?: string
          is_planned?: boolean
          notes?: string | null
          pace_decay_pct?: number | null
          rpe?: number | null
          session_date?: string
          source?: Database["public"]["Enums"]["session_source"]
          terrain?: string | null
          title?: string
          total_distance_m?: number | null
          total_time_seconds?: number | null
          updated_at?: string
          weather?: string | null
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
        ]
      }
      steps: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["step_kind"]
          notes: string | null
          recovery_mode: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m: number | null
          recovery_target_kind:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds: number | null
          reps: number
          session_id: string
          step_order: number
          target_distance_m: number | null
          target_kind: Database["public"]["Enums"]["target_kind"] | null
          target_pace_sec_per_km: number | null
          target_time_seconds: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          session_id: string
          step_order: number
          target_distance_m?: number | null
          target_kind?: Database["public"]["Enums"]["target_kind"] | null
          target_pace_sec_per_km?: number | null
          target_time_seconds?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["step_kind"]
          notes?: string | null
          recovery_mode?: Database["public"]["Enums"]["recovery_mode"] | null
          recovery_target_distance_m?: number | null
          recovery_target_kind?:
            | Database["public"]["Enums"]["target_kind"]
            | null
          recovery_target_seconds?: number | null
          reps?: number
          session_id?: string
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
      [_ in never]: never
    }
    Functions: {
      can_access_athlete: {
        Args: { _athlete_id: string; _user_id: string }
        Returns: boolean
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
    }
    Enums: {
      app_role: "coach" | "athlete" | "admin"
      external_load_kind:
        | "work"
        | "gym"
        | "other_sport"
        | "school"
        | "travel"
        | "other"
      readiness_status: "green" | "amber" | "red"
      recovery_mode: "standing" | "walk" | "jog" | "float"
      session_category:
        | "easy"
        | "long"
        | "tempo"
        | "threshold"
        | "intervals"
        | "reps"
        | "race"
        | "recovery"
        | "cross_training"
        | "rest"
      session_source: "manual" | "synced"
      step_kind: "warmup" | "work" | "recovery" | "cooldown"
      target_kind: "time" | "distance"
      zone_basis: "hr" | "pace" | "none"
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
      app_role: ["coach", "athlete", "admin"],
      external_load_kind: [
        "work",
        "gym",
        "other_sport",
        "school",
        "travel",
        "other",
      ],
      readiness_status: ["green", "amber", "red"],
      recovery_mode: ["standing", "walk", "jog", "float"],
      session_category: [
        "easy",
        "long",
        "tempo",
        "threshold",
        "intervals",
        "reps",
        "race",
        "recovery",
        "cross_training",
        "rest",
      ],
      session_source: ["manual", "synced"],
      step_kind: ["warmup", "work", "recovery", "cooldown"],
      target_kind: ["time", "distance"],
      zone_basis: ["hr", "pace", "none"],
    },
  },
} as const
