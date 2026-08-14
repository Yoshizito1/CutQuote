<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# BELLARI — instruções do projeto

## O que é
Motor de orçamento instantâneo para corte 2D (laser, jato d'água, router CNC).
Lê DXF/SVG no navegador, mede a geometria, aplica regras de manufaturabilidade
e devolve o preço com a memória de cálculo aberta.

Partiu do template `ai-website-cloner-template`, mas **não é mais um projeto de
clonagem**: o pipeline `/clone-website` e o `TARGET.md` não se aplicam aqui.

## Stack
- Next.js 16 (App Router, React 19, TypeScript strict), Turbopack por padrão
- Tailwind CSS v4 com tokens oklch, `@base-ui/react` para primitivas
- Sem backend: todo o processamento é client-side

## Comandos
- `npm run dev` — servidor de desenvolvimento
- `npm run build` — build de produção
- `npm run verify` — 61 asserções do motor contra geometria de resultado conhecido
- `npm run samples` — regenera os DXF de exemplo
- `npm run lint` — ESLint

## Estilo de código
- TypeScript strict, sem `any`
- Exports nomeados, componentes em PascalCase, utilitários em camelCase
- Classes utilitárias do Tailwind, sem estilo inline
- Indentação de 2 espaços, mobile-first
- Identificadores em inglês, comentários em português

## Regras de arquitetura

**A camada de geometria não conhece preço.** `src/lib/geometry/` não importa
nada de `src/lib/quote/`. Essa fronteira é o que permite trocar a política
comercial inteira sem tocar em parser.

**Número de negócio vive no catálogo.** Custo, velocidade, margem, prazo e
limite de DFM ficam em `src/lib/quote/catalog.ts`. Não espalhe constante
comercial pelo código — se um número precisa ser calibrado pelo cliente, ele
pertence ao catálogo.

**Toda mudança no motor precisa de asserção.** `scripts/verify-engine.ts` compara
contra valores analíticos exatos, não contra snapshots. Se você alterar o parser
ou a topologia, adicione o caso correspondente com o valor calculado à mão.

**Não invente preço de mercado.** Os valores do catálogo são placeholders
declarados como tal no próprio arquivo e no README. Não os apresente como se
fossem preços reais de fornecedor.

## Armadilhas conhecidas
- Perímetro não distingue canto convexo de côncavo (ambos são um quarto de
  círculo). Ao mexer em bulge/arco, teste **área**, não só comprimento.
- SVG tem Y para baixo; DXF tem Y para cima. O parser de SVG inverte na entrada.
- A tolerância de corda é aplicada nas unidades do arquivo e escalada junto —
  cuidado ao mexer em `INSERT` com escala.
- DXF sem `$INSUNITS` é comum; o sistema assume mm e sinaliza escala suspeita.
