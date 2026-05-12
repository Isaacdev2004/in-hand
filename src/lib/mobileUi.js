export const UI_FONT =
  "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function userInitials(user) {
  const source = String(user?.username || user?.name || "U").trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  const compact = source.replace(/[^a-zA-Z0-9]/g, "");
  return (compact.slice(0, 2) || "U").toUpperCase();
}

export function figureInitials(name) {
  const words = String(name || "Figure")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }
  return String(name || "FI").slice(0, 2).toUpperCase();
}

export function stripToastEmoji(message) {
  return String(message || "")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a4.5 4.5 0 0 0-4.5 4.5v2.1c0 .5-.2 1-.5 1.4L5.7 14.2A1 1 0 0 0 6.6 16h10.8a1 1 0 0 0 .9-1.5l-1.3-1.7c-.3-.4-.5-.9-.5-1.4V7.5A4.5 4.5 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M10 18.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UserAvatar({ user, size = 40, style = {} }) {
  const initials = userInitials(user);
  return (
    <div
      className="inhand-avatar"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34), ...style }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
