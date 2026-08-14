# CutQuote — motor de orçamento instantâneo para corte 2D

Aplicação web que lê um arquivo CAD (DXF ou SVG), mede a geometria, verifica as
restrições de fabricação e devolve o preço de corte a laser / jato d'água /
router CNC com a memória de cálculo aberta.

Todo o processamento acontece no navegador: nenhum desenho é enviado a servidor.

## Como rodar

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # build de produção
npm run verify       # 61 verificações do motor contra geometria conhecida
npm run samples      # regenera os DXF de exemplo em public/exemplos/
```

Arquivos de teste prontos ficam em [`public/exemplos/`](public/exemplos/) —
inclui um caso de erro proposital (`contorno-aberto.dxf`) para ver o bloqueio de
DFM funcionando.

## Como o preço é formado

O modelo é **físico, não tabelado**. Em vez de uma tabela "R$ X por peça", o
custo é derivado do que a máquina realmente faz:

```
custo de material = área aninhada × espessura × densidade × R$/kg × (1 + perda)
custo de corte    = (comprimento ÷ velocidade de corte) × R$/hora de máquina
custo de furação  = (nº de perfurações × segundos/perfuração) × R$/hora
```

Custos de setup (programação, preparo de dobra, troca de cor na pintura) são
por **pedido** e divididos pela quantidade. É essa divisão — e não um desconto
arbitrário — que faz o preço unitário cair conforme o lote cresce. Sobre isso
incide apenas um ganho de eficiência de lote (`QUANTITY_BREAKS`), que representa
menos manuseio por peça e melhor aproveitamento de chapa.

A consequência prática: para calibrar o sistema você mede a sua operação uma
vez (R$/kg de compra, R$/hora de máquina, velocidade real de corte por
espessura) e todo o resto se ajusta sozinho.

> ⚠️ **Os números do catálogo são placeholders plausíveis, não preços reais.**
> Eles precisam ser substituídos pelos custos da sua operação antes de qualquer
> uso comercial.

## Onde calibrar

Praticamente tudo que é número de negócio está em um único arquivo:
[`src/lib/quote/catalog.ts`](src/lib/quote/catalog.ts).

| O que ajustar | Onde |
| --- | --- |
| Custo-hora, sangria, chapa útil, prazo base | `PROCESSES` |
| Materiais, densidade, R$/kg, % de perda | `MATERIALS` |
| Velocidade de corte e tempo de perfuração por espessura | `MATERIALS[].thicknesses` |
| Furo mínimo, teia mínima, aba de dobra | `minHoleRatio`, `minWebRatio`, `minFlangeRatio` |
| Acabamentos e seus prazos | `FINISHES` |
| Dobra, rosca, insertos, gravação | `SERVICES` |
| Margem, pedido mínimo, taxa de pedido | `ORDER_CONFIG` |
| Curva de desconto por volume | `QUANTITY_BREAKS` |

## Templates paramétricos

Quem não tem CAD escolhe uma peça pronta, ajusta as medidas em campos numéricos
e vê preço e pré-visualização mudarem em tempo real. A peça pode ser adicionada
ao orçamento ou **baixada como DXF** para levar a outro fornecedor ou reabrir no
CAD.

| Template | Categoria | Destaque |
| --- | --- | --- |
| Placa retangular | Placas | Cantos arredondados + furação de canto |
| Disco / arruela | Placas | Furo central opcional |
| Flange com furação | Placas | Círculo de furação com checagem de sobreposição |
| Placa poligonal | Placas | 3 a 24 lados, calcula apótema e lado |
| Barra com furação linear | Placas | Furos ou rasgos oblongos igualmente espaçados |
| Painel perfurado | Painéis | Malha em linha ou alternada |
| Cantoneira em L | Dobrados | Desenvolvimento de dobra por fator K |
| Perfil U | Dobrados | Duas dobras, dedução dupla |
| Cartela triangular | Reforços | Gusset de canto |

**A regra que sustenta o design:** um template não tem caminho próprio de
cálculo. Ele produz as mesmas polilinhas que um DXF produziria e entra no mesmo
`analyzeDrawing`. É impossível uma peça de template ser cotada por regra
diferente de uma peça importada.

### Desenvolvimento de dobra

Os templates dobrados (cantoneira, perfil U) calculam o comprimento planificado
de verdade, com fator K:

```
arco da dobra (BA) = ângulo × (raio interno + K × espessura)
recuo (setback)    = (raio interno + espessura) × tan(ângulo / 2)
dedução            = 2 × recuo − BA
plano              = aba A + aba B − dedução
```

Uma cantoneira de abas 60 + 40 mm em chapa de 2 mm **não** sai de uma chapa de
100 mm — sai de 96,52 mm. Sem essa correção a peça fica maior que o projeto
depois de dobrada.

## Banco de dados (Supabase)

O app funciona **sem banco**: sem credenciais, ele roda com o catálogo do
código e orçamento em memória. Com o Supabase ligado, ganha contas, histórico
de orçamentos e catálogo editável pela interface.

### Instalação

**Opção A — sem instalar nada (mais rápida).** Abra o SQL Editor do projeto,
cole [`supabase/APLICAR-TUDO.sql`](supabase/APLICAR-TUDO.sql) inteiro e clique
em Run. Esse arquivo é a concatenação das quatro migrations na ordem correta.

**Opção B — Supabase CLI.**
```bash
npx supabase link --project-ref <ref>   # pede o token da conta e a senha do banco
npx supabase db push
```
Os arquivos em `supabase/migrations/` usam o formato `<timestamp>_nome.sql`
exigido pelo CLI — nomes fora desse padrão são **silenciosamente ignorados**
pelo `db push`.

Depois, em qualquer uma das opções:

1. Crie sua conta em `/entrar`.
2. Promova-se a administrador (o SQL também está no rodapé do arquivo de seed):
   ```sql
   update public.profiles
      set role = 'admin'
    where id = (select id from auth.users where email = 'voce@empresa.com.br');
   ```
3. Preencha `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

