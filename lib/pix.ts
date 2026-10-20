// Pix estático "copia e cola" (BR Code / EMV MPM do Banco Central).
// O dinheiro vai direto para a chave do negócio; nenhum intermediário recebe.

const field = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, "0")}${value}`;

// Remove acentos e caracteres fora do conjunto aceito pelos bancos.
const plain = (value: string, max: number) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max) || "NA";

const validCpf = (d: string) => {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
};

// Normaliza a chave como o DICT espera: CPF/CNPJ só dígitos, telefone +55,
// e-mail minúsculo, chave aleatória (EVP) como está.
export function normalizePixKey(raw: string) {
  const key = raw.trim();
  if (key.includes("@")) return key.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    return key.toLowerCase();
  const digits = key.replace(/\D/g, "");
  if (key.startsWith("+")) return `+${digits}`;
  if (validCpf(digits) || digits.length === 14) return digits;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return key;
}

export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixPayload({
  key,
  name,
  city = "BRASIL",
  amount,
  txid = "***",
}: {
  key: string;
  name: string;
  city?: string;
  amount: number;
  txid?: string;
}) {
  if (!(amount > 0)) throw new Error("Valor do Pix deve ser positivo.");
  const reference = txid === "***" ? txid : txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const payload =
    field("00", "01") +
    field("26", field("00", "br.gov.bcb.pix") + field("01", normalizePixKey(key))) +
    field("52", "0000") +
    field("53", "986") +
    field("54", amount.toFixed(2)) +
    field("58", "BR") +
    field("59", plain(name, 25)) +
    field("60", plain(city, 15)) +
    field("62", field("05", reference)) +
    "6304";
  return payload + crc16(payload);
}
