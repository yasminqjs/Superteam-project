# Como usar o Recebi

Guia passo a passo, em português, para rodar e demonstrar o projeto. A documentação técnica
(arquitetura, formato do selo, decisões) está em inglês no [README.md](README.md) e no
[DECISIONS.md](DECISIONS.md).

## 1. Os dois modos

O mesmo app roda de dois jeitos. Escolha pelo que você quer fazer.

| | Modo **mock** | Modo **live** |
|---|---|---|
| Para que serve | Desenvolver, ensaiar, mostrar as telas | A demo de verdade, os vídeos e a submissão |
| Solana | Um "nó" falso dentro do próprio app | Devnet de verdade |
| Carteira | Carteira de demonstração embutida | Phantom |
| Banco de dados | Arquivo local (`.mock-data/`) | Supabase |
| Cotação em reais | Valores inventados, mas plausíveis | PTAX real do Banco Central |
| O que precisa configurar | Nada | Supabase, chaves, RPC, Phantom |

**Importante:** no modo mock nada está na Solana. Um "Verified" do modo mock não prova nada
para ninguém. Por isso toda tela mostra a faixa "Mock mode" e os comprovantes saem marcados
como `recebi:mock`. **Os vídeos do hackathon precisam ser gravados no modo live.**

## 2. Antes de começar

- Node.js 20 ou mais novo (`node --version` mostra a versão).
- Todos os comandos rodam **dentro da pasta do projeto**. Nesta máquina:

  ```powershell
  cd $HOME\Downloads\hack_crypto\recebi
  ```

- **No PowerShell do Windows, use `npm.cmd` no lugar de `npm`.** O Windows bloqueia o `npm`
  puro com a mensagem "running scripts is disabled on this system". Todos os comandos deste
  guia já estão escritos com `npm.cmd`.
- O site só existe enquanto o servidor está rodando. **Não feche o terminal** onde você rodou
  o `dev`. Para parar o servidor, aperte `Ctrl + C` nele.

### Em outro computador (por exemplo, o da sua dupla)

```powershell
git clone https://github.com/VictorBarretoAndrade/hackathon_crypto.git
cd hackathon_crypto
npm.cmd install
copy .env.example .env.local
npm.cmd run dev:mock
```

## 3. Modo mock: rodando em um minuto

```powershell
cd $HOME\Downloads\hack_crypto\recebi
npm.cmd run dev:mock
```

Espere aparecer `Ready` e abra **http://localhost:3000**. Se o terminal mostrar outra porta
(por exemplo `3001`, quando a 3000 já está em uso), abra essa.

### Roteiro de cliques

1. **Use demo wallet**, depois **Sign in with this wallet**. Você cai no painel.
2. **Import from wallet**. Aparecem 4 recebimentos de exemplo, cada um com o valor em reais.
   Clique de novo: nada é duplicado.
3. Abra o recebimento de **1,200.00 USDC**. Em "What this payment is":
   - Category: `Service`
   - Who paid: `Acme Labs` (They are a: `Client`)
   - Description: o que quiser
   - **Save**
4. **Seal onchain**. Em um ou dois segundos aparece o bloco verde "Sealed onchain".
5. **Open public verification**. Abre a página pública com o selo **Verified** e a lista de
   checagens.
6. Na mesma página: **Tamper test**, troque `"amount": "1200.00"` por `"1300.00"` e clique em
   **Verify again**. Vira **Mismatch**, dizendo quais checagens falharam.
   **Restore the original** desfaz.
7. Volte ao painel (**Payments**) e abra o recebimento de **500.00 USDC**, que caiu em um
   sábado. A linha "Rate" mostra a data da sexta-feira: é a regra de fim de semana da PTAX.
8. **Invoices > New invoice**. Preencha cliente, descrição e valor, **Create invoice**.
   Na lista, clique em **Payment page**.
9. Na página de pagamento: **Simulate the client paying**. Em poucos segundos vira **Paid**.
   De volta ao painel, o pagamento já aparece classificado como serviço.
10. **Reports**: **Download CSV**, **Summary PDF** e, marcando recebimentos na lista,
    **Proof of origin PDF**.
11. **Cash out**: digite um valor e uma chave Pix, **Get quote**, **Simulate payout**.
    É simulado: nenhum token se move.

Para recomeçar do zero, clique em **Reset demo data** na faixa preta do topo.

## 4. Modo live: Solana devnet de verdade

Faça uma vez, na ordem. Leva uns 20 a 30 minutos.

### 4.1 Banco de dados (Supabase)

1. Crie uma conta e um projeto gratuito em https://supabase.com.
2. No painel do projeto, abra **SQL Editor**, cole todo o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Project Settings > API** (em projetos novos, **API Keys**), copie a **Project URL** e a
   chave **service_role** (pode aparecer como "secret key"). Essa chave dá acesso total ao
   banco: nunca a coloque no chat, em print ou no GitHub.

### 4.2 RPC da devnet

Crie uma chave gratuita em https://www.helius.dev. A URL de devnet fica assim:

