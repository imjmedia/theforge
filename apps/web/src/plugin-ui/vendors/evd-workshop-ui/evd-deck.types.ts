export type EvdSlideType =
  | "title"
  | "problem_statement"
  | "solution_vision"
  | "current_vs_new"
  | "process_flow"
  | "automations"
  | "key_features"
  | "data_overview"
  | "integrations"
  | "security_access"
  | "rollout_plan"
  | "timeline"
  | "cta";

export interface EvdBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  highlightColor: string;
  bgColor: string;
  textColor: string;
  fontFamily: string;
  logoUrl?: string | null;
}

export interface EvdSlideBase {
  id: string;
  type: EvdSlideType;
  order: number;
  title: string;
  speakerNotes?: string;
  backgroundB64?: string;
  illustrationB64?: string;
  visualStyle?: string;
  [key: string]: unknown;
}

export interface EvdDeckJson {
  meta: {
    title: string;
    subtitle?: string;
    brand?: string;
    totalSlides?: number;
  };
  branding?: EvdBranding;
  slides: EvdSlideBase[];
}
