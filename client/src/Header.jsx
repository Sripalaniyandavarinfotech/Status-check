// The indigo bar on every page.
export default function Header({ user, onLogout, children }) {
  return (
    <header className="top">
      <div className="wrap top-in">
        <a className="brand" href="/">Sir Palaniyandavar Info Tech</a>
        <div className="top-right">
          {children}
          {user && <span className="who-am-i">{user.userId}</span>}
          {user && <button className="btn on-ink" onClick={onLogout}>Log out</button>}
        </div>
      </div>
    </header>
  );
}
