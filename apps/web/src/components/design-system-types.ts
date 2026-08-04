/** Shared types for DESIGN.md / Design System preview. */

export interface TypographyToken {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: string;
}

export interface ComponentToken {
  backgroundColor?: string;
  textColor?: string;
  rounded?: string;
  padding?: string | number;
  size?: string | number;
  height?: string | number;
  width?: string | number;
  typography?: string;
}

export interface DesignTokens {
  name?: string;
  version?: string;
  description?: string;
  /** Raw palette hex values referenced by semantic colors (`{primitives.zinc900}`). */
  primitives?: Record<string, string>;
  colors?: Record<string, string>;
  typography?: Record<string, TypographyToken>;
  rounded?: Record<string, string>;
  spacing?: Record<string, string>;
  elevation?: Record<string, string>;
  components?: Record<string, ComponentToken>;
}
