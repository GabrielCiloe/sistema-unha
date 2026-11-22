import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Rota de envio da logo com banco e sessão simulados; a conversão para WebP usa o sharp de verdade.
const state = vi.hoisted(() => ({ saved: null as null | { data: Buffer; mime: string }, versionBumps: 0 }));

vi.mock("@/lib/server/auth", () => ({ requireUser: async () => ({ id: "u1", email: "a@local.test", name: "A" }) }));
vi.mock("@/lib/server/db", () => ({
  getBusiness: async () => ({ id: "main" }),
  db: {
    businessLogo: {
      upsert: ({ update }: { update: { data: Buffer; mime: string } }) => {
        state.saved = update;
        return update;
      },
      deleteMany: () => ({}),
    },
    business: {
      update: () => {
        state.versionBumps++;
        return {};
      },
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));

import { POST } from "@/app/api/admin/logo/route";
import { LOGO_MAX_BYTES } from "@/lib/server/images";

const MB = 1024 * 1024;

// PNG com ruído (não comprime) e canal alfa: o tamanho do arquivo passa de 2 MB com poucas dimensões.
async function noisyPng(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  for (let i = 3; i < raw.length; i += 4) raw[i] = i % 8 === 3 ? 0 : 255; // metade dos pixels transparentes
  return sharp(raw, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
}

function upload(bytes: Buffer | Uint8Array, name = "logo.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return POST(new Request("http://localhost/api/admin/logo", { method: "POST", body: form }), {});
}

beforeEach(() => {
  state.saved = null;
  state.versionBumps = 0;
});

describe("POST /api/admin/logo", () => {
  it("o limite é 5 MB", () => {
    expect(LOGO_MAX_BYTES).toBe(5 * MB);
  });

  it("aceita uma logo entre 2 MB e 5 MB (antes recusada) e guarda WebP menor, até 1024 px, com transparência", async () => {
    const png = await noisyPng(1200, 800); // ~3,8 MB
    expect(png.length).toBeGreaterThan(2 * MB);
    expect(png.length).toBeLessThan(5 * MB);
    const res = await upload(png);
    expect(res.status).toBe(200);
    expect(state.saved?.mime).toBe("image/webp");
    expect(state.versionBumps).toBe(1);
    const meta = await sharp(state.saved!.data).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
    expect(meta.width! / meta.height!).toBeCloseTo(1.5, 1);
    expect(meta.hasAlpha).toBe(true);
  }, 30_000);

  it("não amplia logo pequena", async () => {
    const small = await sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 200, g: 50, b: 120, alpha: 0.5 } } }).png().toBuffer();
    expect((await upload(small)).status).toBe(200);
    const meta = await sharp(state.saved!.data).metadata();
    expect([meta.width, meta.height]).toEqual([200, 120]);
  });

  it("acima de 5 MB: 413 com a mensagem nova e nada é salvo", async () => {
    const res = await upload(Buffer.alloc(5 * MB + 1, 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "A logo deve ter até 5 MB." });
    expect(state.saved).toBeNull();
  });

  it("exatamente 5 MB passa pelo limite (e cai na checagem de formato)", async () => {
    const res = await upload(Buffer.alloc(5 * MB, 1), "logo.bin", "application/octet-stream");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Envie PNG, JPG ou WebP." });
  });

  it("SVG continua recusado", async () => {
    const res = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "logo.svg", "image/svg+xml");
    expect(res.status).toBe(415);
    expect(state.saved).toBeNull();
  });

  it("arquivo com assinatura de PNG mas corrompido: 415 'Não foi possível processar a imagem.'", async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    const res = await upload(broken);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Não foi possível processar a imagem." });
    expect(state.saved).toBeNull();
  });
});
