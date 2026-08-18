'use client';

import dynamic from 'next/dynamic';

import type { FoldedModel } from '@/lib/geometry/fold';

/**
 * Carregamento sob demanda da cena 3D.
 *
 * `ssr: false` é obrigatório — a cena cria um contexto WebGL, que não existe no
 * servidor. E o import dinâmico é o que mantém o Three.js fora do bundle
 * principal: só baixa quando alguém abre a aba 3D.
 */
const FoldScene = dynamic(() => import('./fold-scene').then((module) => module.FoldScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Carregando visualização 3D…</p>
    </div>
  ),
});

export function FoldViewer({
  model,
  kFactor,
}: {
  model: FoldedModel;
  kFactor: number;
}) {
  if (model.faces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Não foi possível montar a peça dobrada. Veja os avisos ao lado.
        </p>
      </div>
    );
  }

  return <FoldScene model={model} kFactor={kFactor} />;
}
