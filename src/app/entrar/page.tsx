import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth-form';
import { supabaseConfigured } from '@/lib/supabase/config';
import { getSessionUser } from '@/lib/supabase/server';

export const metadata = { title: 'Entrar — BELLARI' };

export default async function EntrarPage() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Contas indisponíveis</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          As variáveis <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> e{' '}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> não
          estão definidas. O orçamentista continua funcionando sem conta.
        </p>
      </div>
    );
  }

  const user = await getSessionUser();
  if (user) redirect('/orcamentos');

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sua conta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Para salvar orçamentos e acompanhar o histórico.
        </p>
      </div>
      <AuthForm redirectTo="/orcamentos" />
    </div>
  );
}
