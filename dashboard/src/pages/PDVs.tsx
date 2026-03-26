import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface PDV {
  id: string;
  name: string;
  code: string;
  address: string;
  bairro: string;
  city: string;
  state: string;
  bandeira: string;
  is_active: boolean;
  camera_count: number;
  cameras_online: number;
  cameras_offline: number;
}

function PDVs() {
  const { apiFetch } = useAuth();
  const [pdvs, setPdvs] = useState<PDV[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiFetch("/api/pdvs")
      .then((res) => res.json())
      .then(setPdvs)
      .catch(console.error);
  }, []);

  const filtered = pdvs.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.bairro?.toLowerCase().includes(q) ||
      p.city?.toLowerCase().includes(q) ||
      p.bandeira?.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q)
    );
  });

  const totalCameras = pdvs.reduce((s, p) => s + Number(p.camera_count), 0);
  const totalOnline = pdvs.reduce((s, p) => s + Number(p.cameras_online), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>
          Locais ({pdvs.length})
          <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "#666", marginLeft: "0.5rem" }}>
            {totalOnline}/{totalCameras} câmeras online
          </span>
        </h2>
        <input
          type="text"
          placeholder="Buscar por nome, bairro, cidade, bandeira..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid #ccc",
            fontSize: "0.85rem",
            width: "300px",
            maxWidth: "100%",
          }}
        />
      </div>

      {pdvs.length === 0 ? (
        <p style={{ color: "#666" }}>Nenhum local cadastrado. Os locais são sincronizados automaticamente do Control.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Nome</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Endereço</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Bairro</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Cidade</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Bandeira</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600, textAlign: "center" }}>Câmeras</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pdv) => (
                <tr key={pdv.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <strong>{pdv.name}</strong>
                    {pdv.code && (
                      <div style={{ fontSize: "0.65rem", color: "#999" }}>Cód: {pdv.code}</div>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>{pdv.address || "-"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>{pdv.bairro || "-"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>
                    {pdv.city}{pdv.state ? `/${pdv.state}` : ""}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#555" }}>{pdv.bandeira || "-"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "center" }}>
                    <span>{pdv.camera_count || 0}</span>
                    {Number(pdv.cameras_online) > 0 && (
                      <span style={{ color: "#4caf50", marginLeft: "0.3rem", fontSize: "0.75rem" }}>
                        ({pdv.cameras_online} online)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && search && (
                <tr>
                  <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#999" }}>
                    Nenhum local encontrado para "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PDVs;
