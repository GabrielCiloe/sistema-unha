"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Erro devolvido pela API (tem o status HTTP). Falha de rede não chega aqui: o fetch lança TypeError.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
    body: init?.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith("/api/admin")) window.location.href = "/login";
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Algo deu errado.");
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Só a carga mais recente vale: resposta de um caminho antigo (ou de um reload anterior) que chega depois é ignorada.
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      setError("");
      const fresh = await api<T>(path);
      if (mine === seq.current) setData(fresh);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Erro");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}
