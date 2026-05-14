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

/** YouTube / Vimeo / direct mp4 for listing short video. */
export function getListingVideoEmbed(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (id) return { type: "iframe", src: `https://www.youtube.com/embed/${id}` };
    }
    if (host.includes("youtube.com")) {
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      if (id && id.length > 4) return { type: "iframe", src: `https://www.youtube.com/embed/${id}` };
    }
    if (host.includes("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      if (id && /^\d+$/.test(id)) return { type: "iframe", src: `https://player.vimeo.com/video/${id}` };
    }
  } catch {
    /* ignore */
  }
  if (/^https?:\/\/.+\.(mp4|webm)(\?.*)?$/i.test(url)) return { type: "video", src: url };
  return null;
}

export function VerifiedInHandBadge({ compact }) {
  return (
    <span
      title="Verified In Hand — trusted seller"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: compact ? 8 : 9,
        fontWeight: 800,
        letterSpacing: 0.2,
        color: "#1f4f82",
        background: "linear-gradient(135deg,#EAF1FA,#dce8f5)",
        border: "1px solid #b8cce8",
        borderRadius: 999,
        padding: compact ? "1px 6px" : "2px 8px",
        flexShrink: 0,
        lineHeight: 1.2,
      }}
    >
      <span aria-hidden="true" style={{ color: "#00b894", fontSize: compact ? 9 : 10 }}>
        ✓
      </span>
      In Hand
    </span>
  );
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
