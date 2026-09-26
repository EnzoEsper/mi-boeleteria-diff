import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { Api, Fuente } from "./api.ts";
import { FuentesPage } from "./FuentesPage.tsx";
import { HistorialPage } from "./HistorialPage.tsx";
import { mensajeDe } from "./mensajes.ts";

function HistorialRuta({ api }: { api: Api }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setFuente(null);
    setCargando(true);
    setError(null);
    api.getSource(String(id)).then(
      (fuenteLeida) => {
        if (!vivo) return;
        setFuente(fuenteLeida);
        setCargando(false);
      },
      (motivo) => {
        if (!vivo) return;
        setError(mensajeDe(motivo));
        setCargando(false);
      },
    );
    return () => {
      vivo = false;
    };
  }, [api, id]);

  if (cargando) return <p>Cargando…</p>;
  if (error || !fuente) return <p className="error">{error ?? "Fuente no encontrada"}</p>;
  return <HistorialPage api={api} fuente={fuente} onVolver={() => navigate("/")} />;
}

export function Shell({ api }: { api: Api }) {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        path="/"
        element={<FuentesPage api={api} onVerHistorial={(fuente) => navigate(`/historial/${fuente.id}`)} />}
      />
      <Route path="/historial/:id" element={<HistorialRuta api={api} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
