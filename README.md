# Livro-caixa Axis + UpDrive

Livro-caixa das lojas Axis e UpDrive: lançamentos de crédito e débito, semana a semana, gastos fixos e variáveis, gráficos, exportação e importação de Excel/CSV, e histórico de tudo o que foi feito.

Roda no **Cloudflare Pages**, com os dados no **Cloudflare D1** e acesso por **usuário e senha**.

> O código deste repositório pode ser público. **Senhas e dados não ficam aqui**: a senha fica guardada como segredo no Cloudflare e os lançamentos ficam no banco D1.

## Estrutura

```
public/index.html          a página (tela de login + livro-caixa)
public/_headers            proteções extras (não aparece no Google, não abre dentro de outros sites)
functions/api/[[path]].js  o servidor: confere o login e grava no banco
schema.sql                 as tabelas do banco (o servidor cria sozinho, este arquivo é só referência)
```

## Como colocar no ar (uma vez só)

### 1. Subir para o GitHub
1. Em github.com, clique em **New repository**, dê um nome (ex.: `livro-caixa-axis`) e crie.
2. Na página do repositório vazio, clique em **uploading an existing file**.
3. Arraste **o conteúdo desta pasta** (as pastas `public` e `functions`, e os arquivos `README.md`, `schema.sql`, `.gitignore`). A pasta `functions/api` precisa ir com o arquivo `[[path]].js` dentro, com esse nome exato.
4. Clique em **Commit changes**.

### 2. Criar o banco D1
1. No painel do Cloudflare: **Storage & Databases → D1 SQL Database → Create**.
2. Nome: `livro-caixa`. Crie. Não precisa criar tabela nenhuma: o site cria sozinho no primeiro acesso.

### 3. Criar o projeto no Cloudflare Pages ligado ao GitHub
1. **Workers & Pages → Create → Pages → Connect to Git** (ou "Import an existing Git repository").
2. Autorize o GitHub e escolha o repositório.
3. Configuração de build:
   - **Framework preset:** None
   - **Build command:** deixe vazio
   - **Build output directory:** `public`
4. Clique em **Save and Deploy**. O primeiro deploy vai abrir o site, mas ele ainda vai avisar que falta configurar. Isso é normal.

### 4. Ligar o banco ao projeto
1. No projeto: **Settings → Bindings → Add → D1 database**.
2. **Variable name:** `DB` (exatamente assim, em maiúsculas).
3. **D1 database:** `livro-caixa`. Salve.

### 5. Criar o usuário e a senha
1. No projeto: **Settings → Variables and Secrets → Add**. Escolha o tipo **Secret** para cada um:

| Nome | O que é | Obrigatório |
|---|---|---|
| `USUARIO` | usuário de quem lança e edita (ex.: `axis`) | sim |
| `SENHA` | senha desse usuário (use uma senha forte) | sim |
| `USUARIO_LEITURA` | usuário que só visualiza (ex.: `socios`) | não |
| `SENHA_LEITURA` | senha de quem só visualiza | não |
| `SEGREDO` | um texto longo e aleatório qualquer, para proteger as sessões | recomendado |

2. Depois de salvar, vá em **Deployments**, clique nos três pontinhos do último deploy e em **Retry deployment**. Bindings e segredos só valem depois de um novo deploy.

### 6. Primeiro acesso
1. Abra o endereço do projeto (`https://nome-do-projeto.pages.dev`).
2. Entre com `USUARIO` e `SENHA`. Na primeira entrada, o site cria a lista de gastos das lojas no banco.
3. Vá em **Histórico** e defina o **saldo inicial** do mês.

## Usando no dia a dia
- **Login:** cada pessoa entra com o usuário e a senha. A sessão dura 30 dias no mesmo navegador. O botão **Sair** fica no rodapé.
- **Todos veem os mesmos dados.** O que uma pessoa lança aparece na tela das outras em poucos segundos.
- **Quem entra com o usuário de leitura** vê tudo, exporta Excel, mas não consegue lançar, editar nem apagar. O servidor também bloqueia, não só a tela.
- **Segurança:** depois de 5 senhas erradas, aquele endereço de internet fica bloqueado por 15 minutos.
- **Trocar a senha:** mude o segredo `SENHA` no painel e faça **Retry deployment**. Todo mundo que estava logado precisa entrar de novo.
- **No campo "Seu nome"** (aba Histórico), cada pessoa pode colocar o próprio nome, para aparecer no histórico em vez do usuário.

## Atualizar o site
Quando receber uma versão nova do `index.html`, substitua o arquivo `public/index.html` no GitHub (abra o arquivo → ícone de lápis ou **Add file → Upload files**) e faça o commit. O Cloudflare publica sozinho em cerca de 1 minuto. **Os dados não mudam**, porque ficam no banco.

## Trazer dados da versão antiga (a do zip)
A versão antiga guardava tudo no navegador. Para trazer os lançamentos:
1. Na versão antiga: **Exportar e importar → Baixar Excel** de cada mês.
2. Na versão nova: **Exportar e importar → Importar lançamentos**, escolha o arquivo e confira a prévia.
O saldo inicial de cada mês e as mudanças feitas na lista de gastos precisam ser refeitos à mão.

## Limites do plano gratuito
Sobra para o uso de uma loja: o plano gratuito do Pages Functions permite 100 mil acessos ao servidor por dia, e o site consulta o servidor a cada 5 segundos só enquanto a aba está aberta e visível (cerca de 720 consultas por hora por pessoa).
