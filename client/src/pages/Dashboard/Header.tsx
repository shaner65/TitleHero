function getUserInitials(): string {
  if (typeof window === "undefined") return "USER";
  const stored = (localStorage.getItem("username") || "").trim();
  const chars = stored.slice(0, 3).toUpperCase();
  const masked = chars + "*".repeat(Math.max(0, 6 - chars.length));
  return masked || "USER";
}

type HeaderProps = {
  adminMode: boolean;
};

export function Header({ adminMode }: HeaderProps) {
  const userInitials = getUserInitials();

  return (
    <header className="header">
      <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="sidebar-logo" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '20px' }}>
        <div className="breadcrumbs">DASHBOARD</div>
        {adminMode && (
          <span style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '10px' }}>
            ADMIN MODE
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="profile">
            <div>{userInitials}</div>
            <div className="avatar" />
          </div>
        </div>
      </div>
    </header>
  );
}
