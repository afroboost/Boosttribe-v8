# LiveKit SFU auto-hébergé (Hetzner + Coolify)

Serveur LiveKit auto-hébergé pour BoostTribe — `wss://livekit.boosttribe.pro` — en remplacement
de LiveKit Cloud. **Déployé et vérifié OK** (logs propres, handshake réel 101, end-to-end backend).

---

## ✅ Méthode réellement déployée (service Coolify `livekit`)

Le service Coolify (type docker-compose, image `livekit/livekit-server:latest`) utilise un
**entrypoint qui écrit la config dans un fichier puis exec le binaire** — méthode fiable qui
évite le mangling de variables Coolify et l'erreur `livekit-server: not found` :

```yaml
entrypoint:
  - /bin/sh
  - -c
  - 'printf ''port: 7880\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  use_external_ip: true\nkeys:\n  APIboosttribe: %s\n'' "${LK_SECRET}" > /etc/lk.yaml && exec /livekit-server --config /etc/lk.yaml'
environment:
  LK_SECRET: '${LK_SECRET}'   # variable Coolify SIMPLE (64 hex) — pas de ':' ni d'accolades
ports:
  - '7881:7881'        # RTC/TCP
  - '7882:7882/udp'    # RTC/UDP (port mux unique)
```

- Le secret est une variable Coolify **`LK_SECRET`** (64 hex, hors-git). `${LK_SECRET}` est
  interpolé par Coolify au déploiement → écrit dans `/etc/lk.yaml`. Clé = `APIboosttribe`.
- 7880 (signaling) n'est pas publié : proxifié en TLS par Traefik (domaine Coolify
  `https://livekit.boosttribe.pro:7880`, certrésolveur Let's Encrypt).

### ⚠️ Le bug qui faisait boucler / "secret is too short"

Le `.env` du service contenait **en plus** une variable parasite :

```
LIVEKIT_CONFIG='{port: 7880, rtc: {...}, keys: {APIboosttribe: REMPLACERMOI}}'
```

`livekit-server` lit `LIVEKIT_CONFIG` (env) **en priorité sur `--config`**, donc le secret
effectif devenait `REMPLACERMOI` (11 car.) → `secret is too short` et tokens rejetés.

**Correctif (durable) : supprimer la variable `LIVEKIT_CONFIG`** du service livekit.
- Côté UI : Service `livekit` → Environment Variables → supprimer `LIVEKIT_CONFIG`.
- Fait ici directement dans la base Coolify (source de vérité) : suppression de la ligne
  `environment_variables` (key=`LIVEKIT_CONFIG`, `App\Models\Service` id 2), + retrait de la
  ligne du `.env` rendu, puis `docker compose up -d --force-recreate` dans
  `/data/coolify/services/o7itj8knw8zg2mo2jirp55uy/`.

Après ça, `/etc/lk.yaml` (vrai `LK_SECRET`) redevient autoritaire → logs propres.

### Vérifications effectuées (preuves)

```
# Logs (docker logs livekit-o7itj8knw8zg2mo2jirp55uy) :
INFO  livekit  using single-node routing
INFO  livekit  found external IP via STUN  externalIP=178.105.201.62
INFO  livekit  starting LiveKit server  version=1.13.2 portHttp=7880 rtc.portTCP=7881 rtc.portUDP=7882
# (plus aucune ligne "secret is too short" ni "livekit-server: not found")

# Auth + TLS de bout en bout :
curl https://livekit.boosttribe.pro/rtc/validate?access_token=<jwt APIboosttribe/LK_SECRET>  -> "success" HTTP 200

# Handshake WebSocket réel :
curl --http1.1 -H 'Upgrade: websocket' ... https://livekit.boosttribe.pro/rtc?access_token=<jwt>
  -> HTTP/1.1 101 Switching Protocols + message de signaling (join response)

# End-to-end via le backend :
POST https://<backend>/livekit/token {role:viewer} -> {url:"wss://livekit.boosttribe.pro", token:...}
  puis /rtc/validate de ce token -> "success" HTTP 200
```

---

## Bascule du backend (app Coolify `bnzkkhur7dn8utsk9qyz15gy`)

Variables (durable en base Coolify + appliquées au container) :

```
LIVEKIT_URL=wss://livekit.boosttribe.pro     # le SDK serveur accepte wss:// pour le RoomService (count/promote/demote)
LIVEKIT_API_KEY=APIboosttribe
LIVEKIT_API_SECRET=<LK_SECRET 64 hex>
```

Appliqué via : update des lignes `environment_variables` (App id 5, chiffrées avec la `Crypt`
Laravel de Coolify) + `docker compose up -d --force-recreate` dans
`/data/coolify/applications/bnzkkhur7dn8utsk9qyz15gy/`.

## 🔙 Rollback LiveKit Cloud (~2 min)

Remettre dans le backend (UI Coolify ou base) puis redéployer :

```
LIVEKIT_URL=wss://boosttribe-pcdutwzc.livekit.cloud
LIVEKIT_API_KEY=APIVt3b9yBoeTRS
LIVEKIT_API_SECRET=0UiwdAt5wI7fuBLAQlXZHnTwEnZek8aFPP419vAti4p
```

Sauvegardes `.env` créées sur le serveur (pour restauration rapide) :
- `/data/coolify/services/o7itj8knw8zg2mo2jirp55uy/.env.bak.*`
- `/data/coolify/applications/bnzkkhur7dn8utsk9qyz15gy/.env.bak.*`

## Pare-feu / ports

- `ufw` : **inactif** sur l'hôte, pas de firewall Hetzner Cloud → rien à ouvrir.
- Si ufw est activé un jour : `ufw allow 7881/tcp && ufw allow 7882/udp`.

## (Optionnel) TURN si le média ne passe pas en 4G

Un `coturn` tourne déjà sur l'hôte. Sinon, activer le TURN intégré LiveKit dans la config :

```yaml
turn:
  enabled: true
  domain: livekit.boosttribe.pro
  tls_port: 5349
```
puis ouvrir 5349/tcp (proxy + `ufw allow 5349/tcp` si actif).

---

## Annexe — alternative autonome (hors Coolify)

`docker-compose.yml` + `livekit.yaml.example` de ce dossier décrivent une variante **standalone**
(config montée depuis un fichier hôte `/etc/livekit/livekit.yaml`, passée via `--config`), utile
pour un déploiement sans Coolify. La prod utilise la méthode Coolify ci-dessus.
