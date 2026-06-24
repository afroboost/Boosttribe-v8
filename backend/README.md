# BoostTribe — Service Stripe (FastAPI)

Service de paiement déployé sur `https://pay.boosttribe.pro`.
Crée automatiquement les prix Stripe depuis la console admin, gère le checkout d'abonnement
et applique les changements via webhook. **Aucune clé en dur** : tout via variables d'environnement.

## Lancement

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Déploiement Nixpacks (Coolify) : `nixpacks.toml` ou `Procfile` lancent la commande ci-dessus.

## Variables d'environnement

| Variable | Exemple | Rôle |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Secret de signature du webhook |
| `SUPABASE_URL` | `https://api.boosttribe.pro` | URL Supabase auto-hébergé |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Service role (écritures REST, contourne la RLS) |
| `FRONTEND_URL` | `https://boosttribe.pro` | Base des URLs success/cancel |
| `ADMIN_EMAILS` | `contact.artboost@gmail.com` | Emails autorisés à `sync-plan` (séparés par virgule) |

## Endpoints

- `GET  /health` → `{ "ok": true }`
- `POST /stripe/sync-plan` (admin, Bearer token Supabase) → crée/maj les Stripe Price, archive les anciens.
- `POST /stripe/create-checkout` (user, Bearer token Supabase) → `{ url }` vers Stripe Checkout.
- `POST /stripe/webhook` (Stripe) → met à jour `profiles.subscription_status`.

Configurez le webhook Stripe vers `https://pay.boosttribe.pro/stripe/webhook` avec les événements :
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`.

## Colonnes DB attendues (à ajouter côté serveur — PAS de migration auto)

### Table `site_settings` (ligne `id = 1`)
Colonnes `text` (nullable) écrites par `/stripe/sync-plan` :

```
stripe_product_pro                  text
stripe_product_enterprise           text
stripe_pro_monthly_price_id         text
stripe_pro_annual_price_id          text
stripe_enterprise_monthly_price_id  text
stripe_enterprise_annual_price_id   text
```

SQL :
```sql
alter table site_settings
  add column if not exists stripe_product_pro                 text,
  add column if not exists stripe_product_enterprise          text,
  add column if not exists stripe_pro_monthly_price_id        text,
  add column if not exists stripe_pro_annual_price_id         text,
  add column if not exists stripe_enterprise_monthly_price_id text,
  add column if not exists stripe_enterprise_annual_price_id  text;
```

### Table `profiles`
Colonnes écrites par le webhook (`id` = user id Supabase) :

```
subscription_status   text   -- 'none' | 'trial' | 'pro' | 'enterprise' (+ legacy 'monthly'/'yearly')
stripe_customer_id     text
stripe_subscription_id text
```

SQL :
```sql
alter table profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;
-- subscription_status existe déjà ; valeurs 'pro'/'enterprise' débloquent isSubscribed côté front.
```

> Mapping prix → plan : le webhook retrouve le plan via le `price_id` de l'abonnement, comparé
> aux ids stockés dans `site_settings`, ou via `metadata.plan` (posé à la création du checkout).
