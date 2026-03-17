import { Routes, Route, NavLink } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Live from "./pages/Live";
import Playback from "./pages/Playback";
import PDVs from "./pages/PDVs";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import Cameras from "./pages/Cameras";
import FaceSearch from "./pages/FaceSearch";
import Visitors from "./pages/Visitors";
import Monitoring from "./pages/Monitoring";

const navItems = [
  { to: "/", label: "Ao Vivo" },
  { to: "/cameras", label: "Câmeras" },
  { to: "/playback", label: "Gravações" },
  { to: "/faces", label: "Facial" },
  { to: "/visitors", label: "Visitantes" },
  { to: "/pdvs", label: "PDVs" },
  { to: "/monitor", label: "Monitor" },
  { to: "/settings", label: "Configurações" },
  { to: "/stats", label: "Stats" },
];

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  color: "#fff",
  textDecoration: "none",
  padding: "0.5rem 1rem",
  borderRadius: "4px",
  background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
  fontSize: "0.875rem",
});

function App() {
  const { user, logout } = useAuth();

  if (!user) return <Login />;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f5f5f5" }}>
      <header
        style={{
          padding: "0.75rem 2rem",
          background: "#1a1a2e",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: "2rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem", whiteSpace: "nowrap" }}>
          HappyDo Guard
        </h1>
        <nav style={{ display: "flex", gap: "0.5rem", flex: 1 }}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} style={navLinkStyle} end>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.8rem" }}>
          <span style={{ opacity: 0.7 }}>{user.email}</span>
          <button
            onClick={logout}
            style={{
              padding: "0.3rem 0.75rem",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            Sair
          </button>
        </div>
      </header>
      <main style={{ padding: "1.5rem" }}>
        <Routes>
          <Route path="/" element={<Live />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/playback" element={<Playback />} />
          <Route path="/faces" element={<FaceSearch />} />
          <Route path="/visitors" element={<Visitors />} />
          <Route path="/pdvs" element={<PDVs />} />
          <Route path="/monitor" element={<Monitoring />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/stats" element={<Stats />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
