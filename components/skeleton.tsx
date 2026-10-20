// Esqueletos de carregamento. As cores vêm do tema (funcionam nos modos claro e escuro).
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-ink/10 ${className}`} />;
}

// Envolve o esqueleto para leitores de tela: anuncia "carregando" uma única vez.
function Busy({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">Carregando…</span>
      {children}
    </div>
  );
}

export function TitleSkeleton() {
  return <Skeleton className="mb-6 h-8 w-48" />;
}

// Grade de cartões (serviços, clientes, pagamentos).
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Busy>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="card space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </li>
        ))}
      </ul>
    </Busy>
  );
}

// Página de formulário em cartões (Configurações, Personalização).
export function FormSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <Busy>
      <TitleSkeleton />
      <div className="space-y-6">
        {Array.from({ length: sections }, (_, i) => (
          <div key={i} className="card space-y-4">
            <Skeleton className="h-5 w-40" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <Skeleton className="h-10 w-44 rounded-xl" />
      </div>
    </Busy>
  );
}

// Visão geral: indicadores + próximos atendimentos.
export function DashboardSkeleton() {
  return (
    <Busy>
      <TitleSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card flex items-center justify-between gap-4">
            <div className="flex-1 space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-20" />
            </div>
            <Skeleton className="size-14 shrink-0 rounded-2xl" />
          </div>
        ))}
      </div>
      <Skeleton className="mb-4 mt-8 h-5 w-52" />
      <CardGridSkeleton count={3} />
    </Busy>
  );
}

function ChatRowSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

// Página de WhatsApp: conversas, chat e conexão.
export function WhatsAppSkeleton() {
  return (
    <Busy>
      <TitleSkeleton />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
          <div className="card space-y-4 p-4">
            {Array.from({ length: 5 }, (_, i) => <ChatRowSkeleton key={i} />)}
          </div>
          <div className="card min-h-[50vh]" />
        </div>
        <div className="card space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>
    </Busy>
  );
}

// Lista simples de linhas (conversas).
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Busy className="space-y-4 p-4">
      {Array.from({ length: rows }, (_, i) => <ChatRowSkeleton key={i} />)}
    </Busy>
  );
}

// Blocos de linha cheia (ex.: "verificando dias", "verificando conexão").
export function InlineSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <Busy className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
    </Busy>
  );
}

// Página pública: topo + cartões de serviço.
export function PublicSkeleton() {
  return (
    <Busy>
      <div className="flex flex-col items-center gap-4 border-b border-line px-4 pb-12 pt-14">
        <Skeleton className="size-28 rounded-3xl" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-3 h-11 w-40 rounded-xl" />
      </div>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <Skeleton className="h-5 w-52" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card flex items-center justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </Busy>
  );
}

// Página da reserva (acompanhamento do pagamento).
export function BookingSkeleton() {
  return (
    <Busy>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <Skeleton className="h-8 w-56" />
        <div className="card space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mx-auto size-48 rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>
    </Busy>
  );
}
