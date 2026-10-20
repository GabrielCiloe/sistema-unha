const appt: Record<string, [string, string]> = {
  PENDING_PAYMENT: ["Aguardando sinal", "bg-amber-500/15 text-amber-300"],
  CONFIRMED: ["Confirmado", "bg-emerald-500/15 text-emerald-300"],
  COMPLETED: ["Concluído", "bg-sky-500/15 text-sky-300"],
  CANCELLED: ["Cancelado", "bg-red-500/15 text-red-300"],
  NO_SHOW: ["Não compareceu", "bg-zinc-500/20 text-zinc-300"],
};

const pay: Record<string, [string, string]> = {
  PENDING: ["Aguardando", "bg-amber-500/15 text-amber-300"],
  IN_REVIEW: ["Em análise", "bg-violet-500/20 text-violet-300"],
  PAID: ["Pago", "bg-emerald-500/15 text-emerald-300"],
  REJECTED: ["Recusado", "bg-red-500/15 text-red-300"],
  EXPIRED: ["Expirado", "bg-zinc-500/20 text-zinc-300"],
};

export const ApptBadge = ({ status }: { status: string }) => {
  const [label, cls] = appt[status] ?? [status, ""];
  return <span className={`badge ${cls}`}>{label}</span>;
};

export const PayBadge = ({ status }: { status: string }) => {
  const [label, cls] = pay[status] ?? [status, ""];
  return <span className={`badge ${cls}`}>{label}</span>;
};
