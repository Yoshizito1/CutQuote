import { notFound, redirect } from 'next/navigation';

import { SavedQuoteView } from '@/components/quote/saved-quote-view';
import { loadQuote } from '@/lib/quote/persistence';
import { getSessionUser, getSupabaseServerClient } from '@/lib/supabase/server';

export const metadata = { title: 'Orçamento — BELLARI' };

export default async function OrcamentoPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: params é uma Promise; acesso síncrono foi removido.
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect('/entrar');

  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect('/');

  // O RLS já garante que só o dono (ou um admin) enxerga o registro; um id de
  // outra pessoa simplesmente não retorna linha.
  const quote = await loadQuote(supabase, id);
  if (!quote) notFound();

  return <SavedQuoteView quote={quote} />;
}
