import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Api, Fuente } from "./api.ts";
import { FuentesPage } from "./FuentesPage.tsx";
import { HistorialPage } from "./HistorialPage.tsx";
import { mensajeDe } from "./mensajes.ts";

function HistorialRuta({ api }: { api: Api }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const izq = searchParams.get("left");
  const der = searchParams.get("right");
  // null = sin query (solo timeline); undefined = query malformada → redirect
  const comparacion = useMemo(() => {
    if (izq === null && der === null) return null;
    if (izq === null || der === null || izq.trim() === "" || der.trim() === "") return undefined;
    const left = Number(izq);
    const right = Number(der);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return undefined;
    return { left, right };
  }, [izq, der]);

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

  if (comparacion === undefined) return <Navigate replace to={`/historial/${String(id)}`} />;
  if (cargando) return <p>Cargando…</p>;
  if (error || !fuente) return <p className="error">{error ?? "Fuente no encontrada"}</p>;
  return (
    <HistorialPage
      api={api}
      fuente={fuente}
      onVolver={() => navigate("/")}
      comparacion={comparacion}
      onCompararEnRuta={(left, right) =>
        navigate(`/historial/${String(id)}/compare?left=${left}&right=${right}`)}
    />
  );
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
      <Route path="/historial/:id/compare" element={<HistorialRuta api={api} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
