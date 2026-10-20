import { redirect } from "next/navigation";

// As conversas agora ficam na tela WhatsApp. Mantém links antigos (inclusive ?phone=) funcionando.
export default async function Messages({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { phone } = await searchParams;
  redirect(phone ? `/admin/whatsapp?phone=${encodeURIComponent(phone)}` : "/admin/whatsapp");
}