```
https://devnet.helius-rpc.com/?api-key=SUA_CHAVE
```

Sem isso o app usa a RPC pública, que funciona para poucos recebimentos mas bloqueia rápido.

### 4.3 Arquivo `.env.local`

Abra `recebi/.env.local` e preencha:

```
NEXT_PUBLIC_RECEBI_MODE=live
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=SUA_CHAVE
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role
SESSION_SECRET=um_texto_aleatorio_longo
```

Para gerar o `SESSION_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

O `.env.local` nunca vai para o GitHub (está no `.gitignore`).

Com a URL e a chave da Supabase preenchidas, teste o banco antes de seguir:

```powershell
npm.cmd run check:supabase
```

Ele confere a conexão, se as 6 tabelas existem e cada operação que o app faz no banco, usando
linhas de teste que ele mesmo apaga no fim. Se algo estiver errado (chave pública no lugar da
`service_role`, `schema.sql` não executado), ele diz o quê.

### 4.4 Dados de demonstração na devnet

```powershell
npm.cmd run seed:demo
```

O script cria as carteiras `ana`, `ana-savings`, `client-acme` e `bounty-platform` na pasta
`.demo-keys/`, cria um token de teste e envia 4 pagamentos para a `ana`.

- **Se o airdrop falhar** (acontece muito), o script imprime um endereço. Abra
  https://faucet.solana.com, cole o endereço, peça 1 SOL na devnet e rode o comando de novo.
- No final ele imprime uma linha `NEXT_PUBLIC_STABLE_MINTS='...'`. **Copie essa linha para o
  `.env.local`**, substituindo a que já existe. Sem isso o app não enxerga o token de teste.

### 4.5 Teste rápido, sem navegador

```powershell
npm.cmd run check:live
```

Ele lê a PTAX real, importa os pagamentos da `ana`, sela um comprovante e paga uma invoice na
devnet, e confere tudo. Se terminar com `All live checks passed`, a parte de Solana está
funcionando. Ele usa um banco em memória: não toca na sua Supabase.

As transações dele são reais na devnet, mas não sujam a demo: o selo é só um memo, e a invoice
de teste é paga para uma carteira descartável, não para a `ana`.

Para o teste mais completo, com o site rodando em modo live em outro terminal
(`npm.cmd run dev:live`):

```powershell
npm.cmd run e2e:live
```

Ele usa o app de verdade pela API: entra como a `ana`, importa e classifica os pagamentos dela
na Supabase, depois cria uma invoice, paga e sela na devnet e verifica. No fim apaga tudo que
gravou na Supabase, para a demo começar com o painel vazio. Se a `ana` já tiver dados no banco,
ele pula essa parte para não apagar trabalho de vocês.

Se os dados de demonstração ficarem bagunçados, `npm.cmd run seed:demo -- --new-ana` cria uma
carteira `ana` nova com os 4 pagamentos limpos (a chave antiga fica guardada em `.demo-keys/`).
Depois disso é preciso importar a chave nova na Phantom.

### 4.6 Phantom

1. Instale a Phantom no navegador (https://phantom.com).
2. Em **Settings > Developer Settings**, ligue **Testnet Mode** e escolha **Solana Devnet**.
3. Mostre as chaves de demonstração:

   ```powershell
   npm.cmd run seed:demo -- --show-key
   ```

4. Na Phantom: **Add / Connect Wallet > Import Private Key** e cole a chave da `ana`.
5. Para pagar invoices como cliente, importe a `client-acme` em **outro perfil do navegador**
   (ou em outro navegador).

São chaves só de devnet. Nunca mande dinheiro de verdade para elas.

### 4.7 Rodar

```powershell
npm.cmd run dev:live
```

Abra http://localhost:3000, **Connect wallet**, escolha a Phantom, **Sign in** (a Phantom pede
para assinar uma mensagem; é grátis e não é uma transação) e siga o mesmo roteiro da seção 3.
As diferenças no modo live:

- **Seal onchain** abre a Phantom para aprovar uma transação de memo.
- Os links de transação abrem o Solana Explorer na devnet. Mostre o memo `recebi:v1:...` lá.
- Na página de pagamento, o cliente paga com **Pay with browser wallet** (no perfil com a
  `client-acme`) ou escaneando o QR com a Phantom do celular. No celular, a Phantom também
  precisa estar em Testnet Mode com Solana Devnet e com a chave da `client-acme` importada.
- Abra a página `/verify/...` em uma **janela anônima** para mostrar que ela funciona sem login.

## 5. Trocar de modo

- `npm.cmd run dev:mock` e `npm.cmd run dev:live` escolhem o modo na hora, ignorando o arquivo.
- `npm.cmd run dev` usa o que estiver em `NEXT_PUBLIC_RECEBI_MODE` no `.env.local`.
- Sempre que mudar o `.env.local`, **pare o servidor (`Ctrl + C`) e rode de novo**.

## 6. Comandos

| Comando | O que faz |
|---|---|
| `npm.cmd run dev:mock` | Sobe o site no modo mock |
| `npm.cmd run dev:live` | Sobe o site no modo live |
| `npm.cmd test` | Roda os testes automáticos |
| `npm.cmd run smoke:mock` | Testa todas as rotas da API. Precisa do site rodando em modo mock em outro terminal, e **zera os dados de demonstração** |
| `npm.cmd run check:supabase` | Testa o banco Supabase de verdade (conexão, tabelas e todas as operações) |
| `npm.cmd run smoke:live` | Testa o app em modo live pela API, com uma carteira descartável. Precisa do site rodando com `dev:live` em outro terminal; apaga o que criou |
| `npm.cmd run seed:demo` | Prepara carteiras, token e pagamentos na devnet |
| `npm.cmd run check:live` | Testa a parte de Solana e PTAX do modo live, sem navegador e sem banco |
| `npm.cmd run e2e:live` | Teste completo do modo live pela API: Supabase, PTAX e devnet. Precisa do site rodando com `dev:live` em outro terminal |
| `npm.cmd run build` | Gera o build de produção (o mesmo que a Vercel roda) |
| `npm.cmd run lint` e `npm.cmd run typecheck` | Conferem estilo e tipos |

## 7. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| O site não abre | O servidor não está rodando. Rode `npm.cmd run dev:mock` e deixe o terminal aberto. Confira a porta que o terminal mostra |
| `running scripts is disabled on this system` | Você usou `npm`. Use `npm.cmd` |
| `Could not read package.json` | Você está na pasta errada. Entre em `recebi` (seção 2) |
| Cliquei no botão logo que a página abriu e nada aconteceu | A página ainda estava carregando. Espere um segundo e clique de novo |
| `Supabase is not configured` | Modo live sem `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY`. Preencha, ou use o modo mock |
| `SESSION_SECRET is missing` | Modo live sem `SESSION_SECRET` de 32 caracteres ou mais (seção 4.3) |
| `RPC is not devnet` no cartão da carteira | `NEXT_PUBLIC_RPC_URL` aponta para outra rede. Use uma URL de devnet |
| `The Solana RPC keeps rate-limiting us` ou erro 429 | Limite da RPC pública. Configure a chave da Helius (seção 4.2) |
| "Import from wallet" não acha nada no modo live | Faltou copiar a linha `NEXT_PUBLIC_STABLE_MINTS` do `seed:demo`, ou a Phantom está com outra carteira |
| A Phantom não mostra os tokens ou a transação falha | A Phantom não está em Testnet Mode com Solana Devnet |
| O airdrop do `seed:demo` falhou | Use https://faucet.solana.com com o endereço que o script mostrou e rode de novo |
| `No BRL value yet` | A cotação não pôde ser lida. Abra o recebimento e clique em **Refresh rate** |
| **Seal onchain** está desabilitado | Classifique o pagamento e clique em **Save** antes |
| Mudei o `.env.local` e nada mudou | Reinicie o servidor |
| O CSV abre em uma coluna só no Excel | O Excel em português espera ponto e vírgula. Use **Dados > De Texto/CSV**, ou abra no Google Planilhas |

## 8. O que já foi testado e o que não foi

Situação em 11/10/2026.

Testado:

- os 71 testes automáticos;
- o fluxo inteiro do modo mock em um navegador de verdade, em desenvolvimento e no build de
  produção;
- a PTAX real do Banco Central e a importação de uma carteira real da devnet;
- **o banco Supabase de verdade** (`check:supabase`, 21 checagens);
- **o `seed:demo`** na devnet: carteiras, token de teste e os 4 pagamentos para a `ana`;
- **selo e pagamento reais na devnet** (`check:live`): importação, selo, verificação com todas
  as checagens verdes, adulteração dando Mismatch, invoice detectada pela chave de referência;
- **o app inteiro em modo live pela API** (`e2e:live`, 21 checagens): Supabase, PTAX e devnet
  juntos, do login por assinatura ao PDF de proof of origin.

**Ainda não testado:** a Phantom. Todos os testes acima assinam com as chaves de demonstração
direto do script; ninguém ainda clicou em "Seal onchain" ou "Pay with browser wallet" com a
extensão. É o que falta conferir à mão antes de gravar.

Se algo falhar no modo live com a Phantom, rode `npm.cmd run e2e:live`. Se ele passar, banco,
Solana e PTAX estão certos e o problema está na carteira (rede errada, conta errada, sem SOL).

## 9. Publicar na Vercel (ainda não feito)

1. Em https://vercel.com, **Add New > Project** e importe o repositório do GitHub.
2. Em **Environment Variables**, coloque as mesmas variáveis do `.env.local` do modo live, com
   duas diferenças: `NEXT_PUBLIC_APP_URL` com o endereço do site publicado, e
   `NEXT_PUBLIC_STABLE_MINTS` **sem** as aspas simples em volta.
3. **Deploy**. Depois, abra o site e repita o roteiro da seção 3.

Use o modo live na Vercel. O modo mock guarda os dados em arquivo local e não funciona lá.