`npm run seed:sql` regenera a migration de seed a partir de
`src/lib/quote/catalog.ts` — o catálogo do código e o do banco nascem do mesmo
lugar, sem segunda cópia dos preços para sair de sincronia. Depois de rodá-lo,
regenere também o `APLICAR-TUDO.sql` se estiver usando a opção A.

### Versionamento de preço

Este é o ponto central do desenho. Uma versão de catálogo **publicada é
imutável**, e cada orçamento salvo carrega uma cópia congelada do catálogo em
`quotes.catalog_snapshot`.

Consequência prática: reajustar o R$/kg do inox hoje **não altera** o valor de
uma proposta enviada semana passada. Para mudar preço, o fluxo é clonar a
versão publicada → editar o rascunho → publicar. Publicar é atômico (arquiva a
anterior e promove a nova na mesma transação), e um índice parcial no banco
garante que nunca exista mais de uma versão publicada.

### Segurança

A chave publicável vai no bundle do cliente — é para isso que ela existe. Quem
protege os dados é o RLS:

| Tabela | Leitura | Escrita |
| --- | --- | --- |
| `profiles` | próprio perfil, ou admin | próprio perfil |
| catálogo | versão **publicada** para qualquer um; rascunhos só para admin | só admin |
| `quotes` / `quote_items` | só o dono, ou admin | só o dono |

Três decisões que valem registro:

- **`is_admin()` é `SECURITY DEFINER`.** Sem isso, uma policy de `profiles` que
  consulta `profiles` entra em recursão infinita.
- **O papel nunca vem do formulário.** Quem se cadastra é sempre `cliente`; a
  promoção a admin é feita no banco. Aceitar o papel do cliente permitiria a
  qualquer um se declarar administrador.
- **Link compartilhado passa por RPC, não por policy.** Uma policy que liberasse
  `SELECT` para anônimo com base no token exigiria permissão de consulta na
  tabela, o que permitiria varrer tokens. `get_shared_quote(token)` devolve um
  registro só, apenas se o compartilhamento estiver ligado e dentro da validade,
  e nunca expõe `user_id`.

### Limite conhecido

A geometria completa só é gravada quando a serialização fica abaixo de 400 KB.
Um painel com milhares de furos ultrapassa isso: o orçamento é salvo com todos
os valores e medidas, mas sem a pré-visualização do desenho, e o item fica
marcado com `geometry_truncated`. Guardar o arquivo original resolveria — exige
Supabase Storage, que está fora do escopo atual.

