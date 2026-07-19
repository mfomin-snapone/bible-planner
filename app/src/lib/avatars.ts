/**
 * Preset avatar definitions — Messianic Jewish themed, simple and modern.
 * Each preset has an id, a symbol (emoji or text), and a background CSS color.
 */
export interface AvatarPreset {
  id: string;
  symbol: string;
  label: string;
  bg: string; // CSS color for the background
  fg: string; // CSS color for the symbol
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "default",     symbol: "👤", label: "Default",     bg: "var(--accent-bg)", fg: "var(--accent)" },
  { id: "menorah",     symbol: "🕎", label: "Menorah",     bg: "#4a3728", fg: "#f5c842" },
  { id: "star",        symbol: "✡️", label: "Star of David", bg: "#1a3a6e", fg: "#a8c8f8" },
  { id: "fish",        symbol: "🐟", label: "Fish",         bg: "#1a4d5a", fg: "#7dd4e4" },
  { id: "olive",       symbol: "🫒", label: "Olive Branch", bg: "#2e4a22", fg: "#8fc87e" },
  { id: "shofar",      symbol: "📯", label: "Shofar",       bg: "#5a3a1a", fg: "#e8b87a" },
  { id: "dove",        symbol: "🕊️", label: "Dove",         bg: "#2a4060", fg: "#b8d4f0" },
  { id: "scroll",      symbol: "📜", label: "Torah Scroll", bg: "#4a3820", fg: "#d4a870" },
  { id: "pomegranate", symbol: "🍎", label: "Pomegranate",  bg: "#5a1a2a", fg: "#f08090" },
  { id: "grapes",      symbol: "🍇", label: "Grapes",       bg: "#3a1a5a", fg: "#c090e0" },
  { id: "lamb",        symbol: "🐑", label: "Lamb",         bg: "#3a3a4a", fg: "#d0d0e8" },
  { id: "candles",     symbol: "🕯️", label: "Candles",      bg: "#2e2a18", fg: "#f0d070" },
  { id: "water",       symbol: "💧", label: "Living Water", bg: "#1a3a5a", fg: "#70b8e0" },
  { id: "aleph",       symbol: "א",  label: "Aleph",        bg: "#1a3a2a", fg: "#7ec8a0" },
];

export function getAvatar(id?: string): AvatarPreset {
  return AVATAR_PRESETS.find((a) => a.id === (id ?? "default")) ?? AVATAR_PRESETS[0];
}
