import sharp from "sharp";

// Só formatos raster por assinatura de arquivo. SVG é recusado de propósito (pode conter script).
export function sniffImage(b: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

// Converte para WebP (padrão da web): corrige a rotação do EXIF, remove metadados, limita as dimensões
// (sem ampliar) e comprime. Resultado típico: 70–90% menor que o PNG/JPG enviado.
export async function toWebp(input: Buffer, opts: { maxWidth: number; maxHeight: number; quality?: number }) {
  try {
    return await sharp(input, { limitInputPixels: 40_000_000 }) // recusa "bombas" de descompressão
      .rotate()
      .resize({ width: opts.maxWidth, height: opts.maxHeight, fit: "inside", withoutEnlargement: true })
      .webp({ quality: opts.quality ?? 80, effort: 5 })
      .toBuffer();
  } catch {
    return null; // arquivo corrompido ou grande demais
  }
}
