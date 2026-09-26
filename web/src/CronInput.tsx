import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";

export function esCronValida(expr: string): boolean {
  if (expr.trim() === "") return false;
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

interface CronInputProps {
  value: string;
  onChange: (valor: string) => void;
}

export function CronInput({ value, onChange }: CronInputProps) {
  const limpia = value.trim();
  const valida = esCronValida(limpia);
  const mostrarError = limpia !== "" && !valida;
  let preview = "";
  if (limpia !== "" && valida) {
    try {
      preview = cronstrue.toString(limpia);
    } catch {
      preview = "";
    }
  }

  return (
    <>
      <input
        placeholder="*/5 * * * *"
        aria-label="Expresión cron"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {mostrarError && (
        <span data-cron-error className="error">
          cron inválido
        </span>
      )}
      {preview !== "" && <span data-preview-cron>{preview}</span>}
    </>
  );
}
