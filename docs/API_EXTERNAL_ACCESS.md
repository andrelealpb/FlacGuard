# HappyDo Pulse — Acesso à API para Aplicações Externas

Documentação de integração para aplicações externas que consomem a API do HappyDo Pulse.

---

## 1. URL Base da API

| Ambiente       | URL                                                  |
|----------------|------------------------------------------------------|
| **Produção**   | `https://happydopulse-production.up.railway.app/api` |
| **Desenvolvimento** | `http://localhost:3001/api`                     |

Todas as requisições devem usar HTTPS em produção.

---

## 2. Autenticação

A API utiliza **JWT (JSON Web Token)**. O fluxo de autenticação funciona em dois passos:

### 2.1 Obter o token de acesso

```
POST /api/auth/login
Content-Type: application/json
```

**Body:**

```json
{
  "email": "seu-usuario@empresa.com",
  "password": "sua-senha"
}
```

**Resposta (200):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "seu-usuario@empresa.com",
      "fullName": "NOME DO USUÁRIO",
      "role": "SUPERVISOR",
      "active": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### 2.2 Usar o token nas requisições

Inclua o `accessToken` no header `Authorization` de todas as requisições:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 2.3 Validade dos tokens

| Token            | Validade |
|------------------|----------|
| **Access Token** | 1 hora   |
| **Refresh Token**| 7 dias   |

### 2.4 Renovar o token (refresh)

Quando o access token expirar, use o refresh token para obter um novo par de tokens:

```
POST /api/auth/refresh
Content-Type: application/json
```

**Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Resposta (200):**

```json
{
  "success": true,
  "data": {
    "accessToken": "novo-access-token...",
    "refreshToken": "novo-refresh-token..."
  }
}
```

### 2.5 Erros de autenticação

| Status | Código             | Significado                     |
|--------|--------------------|---------------------------------|
| `401`  | `UNAUTHORIZED`     | Token ausente, inválido ou expirado |
| `401`  | `INVALID_CREDENTIALS` | Email ou senha incorretos    |
| `403`  | `FORBIDDEN`        | Usuário não tem permissão para o recurso |

---

## 3. Endpoint — Listar PDVs (Lojas)

```
GET /api/stores
```

### 3.1 Query Parameters (todos opcionais)

| Parâmetro              | Tipo     | Default | Descrição                                         |
|------------------------|----------|---------|---------------------------------------------------|
| `page`                 | number   | `1`     | Página da listagem                                |
| `limit`                | number   | `20`    | Quantidade de registros por página                |
| `active`               | string   | —       | Filtrar por status ativo (`true` / `false`)       |
| `pulseEnabled`         | string   | —       | Filtrar por Pulse habilitado (`true` / `false`)   |
| `bandeira`             | string   | —       | Filtrar por bandeira (busca parcial, case-insensitive) |
| `cidade`               | string   | —       | Filtrar por cidade (busca parcial, case-insensitive)   |
| `estado`               | string   | —       | Filtrar por UF (ex: `PB`, `SP`)                   |
| `search`               | string   | —       | Busca por código, nome ou CNPJ                    |
| `preferredRepositorId` | string   | —       | Filtrar por repositor preferido (UUID ou `null`)  |
| `excludeActiveRoutes`  | string   | —       | Excluir lojas com rotas ativas (`true`)           |

### 3.2 Exemplo de requisição

