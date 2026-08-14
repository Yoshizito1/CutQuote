'use client';

import { useState } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Card, Field } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Mode = 'entrar' | 'cadastrar';

const controlClasses =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ' +
  'transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30';

/**
 * Login e cadastro por e-mail e senha.
 *
 * Nome e empresa vão em `options.data`, que o trigger `handle_new_user` lê para
 * criar o perfil. O papel NUNCA é enviado daqui: quem se cadastra é sempre
 * 'cliente', e a promoção a admin é feita direto no banco. Aceitar o papel do
 * formulário permitiria a qualquer um se declarar administrador.
 */
export function AuthForm({ redirectTo = '/' }: { redirectTo?: string }) {
  const [mode, setMode] = useState<Mode>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Supabase não configurado. Verifique o .env.local.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      if (mode === 'entrar') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        window.location.assign(redirectTo);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, company } },
      });
      if (signUpError) throw signUpError;

      // Com confirmação de e-mail ligada, não há sessão até o usuário confirmar.
      if (data.session) {
        window.location.assign(redirectTo);
      } else {
        setInfo('Conta criada. Confira seu e-mail para confirmar o cadastro antes de entrar.');
      }
    } catch (caught) {
      setError(traduzErro(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-md p-6">
      <div className="mb-5 inline-flex rounded-lg border border-border p-1">
        {(['entrar', 'cadastrar'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
              setInfo(null);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === option
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'entrar' ? 'Entrar' : 'Criar conta'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === 'cadastrar' && (
          <>
            <Field label="Nome">
              <input
                className={controlClasses}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="Empresa">
              <input
                className={controlClasses}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                autoComplete="organization"
              />
            </Field>
          </>
        )}

        <Field label="E-mail">
          <input
            type="email"
            className={controlClasses}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </Field>

        <Field
          label="Senha"
          hint={mode === 'cadastrar' ? 'Mínimo de 8 caracteres.' : undefined}
        >
          <input
            type="password"
            className={controlClasses}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
            minLength={8}
            required
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>

      <p className="mt-4 text-xs text-muted-foreground">
        O orçamentista funciona sem conta. Entrar serve para salvar orçamentos e consultar o
        histórico.
      </p>
    </Card>
  );
}

/** Mensagens do Supabase vêm em inglês; as mais comuns viram texto útil. */
function traduzErro(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/Invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(message)) {
    return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
  }
  if (/User already registered/i.test(message)) {
    return 'Já existe uma conta com esse e-mail. Use a aba Entrar.';
  }
  if (/Password should be at least/i.test(message)) {
    return 'A senha é curta demais. Use pelo menos 8 caracteres.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Muitas tentativas em pouco tempo. Aguarde um instante.';
  }
  return message;
}
