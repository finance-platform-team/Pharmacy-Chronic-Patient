// Shared initials-avatar helpers (LookupInput, FilterSelectPill).

// Synapse-harmonised avatar hues (turquoise, clinical blue, amber, violet,
// red, deep teal, slate) — replaces the old gold-theme browns.
const AVATAR_PALETTE = ['#126E5C', '#2B6680', '#8F5C0D', '#6046AA', '#A23E3E', '#0B5A50', '#55706A'];

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
