# Deploy no Raspberry Pi

## 1. Copiar backend pro Pi

Do PC do Renan, dentro da pasta `controle-contas-morango`:

```powershell
$PI = "irrigacao@10.0.1.14"

# cria pasta destino
ssh $PI "sudo mkdir -p /opt/controle-contas && sudo chown irrigacao:irrigacao /opt/controle-contas"

# copia backend + db + uploads populados (se ja rodou migração local)
scp -r backend $PI:/opt/controle-contas/
```

## 2. Instalar deps + primeira execução manual

```bash
ssh irrigacao@10.0.1.14
cd /opt/controle-contas/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -c "from db import init_db; init_db()"
# testa a mao antes do systemd
uvicorn main:app --host 0.0.0.0 --port 8001 &
curl http://localhost:8001/api/health
kill %1
deactivate
```

## 3. Systemd

```bash
sudo cp /opt/controle-contas/backend/../deploy/controle-contas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now controle-contas.service
sudo systemctl status controle-contas.service
```

## 4. Expor via Tailscale Funnel porta 10000

```bash
# se ja existe funnel na 10000 pra outra coisa, desmonta
sudo tailscale funnel --https=10000 http://localhost:8001
sudo tailscale funnel status
```

URL publica sera: `https://raspberrypi.taileb9ced.ts.net:10000`

## 5. Atualizar frontend config

Editar `frontend/config.js`:
```js
window.APP_CONFIG = { API_URL: "https://raspberrypi.taileb9ced.ts.net:10000" };
```

Deploy frontend:
```powershell
cd controle-contas-morango
git add . && git commit -m "aponta pro Pi"
git push
git subtree push --prefix frontend origin gh-pages
```