## Arquitetura

```
src/lib/geometry/     Camada de CAD — não conhece preço
  types.ts            Ponto, polilinha, contorno, peça; shoelace, ponto-em-polígono
  curves.ts           Achatamento de arco, bulge, elipse, Bézier e B-spline (de Boor)
  dxf.ts              Parser DXF ASCII + expansão de BLOCK/INSERT
  svg.ts              Parser SVG (path, rect, circle, transform)
  analyze.ts          Topologia: encadeia contornos, detecta furos e ilhas
  index.ts            Fachada loadDrawing() + detecção de papel de layer

src/lib/templates/    Geração paramétrica — produz o mesmo formato de um DXF
  shapes.ts           Retângulo, círculo, rasgo, polígono, malha, fator K
  catalog.ts          Os 9 templates e suas validações geométricas
  dxf-export.ts       Escritor de DXF R12 (download da peça configurada)
  index.ts            buildTemplateGeometry() -> mesmo analyzeDrawing()

src/lib/quote/        Camada de negócio — não conhece CAD
  catalog.ts          Tipo Catalog + STATIC_CATALOG (semente e fallback)
  catalog-repository.ts  Linhas do banco -> Catalog, com validação de integridade
  dfm.ts              Regras de manufaturabilidade
  pricing.ts          Composição do preço e escada de quantidade
  persistence.ts      Salvar/carregar orçamentos com snapshot congelado

src/lib/supabase/     Clientes e tipos do banco
src/components/quote/ Interface do orçamentista
src/components/admin/ Edição do catálogo
supabase/migrations/  Schema, RLS e seed
scripts/              Verificação do motor, exemplos e gerador do seed
```

O motor recebe o `Catalog` por parâmetro e não sabe que Supabase existe. É isso
que mantém `pricing.ts` testável sem banco e permite trocar a origem dos preços
sem tocar na regra de negócio.

A separação importa: `src/lib/geometry` não importa nada de `src/lib/quote`.
Dá para trocar a política comercial inteira sem tocar em uma linha de parser.

### O que o parser DXF cobre

`LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE` (com bulge), `POLYLINE`/`VERTEX` legada
(R12), `ELLIPSE`, `SPLINE` (avaliação de B-spline por de Boor, incluindo NURBS
racional) e `INSERT` com expansão recursiva de blocos, transformação e matriz de
repetição.

Splines são avaliadas de verdade, não aproximadas pelo polígono de controle —
essa aproximação superestima o comprimento e, portanto, o preço.

Unidades vêm do header `$INSUNITS`; quando ausente, o sistema assume milímetros
e emite um aviso de escala suspeita.

### Convenção de layers

| Nome do layer contém | Tratamento |
| --- | --- |
| `DOBRA`, `BEND`, `FOLD`, `VINCO` | Operação de prensa — não é cobrado como corte |
| `GRAVACAO`, `ETCH`, `ENGRAVE`, `MARCA` | Marcação superficial — cobrada em velocidade de gravação |
| qualquer outro | Corte passante |

### Verificação do motor

`npm run verify` roda 115 asserções contra geometrias de resultado analítico
conhecido — perímetro de retângulo, área de círculo, comprimento de arco,
aninhamento de três níveis, conversão de unidade, sinal do bulge, escada de
quantidade, cada regra de bloqueio do DFM, o desenvolvimento de dobra e um
**round-trip** (template → DXF exportado → parser) que exige geometria idêntica
na volta.

Vale notar um caso que o teste pega e a inspeção visual não: um canto
arredondado convexo e um canto "mordido" côncavo têm **exatamente o mesmo
perímetro** (ambos são um quarto de círculo), e portanto o mesmo custo de corte.
Só a área os distingue — e a área é o que define o custo de material.

## Escopo

Implementado: leitura de DXF/SVG, medição de geometria, validação DFM,
precificação, escada de quantidade, múltiplas peças por pedido, visualização
interativa.

Não implementado (fora do escopo desta entrega): backend, persistência,
autenticação, pagamento, nesting real em chapa, importação de STEP/DWG.