```bash
curl -X GET "https://happydopulse-production.up.railway.app/api/stores?page=1&limit=10&active=true&estado=PB" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

### 3.3 Resposta (200)

```json
{
  "success": true,
  "data": {
    "stores": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "code": "0001",
        "name": "MATRIZ - ESTOQUE CENTRAL",
        "cnpj": "21.119.442/0001-21",
        "address": "AVENIDA MIGUEL SANTA CRUZ, 191",
        "bairro": "TORRE",
        "cidade": "JOÃO PESSOA",
        "estado": "PB",
        "cep": "58040-290",
        "bandeira": "PBVEND MÁQUINAS AUTOMÁTICAS",
        "regiao": "PADRÃO",
        "telefone": "--",
        "contatoNome": null,
        "contatoCelular": null,
        "contatoEmail": null,
        "active": true,
        "dataAbertura": "2025-01-01T00:00:00.000Z",
        "dataEncerramento": null,
        "latitude": "-7.11950000",
        "longitude": "-34.84500000",
        "classification": "C",
        "priorityLevel": "HIGH",
        "priorityScore": "45.50",
        "supplyPercentage": "75.00",
        "lastRestockAt": "2025-11-08T10:30:00.000Z",
        "preferredRepositorId": null,
        "createdAt": "2025-11-08T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 79,
      "pages": 8
    }
  }
}
```

### 3.4 Campos retornados

| Campo                 | Tipo        | Descrição                                      |
|-----------------------|-------------|------------------------------------------------|
| `id`                  | `string`    | UUID do PDV                                    |
| `code`                | `string`    | Código identificador da loja                   |
| `name`                | `string`    | Nome da loja                                   |
| `cnpj`                | `string`    | CNPJ formatado                                 |
| `address`             | `string`    | Endereço                                       |
| `bairro`              | `string`    | Bairro                                         |
| `cidade`              | `string`    | Cidade                                         |
| `estado`              | `string`    | UF (sigla do estado)                           |
| `cep`                 | `string`    | CEP                                            |
| `bandeira`            | `string`    | Bandeira/rede da loja                          |
| `regiao`              | `string`    | Região operacional                             |
| `telefone`            | `string`    | Telefone de contato                            |
| `contatoNome`         | `string?`   | Nome do contato na loja                        |
| `contatoCelular`      | `string?`   | Celular do contato                             |
| `contatoEmail`        | `string?`   | Email do contato                               |
| `active`              | `boolean`   | Se a loja está ativa                           |
| `dataAbertura`        | `datetime`  | Data de abertura (ISO 8601)                    |
| `dataEncerramento`    | `datetime?` | Data de encerramento, se houver                |
| `latitude`            | `string`    | Latitude (decimal)                             |
| `longitude`           | `string`    | Longitude (decimal)                            |
| `classification`      | `string`    | Classificação da loja (`AA`, `A`, `B`, `C`)    |
| `priorityLevel`       | `string`    | Nível de prioridade (`HIGH`, `MEDIUM`, `LOW`)  |
| `priorityScore`       | `string`    | Score de prioridade (decimal)                  |
| `supplyPercentage`    | `string`    | Percentual de abastecimento (decimal)          |
| `lastRestockAt`       | `datetime?` | Data do último reabastecimento (ISO 8601)      |
| `preferredRepositorId`| `string?`   | UUID do repositor preferido                    |
| `createdAt`           | `datetime`  | Data de criação do registro (ISO 8601)         |

### 3.5 Endpoints auxiliares

| Método | Endpoint                   | Descrição                         |
|--------|----------------------------|-----------------------------------|
| `GET`  | `/api/stores/:id`          | Buscar loja por UUID              |
| `GET`  | `/api/stores/code/:code`   | Buscar loja pelo código (ex: `0001`) |
| `GET`  | `/api/stores/stats/summary`| Estatísticas gerais das lojas     |

---

## 4. Padrão de Resposta da API

Todas as respostas seguem o mesmo formato:

**Sucesso:**

```json
{
  "success": true,
  "data": { ... }
}
```

**Erro:**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Descrição do erro"
  }
}
```

---

## 5. Rate Limiting

| Rota              | Limite                    |
|-------------------|---------------------------|
| `POST /auth/login`    | 5 requisições por minuto  |
| `POST /auth/register` | 3 requisições por hora    |
| Demais rotas           | 100 requisições por 15 min |

Quando o limite é atingido, a API retorna status `429 Too Many Requests`.

---

## 6. Exemplo Completo de Integração

```javascript
// 1. Autenticar e obter token
const loginResponse = await fetch(
  'https://happydopulse-production.up.railway.app/api/auth/login',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'app-externo@empresa.com',
      password: 'senha-segura',
    }),
  }
);

const { data: authData } = await loginResponse.json();
const token = authData.accessToken;

// 2. Listar lojas ativas
const storesResponse = await fetch(
  'https://happydopulse-production.up.railway.app/api/stores?active=true&limit=50',
  {
    headers: { Authorization: `Bearer ${token}` },
  }
);

const { data } = await storesResponse.json();
console.log(`Total de lojas: ${data.pagination.total}`);
console.log('Lojas:', data.stores);

// 3. Buscar loja específica por código
const storeResponse = await fetch(
  'https://happydopulse-production.up.railway.app/api/stores/code/0001',
  {
    headers: { Authorization: `Bearer ${token}` },
  }
);

const { data: store } = await storeResponse.json();
console.log('Loja:', store);
```

---

## 7. Recomendações para o App Externo

1. **Cache do token**: Armazene o `accessToken` e reutilize até expirar (1h). Não faça login a cada requisição.
2. **Refresh automático**: Implemente renovação automática do token usando o `refreshToken` quando receber `401`.
3. **Paginação**: Use `page` e `limit` para iterar sobre grandes volumes de dados. O máximo recomendado por página é `100`.
4. **Filtros**: Use os query parameters para reduzir o volume de dados transferidos.
5. **CORS**: Se a aplicação externa for um frontend web, a URL de origem precisa ser adicionada à configuração de CORS do Pulse.
