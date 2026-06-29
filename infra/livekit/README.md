# LiveKit SFU auto-hébergé (Hetzner + Coolify)

Serveur LiveKit auto-hébergé pour BoostTribe, accessible en `wss://livekit.boosttribe.pro`,
en remplacement de LiveKit Cloud.

## Méthode (fiable face au mangling de variables Coolify)

La config **complète, avec le secret**, vit dans un **fichier hôte hors-git** monté en lecture seule
et passé via `--config`. Aucune variable d'environnement pour le secret → Coolify ne peut rien déformer.
On n'override PAS l'entrypoint de l'image (`/livekit-server`), on lui ajoute seulement des args
→ plus d'erreur `livekit-server: not found`.

## 1) Préparer le fichier de config sur l'HÔTE (secret réel, hors-git)

```bash
mkdir -p /etc/livekit

# Générer un secret de 64 hex (ou réutiliser LK_SECRET déjà présent dans Coolify)
SECRET=$(openssl rand -hex 32)

cat > /etc/livekit/livekit.yaml <<EOF
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
keys:
  APIboosttribe: ${SECRET}
EOF

chmod 600 /etc/livekit/livekit.yaml
echo "SECRET = ${SECRET}"   # à reporter dans le backend (LIVEKIT_API_SECRET)
```

## 2) Pare-feu hôte (si ufw actif)

```bash
ufw status | head -1
# si "Status: active" :
ufw allow 7881/tcp
ufw allow 7882/udp
ufw reload
```

## 3) Déployer via Coolify

Service de type **docker-compose** pointant sur `infra/livekit/` de ce dépôt.

- **Domaine** du service : `https://livekit.boosttribe.pro:7880` (le `:7880` indique à Coolify le
  port interne à proxifier), **TLS activé** (Let's Encrypt).
- Coolify ajoute automatiquement les labels Traefik à partir de ce domaine.
- Déployer.

> Le port 7880 n'est PAS publié vers l'hôte (il passe par le proxy). Seuls 7881/tcp et 7882/udp
> sont publiés (voir docker-compose.yml).

## 4) Vérifier le démarrage (logs)

```bash
docker logs --tail=50 livekit
```

Attendu (PAS d'erreur "secret is too short" ni "livekit-server: not found") :

```
starting LiveKit server   version: x.y.z ...
using single-node routing
rtc tcp_port=7881 udp_port=7882 ...
```

## 5) Test réel (handshake)

```bash
# Depuis l'hôte : le signaling répond (HTTP 200 + "OK" sur la racine HTTP de LiveKit)
curl -sS http://127.0.0.1:7880/ | head -c 100 ; echo

# Public, en TLS via le proxy (doit renvoyer une réponse HTTP, pas une erreur TLS)
curl -sSI https://livekit.boosttribe.pro/ | head -5

# Token + connexion réelle : générer un token via le backend puis se connecter
#   (lk CLI : https://github.com/livekit/livekit-cli)
lk room join --url wss://livekit.boosttribe.pro --api-key APIboosttribe \
  --api-secret "<SECRET>" --identity test test-room
```

## 6) Basculer le backend sur l'auto-hébergé (Coolify, app bnzkkhur7dn8utsk9qyz15gy)

```
LIVEKIT_URL=wss://livekit.boosttribe.pro
LIVEKIT_API_KEY=APIboosttribe
LIVEKIT_API_SECRET=<le même secret>
```
Puis redéployer le backend.

## Rollback (retour LiveKit Cloud en ~2 min)

Remettre dans le backend les anciennes valeurs Cloud puis redéployer :

```
LIVEKIT_URL=wss://boosttribe-pcdutwzc.livekit.cloud
LIVEKIT_API_KEY=<clé Cloud>
LIVEKIT_API_SECRET=<secret Cloud>
```

## (Optionnel) TURN si le média ne passe pas en 4G

Ajouter dans `/etc/livekit/livekit.yaml` :

```yaml
turn:
  enabled: true
  domain: livekit.boosttribe.pro
  tls_port: 5349
  # cert_file / key_file si TLS géré par LiveKit, sinon terminaison TLS au proxy
```

Puis publier/ouvrir le port TURN (5349/tcp) côté hôte + Coolify, et `ufw allow 5349/tcp`.
