# pi-votacao-zk-backend

Backend stateless para o sistema de votação eletrônica com **ZK-SNARKs** e **blockchain Ethereum**.

Desenvolvido com [FastAPI](https://fastapi.tiangolo.com/) e [Web3.py](https://web3py.readthedocs.io/), o serviço atua como facilitador entre o frontend e o smart contract `VotingContract` implantado na rede Sepolia (ou qualquer rede EVM compatível).

---

## Características

- **Stateless** — não usa banco de dados; todos os dados críticos ficam na blockchain.
- **Leitura** de dados via chamadas `call()` ao contrato (sem custo de gas).
- **Escrita** (transações) assinadas com a chave privada do administrador.
- **ZK-SNARKs** — repassa provas `castVote()` ao contrato sem validar a prova localmente.
- **Swagger UI** disponível em `/docs` automaticamente.

---

## Pré-requisitos

- Python 3.12+
- Conta Infura / Alchemy com acesso à rede Sepolia (ou outro nó EVM)
- `VotingContract` implantado e ABI copiada para `app/abi/VotingContract.json`

---

## Instalação e configuração

### 1. Clone o repositório

```bash
git clone https://github.com/CompSci-Squad/pi-votacao-zk-backend.git
cd pi-votacao-zk-backend
```

### 2. Crie e ative um ambiente virtual

```bash
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# ou
.venv\Scripts\activate     # Windows
```

### 3. Instale as dependências

```bash
pip install -r requirements.txt
```

### 4. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e preencha:

| Variável             | Descrição                                                                |
|----------------------|--------------------------------------------------------------------------|
| `RPC_URL`            | URL do nó RPC (ex.: `https://sepolia.infura.io/v3/<key>`)               |
| `CONTRACT_ADDRESS`   | Endereço do `VotingContract` implantado                                  |
| `ADMIN_PRIVATE_KEY`  | Chave privada do administrador (para assinar transações)                 |
| `CORS_ORIGINS`       | Origens CORS permitidas, separadas por vírgula (ex.: `http://localhost:3000`) |

> ⚠️ **Nunca commite a chave privada real.** Use um gerenciador de segredos em produção.

### 5. Copie o ABI do contrato

Após implantar o `VotingContract`, copie o ABI gerado pelo compilador para:

```
app/abi/VotingContract.json
```

---

## Como rodar localmente

```bash
uvicorn app.main:app --reload
```

A API estará disponível em `http://localhost:8000`.

### Com Docker

```bash
docker build -t votacao-zk-backend .
docker run -p 8000:8000 --env-file .env votacao-zk-backend
```

---

## Documentação da API

Acesse a documentação interativa em:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

### Endpoints disponíveis

| Método | Rota                                          | Descrição                                      |
|--------|-----------------------------------------------|------------------------------------------------|
| POST   | `/api/elections`                              | Criar eleição                                  |
| GET    | `/api/elections/{id}`                         | Consultar eleição                              |
| POST   | `/api/elections/{id}/candidates`              | Adicionar candidato                            |
| GET    | `/api/elections/{id}/candidates`              | Listar candidatos                              |
| GET    | `/api/elections/{id}/candidates/{number}`     | Preview candidato por número (teclado numérico)|
| POST   | `/api/elections/{id}/voters`                  | Registrar hashes de eleitores (Poseidon)       |
| POST   | `/api/elections/{id}/voters/merkle-root`      | Gravar Merkle root no contrato                 |
| GET    | `/api/elections/{id}/voters/hashes`           | Retornar hashes para geração de provas ZK      |
| POST   | `/api/elections/{id}/open`                    | Abrir eleição                                  |
| POST   | `/api/elections/{id}/vote`                    | Enviar voto (proof + publicSignals)            |
| POST   | `/api/elections/{id}/close`                   | Encerrar eleição                               |
| GET    | `/api/elections/{id}/results`                 | Consultar resultados                           |
| GET    | `/health`                                     | Health check                                   |

---

## Conectando à Sepolia

1. Crie uma conta no [Infura](https://infura.io/) ou [Alchemy](https://www.alchemy.com/).
2. Crie um projeto e copie a URL do endpoint Sepolia.
3. Defina `RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID` no `.env`.
4. Certifique-se de que a conta do administrador tem ETH de teste (use um [faucet](https://sepoliafaucet.com/)).
5. Implante o `VotingContract` e atualize `CONTRACT_ADDRESS` no `.env`.

---

## Estrutura do projeto

```
app/
├── __init__.py
├── main.py               # FastAPI app, CORS, rotas
├── config.py             # Settings via pydantic-settings
├── routers/
│   ├── elections.py      # CRUD eleição + candidatos + ciclo de vida
│   ├── voters.py         # Cadastro de hashes e Merkle root
│   ├── votes.py          # Receber e encaminhar votos ZK
│   └── results.py        # Consultar resultados
├── services/
│   ├── blockchain.py     # Web3.py wrapper (conexão, assinar, enviar)
│   └── contract.py       # Funções de alto nível do VotingContract
├── schemas/
│   └── models.py         # Pydantic models (request/response)
└── abi/
    └── VotingContract.json  # ABI do contrato (copiar do repo blockchain)
```

---

## Licença

MIT