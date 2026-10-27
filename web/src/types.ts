export type Goal = { id?: number; kind: string; title: string; metric: string | null; unit: string | null; baseline: number | null; target: number | null; deadline: string | null; priority: number };
export type Slot = { day: string; from: string; to: string };
export type Avatar = { sex: 'm' | 'f'; build: number; hidden: boolean };

export type Profile = Partial<{
  name: string; age: number; height_cm: number; weight_kg: number; sex: 'male' | 'female'; timezone: string;
  goals: Goal[]; experience: string; sessions_per_week_now: number; break_weeks: number;
  known_results: { metric: string; value: number; unit: string }[]; daily_activity: string;
  pains: string[]; injuries: string[]; doctor_notes: string; discomfort_exercises: string[];
  schedule: Slot[]; max_minutes: number; sessions_per_week: number; schedule_flexible: boolean;
  places: string[]; equipment: string[]; can_run: boolean; place_notes: string;
  sleep_hours: number; sleep_quality: string; fatigue: string; work_load: string;
  nutrition_enabled: boolean; food_preferences: string; allergies: string[]; excluded_foods: string[];
  food_budget: { amount: number; currency: string; period: 'day' | 'week' | 'month' }; cooking_minutes: number; meals_per_day: number;
  notify_types: string[]; quiet_from: string; quiet_to: string; avatar: Avatar;
}>;

export type ProfileResp = { data: Profile; unknown: string[]; status: 'draft' | 'confirmed'; version: number; confirmedAt: string | null; missing: string[]; goals: Goal[] };

export type Msg = { role: 'bot' | 'user'; text: string; at: string; why?: string };
export type OnbView = {
  messages: Msg[]; topic: string | null; quick: { id: string; label: string }[]; progress: { step: number; total: number };
  finished: boolean; canGoBack: boolean; missingRequired: string[]; aiAvailable: boolean;
};

export type Home = {
  profile: { status: 'draft' | 'confirmed'; name: string | null; avatar: Avatar | null; timezone: string | null };
  onboarding: { started: boolean; finished: boolean };
  goals: Goal[];
  ai: { spentUsd: number; budgetUsd: number; available: boolean };
};

export type ExerciseBrief = { id: string; name: string; category: string; pattern: string; level: number; places: string[]; equipment: string[]; measure: string; short: string; status: string; isDemo: boolean; pose: string | null };
export type Card = {
  short: string; steps: string[]; breathing: string | null; mistakes: string[]; stop: string[]; easier: string[]; alternatives: string[];
  media: { pose: string; caption: string }[];
  scheme?: { label: string; minutes?: number; meters?: number; intensity: 'easy' | 'moderate' | 'hard' | 'rest' }[];
};
export type ExerciseFull = ExerciseBrief & { card: Card; source: string; license: string; version: number; reviewedBy: string | null; easierList: { id: string; name: string }[]; alternativeList: { id: string; name: string }[] };

export type SessionBrief = { id: number; date: string; startTime: string; startAt: string; title: string; purpose: string; durationMin: number; status: string; exercises: string[]; setsDone: number; setsPlanned: number };
export type Week = {
  today: string; weekStart: string; weekEnd: string; timezone: string; profileConfirmed: boolean;
  plan: { id: number; version: number; source: 'ai' | 'rules'; model: string | null; explanation: string; created_at: string } | null;
  sessions: SessionBrief[];
};
export type PlanItem = { exercise_id: string; sets: number; reps: number | null; seconds: number | null; meters: number | null; rest_s: number; note: string | null; name: string; equipment: string[]; measure: 'reps' | 'time' | 'distance'; short: string; pose: string | null; isDemo: boolean };
export type SetResult = { item_index: number; set_index: number; reps: number | null; seconds: number | null; meters: number | null; weight_kg: number | null; rpe: number | null; pain: number; note: string | null; corrected: number };
export type SessionDetail = SessionBrief & { warmupMin: number; cooldownMin: number; contentVersion: number; startedVersionLocked: boolean; items: PlanItem[]; results: SetResult[] };
export type CheckinOption = { id: string; title: string; description: string; recommended: boolean; durationMin: number | null };
export type CheckinResp = { checkinId: number; contentVersion: number; message: string; options: CheckinOption[] };
