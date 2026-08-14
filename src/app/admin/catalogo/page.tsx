import { redirect } from 'next/navigation';

import { CatalogAdmin } from '@/components/admin/catalog-admin';
import { listCatalogVersions } from '@/lib/quote/catalog-repository';
import { getSessionUser, getSupabaseServerClient } from '@/lib/supabase/server';

export const metadata = { title: 'Catálogo — BELLARI' };

export default async function AdminCatalogoPage() {
  const user = await getSessionUser();
  if (!user) redirect('/entrar');

  // Guarda de interface. A proteção real é o RLS: mesmo que alguém chegue
  // nesta rota, as policies recusam qualquer escrita de não-admin.
  if (!user.isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Só administradores editam o catálogo. Para se tornar admin, rode no SQL Editor do
          Supabase:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-3 text-left text-xs">
{`update public.profiles
   set role = 'admin'
 where id = (select id from auth.users
              where email = '${user.email ?? 'voce@empresa.com.br'}');`}
        </pre>
      </div>
    );
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect('/');

  const versions = await listCatalogVersions(supabase);

  return <CatalogAdmin versions={versions} />;
}
