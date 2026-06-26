"""
BoostTribe — Service de paiement Stripe (FastAPI)

Endpoints :
  - GET  /health
  - POST /stripe/sync-plan       (admin) : crée/maj les Stripe Price depuis le CMS
  - POST /stripe/create-checkout (user)  : ouvre une session Checkout d'abonnement
  - POST /stripe/webhook                 : applique les changements d'abonnement aux profils

⚠️ Aucune clé en dur : tout vient des variables d'environnement.
Écritures DB via l'API REST Supabase avec la service role key (contourne la RLS).
"""

import os
import re
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import httpx
import stripe
from fastapi import FastAPI, Request, HTTPException, Header, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Bucket de stockage des médias de session (vidéos partagées par l'hôte)
SESSION_MEDIA_BUCKET = "session-media"
MEDIA_TTL_HOURS = 24

# Format autorisé d'un identifiant (session / user) — anti path traversal & injection
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")

# --------------------------------------------------------------------------- #
# Configuration (variables d'environnement)
# --------------------------------------------------------------------------- #
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://api.boosttribe.pro").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://boosttribe.pro").rstrip("/")
ADMIN_EMAILS = [
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "contact.artboost@gmail.com").split(",")
    if e.strip()
]

stripe.api_key = STRIPE_SECRET_KEY

# Chiffrement au repos de la clé secrète Stripe saisie par l'admin (Fernet).
# La clé APP_ENCRYPTION_KEY (base64 urlsafe 32 octets) vient de l'environnement, JAMAIS en dur.
APP_ENCRYPTION_KEY = os.environ.get("APP_ENCRYPTION_KEY", "")
_fernet = None
try:
    if APP_ENCRYPTION_KEY:
        from cryptography.fernet import Fernet, InvalidToken  # noqa: WPS433
        _fernet = Fernet(APP_ENCRYPTION_KEY.encode())
except Exception as _e:  # clé invalide → chiffrement désactivé (stockage refusé proprement)
    _fernet = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("boosttribe-pay")


def encrypt_secret(plaintext: str) -> str:
    if not _fernet:
        raise HTTPException(status_code=500, detail="APP_ENCRYPTION_KEY non configurée côté serveur")
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_secret(token: Optional[str]) -> Optional[str]:
    if not _fernet or not token:
        return None
    try:
        return _fernet.decrypt(token.encode()).decode()
    except Exception:
        return None

app = FastAPI(title="BoostTribe Pay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://boosttribe.pro", "https://www.boosttribe.pro"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Plans gérés -> libellé Stripe Product
PLANS = {"pro": "BoostTribe Pro", "enterprise": "BoostTribe Enterprise"}

# Clés site_settings : id de price par (plan, intervalle CMS)
#   intervalle CMS "monthly" -> Stripe interval "month"
#   intervalle CMS "annual"  -> Stripe interval "year"
PRICE_KEY = {
    ("pro", "monthly"): "stripe_pro_monthly_price_id",
    ("pro", "annual"): "stripe_pro_annual_price_id",
    ("enterprise", "monthly"): "stripe_enterprise_monthly_price_id",
    ("enterprise", "annual"): "stripe_enterprise_annual_price_id",
}


# --------------------------------------------------------------------------- #
# Helpers Supabase (REST, service role)
# --------------------------------------------------------------------------- #
def _service_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


async def get_user_from_token(authorization: Optional[str]) -> Dict[str, Any]:
    """Vérifie le token d'accès Supabase et renvoie l'utilisateur (id, email)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Token manquant")
    token = authorization.split(" ", 1)[1].strip()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Token invalide")
    return resp.json()


async def get_site_settings() -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/site_settings",
            headers=_service_headers(),
            params={"id": "eq.1", "select": "*"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return {}


async def update_site_settings(patch: Dict[str, Any]) -> None:
    if not patch:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/site_settings",
            headers=_service_headers({"Prefer": "return=representation"}),
            params={"id": "eq.1"},
            json=patch,
        )
    if resp.status_code not in (200, 204):
        logger.error("update_site_settings failed: %s %s", resp.status_code, resp.text)


async def update_profile(user_id: str, patch: Dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers({"Prefer": "return=representation"}),
            params={"id": f"eq.{user_id}"},
            json=patch,
        )
    if resp.status_code not in (200, 204):
        logger.error("update_profile failed: %s %s", resp.status_code, resp.text)


async def require_admin(authorization: Optional[str]) -> Dict[str, Any]:
    """Vérifie le token Supabase ET que l'email est admin (comme /stripe/sync-plan)."""
    user = await get_user_from_token(authorization)
    email = (user.get("email") or "").lower()
    if email not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Accès réservé à l'administrateur")
    return user


async def get_stripe_secret_record() -> Optional[str]:
    """Valeur CHIFFRÉE de la clé secrète Stripe (table stripe_secrets, service-role only)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/stripe_secrets",
            headers=_service_headers(),
            params={"id": "eq.stripe_secret_key", "select": "value_encrypted"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0].get("value_encrypted")
    return None


async def store_stripe_secret(encrypted: str) -> bool:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/stripe_secrets",
            headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            params={"on_conflict": "id"},
            json={
                "id": "stripe_secret_key",
                "value_encrypted": encrypted,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    return resp.status_code in (200, 201, 204)


async def get_stripe_secret_key() -> str:
    """Clé secrète Stripe effective : DB chiffrée (saisie admin) prioritaire, sinon repli env."""
    enc = await get_stripe_secret_record()
    if enc:
        dec = decrypt_secret(enc)
        if dec:
            return dec
    return STRIPE_SECRET_KEY


async def apply_stripe_key() -> str:
    """Positionne stripe.api_key avec la clé effective (DB chiffrée ou env) et la renvoie."""
    key = await get_stripe_secret_key()
    stripe.api_key = key
    return key


async def get_profile_by_email(email: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(),
            params={"email": f"eq.{email}", "select": "id,email"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None


# --------------------------------------------------------------------------- #
# Autorité de session (hôte / co-animateurs) — source de vérité côté serveur
# --------------------------------------------------------------------------- #
async def get_session_authz(session_id: str) -> Optional[Dict[str, Any]]:
    """Renvoie {host_id, cohosts} de la session depuis playlists, ou None."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/playlists",
            headers=_service_headers(),
            params={"session_id": f"eq.{session_id}", "select": "session_id,host_id,cohosts"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None


async def upsert_playlist_fields(session_id: str, patch: Dict[str, Any]) -> bool:
    """Upsert partiel sur playlists (clé session_id) sans écraser les autres colonnes."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/playlists",
            headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            params={"on_conflict": "session_id"},
            json={"session_id": session_id, **patch},
        )
    return resp.status_code in (200, 201, 204)


async def find_profile_by_subscription(subscription_id: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(),
            params={"stripe_subscription_id": f"eq.{subscription_id}", "select": "*"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None


# --------------------------------------------------------------------------- #
# Modèles
# --------------------------------------------------------------------------- #
class SyncPlanBody(BaseModel):
    plan: str  # "pro" | "enterprise"
    monthly_price: Optional[float] = None
    annual_price: Optional[float] = None
    currency: str = "eur"


class CheckoutBody(BaseModel):
    plan: str  # "pro" | "enterprise"
    interval: str  # "month" | "year"


class StripeKeysBody(BaseModel):
    public_key: Optional[str] = None   # pk_... (stockée en clair dans site_settings)
    secret_key: Optional[str] = None   # sk_... (chiffrée, table dédiée service-role)


@app.post("/admin/stripe-keys")
async def set_stripe_keys(body: StripeKeysBody, authorization: Optional[str] = Header(default=None)):
    """Admin : enregistre la clé publique (site_settings) et la clé secrète (chiffrée, table dédiée)."""
    await require_admin(authorization)
    if body.public_key is not None:
        await update_site_settings({"stripe_public_key": body.public_key.strip()})
    if body.secret_key:
        sk = body.secret_key.strip()
        if not sk.startswith("sk_"):
            raise HTTPException(status_code=400, detail="La clé secrète doit commencer par sk_")
        if not await store_stripe_secret(encrypt_secret(sk)):
            raise HTTPException(status_code=500, detail="Échec de l'enregistrement de la clé secrète")
    return {"ok": True}


@app.get("/admin/stripe-keys")
async def get_stripe_keys(reveal: bool = False, authorization: Optional[str] = Header(default=None)):
    """Admin : état des clés. ?reveal=true → renvoie la clé secrète déchiffrée (affichage admin only)."""
    await require_admin(authorization)
    settings = await get_site_settings()
    public_key = (settings or {}).get("stripe_public_key", "") or ""
    secret_plain = decrypt_secret(await get_stripe_secret_record())
    effective = secret_plain or STRIPE_SECRET_KEY
    out: Dict[str, Any] = {
        "public_key": public_key,
        "secret_configured": bool(effective),
        "secret_last4": effective[-4:] if effective else "",
        "secret_source": "db" if secret_plain else ("env" if STRIPE_SECRET_KEY else "none"),
    }
    if reveal and effective:
        out["secret_key"] = effective
    return out


class GrantAccessBody(BaseModel):
    email: Optional[str] = None
    user_id: Optional[str] = None
    plan: str  # "pro" | "enterprise"
    until: str  # date ISO (timestamptz)


class RevokeAccessBody(BaseModel):
    user_id: str


class ClaimHostBody(BaseModel):
    session_id: str


class CohostsBody(BaseModel):
    session_id: str
    cohosts: List[str] = []


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/stripe/sync-plan")
async def sync_plan(body: SyncPlanBody, authorization: Optional[str] = Header(default=None)):
    if not await apply_stripe_key():
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Plan inconnu")

    # Auth admin
    user = await get_user_from_token(authorization)
    email = (user.get("email") or "").lower()
    if email not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Accès réservé à l'administrateur")

    settings = await get_site_settings()
    patch: Dict[str, Any] = {}
    currency = (body.currency or "eur").lower()

    # 1) Assurer un Stripe Product pour le plan
    product_key = f"stripe_product_{body.plan}"
    product_id = settings.get(product_key)
    if not product_id:
        product = stripe.Product.create(name=PLANS[body.plan])
        product_id = product.id
        patch[product_key] = product_id

    # 2) Synchroniser chaque intervalle fourni
    def sync_interval(cms_interval: str, stripe_interval: str, price: Optional[float]):
        if price is None:
            return
        new_amount = round(float(price) * 100)
        key = PRICE_KEY[(body.plan, cms_interval)]
        old_id = settings.get(key)

        # Inchangé ? on garde l'ancien price
        if old_id:
            try:
                old = stripe.Price.retrieve(old_id)
                if old.unit_amount == new_amount and old.currency == currency and old.active:
                    return
            except Exception as exc:  # noqa: BLE001
                logger.warning("retrieve old price %s failed: %s", old_id, exc)

        new_price = stripe.Price.create(
            unit_amount=new_amount,
            currency=currency,
            recurring={"interval": stripe_interval},
            product=product_id,
        )
        patch[key] = new_price.id

        # Archiver l'ancien price
        if old_id and old_id != new_price.id:
            try:
                stripe.Price.modify(old_id, active=False)
            except Exception as exc:  # noqa: BLE001
                logger.warning("archive old price %s failed: %s", old_id, exc)

    sync_interval("monthly", "month", body.monthly_price)
    sync_interval("annual", "year", body.annual_price)

    await update_site_settings(patch)

    # Renvoyer l'état courant des ids de price pour ce plan
    merged = {**settings, **patch}
    price_ids = {
        key: merged.get(key)
        for (plan, _interval), key in PRICE_KEY.items()
        if plan == body.plan
    }
    return {"ok": True, "product_id": product_id, "price_ids": price_ids, "updated": patch}


@app.post("/stripe/create-checkout")
async def create_checkout(body: CheckoutBody, authorization: Optional[str] = Header(default=None)):
    if not await apply_stripe_key():
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Plan inconnu")
    if body.interval not in ("month", "year"):
        raise HTTPException(status_code=400, detail="Intervalle invalide")

    user = await get_user_from_token(authorization)
    user_id = user.get("id")
    email = user.get("email")

    cms_interval = "monthly" if body.interval == "month" else "annual"
    settings = await get_site_settings()
    price_id = settings.get(PRICE_KEY[(body.plan, cms_interval)])
    if not price_id:
        raise HTTPException(status_code=400, detail="Plan non configuré (price manquant)")

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/pricing?success=1",
        cancel_url=f"{FRONTEND_URL}/pricing?canceled=1",
        client_reference_id=user_id,
        customer_email=email,
        metadata={"user_id": user_id, "plan": body.plan},
        subscription_data={"metadata": {"user_id": user_id, "plan": body.plan}},
    )
    return {"url": session.url}


# --------------------------------------------------------------------------- #
# POINT 6 : accès offerts (admin)
# --------------------------------------------------------------------------- #
@app.post("/admin/grant-access")
async def grant_access(body: GrantAccessBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Plan invalide")

    user_id = body.user_id
    if not user_id:
        if not body.email:
            raise HTTPException(status_code=400, detail="email ou user_id requis")
        prof = await get_profile_by_email(body.email.strip().lower())
        if not prof:
            raise HTTPException(status_code=404, detail="Compte introuvable pour cet email")
        user_id = prof["id"]

    await update_profile(user_id, {"comp_access_plan": body.plan, "comp_access_until": body.until})
    return {"ok": True, "user_id": user_id, "plan": body.plan, "until": body.until}


@app.post("/admin/revoke-access")
async def revoke_access(body: RevokeAccessBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    await update_profile(body.user_id, {"comp_access_plan": None, "comp_access_until": None})
    return {"ok": True}


@app.get("/admin/granted")
async def list_granted(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    now_iso = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(),
            params={
                "comp_access_until": f"gt.{now_iso}",
                "select": "id,email,comp_access_plan,comp_access_until",
                "order": "comp_access_until.asc",
            },
        )
    rows = resp.json() if resp.status_code == 200 else []
    return {"granted": rows}


# --------------------------------------------------------------------------- #
# D : liste de TOUS les utilisateurs (admin)
# --------------------------------------------------------------------------- #
@app.get("/admin/users")
async def list_users(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(),
            params={
                "select": "id,email,full_name,avatar_url,subscription_status,comp_access_plan,comp_access_until,created_at",
                "order": "created_at.desc",
            },
        )
    rows = resp.json() if resp.status_code == 200 else []
    return {"users": rows}


# --------------------------------------------------------------------------- #
# E : upload vidéo de session (hôte) + nettoyage auto 24h
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# F : autorité hôte / co-animateurs (source de vérité serveur)
# --------------------------------------------------------------------------- #
@app.post("/session/claim-host")
async def claim_host(body: ClaimHostBody, authorization: Optional[str] = Header(default=None)):
    """L'hôte revendique sa session (premier arrivé = hôte). Idempotent pour le même hôte."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not body.session_id or not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")

    row = await get_session_authz(body.session_id)
    current = row.get("host_id") if row else None
    if current and current != uid:
        # Déjà revendiquée par un autre compte → on ne réécrit pas
        return {"ok": False, "host_id": current}
    if current != uid:
        await upsert_playlist_fields(body.session_id, {"host_id": uid})
    return {"ok": True, "host_id": uid}


@app.post("/session/cohosts")
async def set_cohosts(body: CohostsBody, authorization: Optional[str] = Header(default=None)):
    """Seul l'hôte (host_id) peut définir la liste des co-animateurs autorisés à partager."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not body.session_id or not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")

    row = await get_session_authz(body.session_id)
    if not row or row.get("host_id") != uid:
        raise HTTPException(status_code=403, detail="Seul l'hôte peut gérer les co-animateurs")

    cohosts = [c for c in (body.cohosts or []) if isinstance(c, str) and SESSION_ID_RE.match(c)][:50]
    await upsert_playlist_fields(body.session_id, {"cohosts": cohosts})
    return {"ok": True, "cohosts": cohosts}


@app.post("/session/upload-video")
async def upload_video(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    authorization: Optional[str] = Header(default=None),
):
    user = await get_user_from_token(authorization)  # utilisateur authentifié (hôte/co-animateur)
    user_id = user.get("id")

    # Sécurité : valider strictement chaque segment AVANT usage dans le chemin de stockage.
    # session_id et user_id sont des identifiants ; on rejette tout caractère non sûr (anti path traversal).
    if not session_id or not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    if not user_id or not SESSION_ID_RE.match(str(user_id)):
        raise HTTPException(status_code=400, detail="Utilisateur invalide")

    # Autorisation : seul l'hôte ou un co-animateur de CETTE session peut uploader (anti IDOR)
    authz = await get_session_authz(session_id)
    host_id = authz.get("host_id") if authz else None
    cohosts = (authz.get("cohosts") if authz else None) or []
    if user_id != host_id and user_id not in cohosts:
        raise HTTPException(status_code=403, detail="Partage réservé à l'hôte et aux co-animateurs")

    content_type = file.content_type or "application/octet-stream"
    if not content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Fichier vidéo requis")

    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Vidéo trop volumineuse (max 200 Mo)")

    # Nom de fichier : on ne garde que le basename, on neutralise les "." de tête et toute séquence ".."
    raw_name = (file.filename or "video.mp4").replace("\\", "/").split("/")[-1]
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", raw_name).replace("..", "_").lstrip(".")[:80] or "video.mp4"
    ts = int(datetime.now(timezone.utc).timestamp())
    storage_path = f"{session_id}/{user_id}/{ts}_{safe_name}"

    async with httpx.AsyncClient(timeout=180) as client:
        up = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/{SESSION_MEDIA_BUCKET}/{storage_path}",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            content=data,
        )
    if up.status_code not in (200, 201):
        logger.error("session-media upload failed: %s %s", up.status_code, up.text)
        raise HTTPException(status_code=500, detail="Upload échoué")

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SESSION_MEDIA_BUCKET}/{storage_path}"

    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/session_media",
            headers=_service_headers({"Prefer": "return=minimal"}),
            json={
                "session_id": session_id,
                "owner_id": user_id,
                "storage_path": storage_path,
                "url": public_url,
                "media_type": "video",
            },
        )

    return {"url": public_url, "storage_path": storage_path}


async def cleanup_old_media() -> None:
    """Supprime du bucket + de la table tout média de plus de MEDIA_TTL_HOURS."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=MEDIA_TTL_HOURS)).isoformat()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/session_media",
            headers=_service_headers(),
            params={"created_at": f"lt.{cutoff}", "select": "storage_path"},
        )
        if resp.status_code != 200:
            return
        rows = resp.json()
        for r in rows:
            sp = r.get("storage_path")
            if not sp:
                continue
            try:
                await client.delete(
                    f"{SUPABASE_URL}/storage/v1/object/{SESSION_MEDIA_BUCKET}/{sp}",
                    headers={
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    },
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("storage delete failed for %s: %s", sp, exc)
        if rows:
            await client.delete(
                f"{SUPABASE_URL}/rest/v1/session_media",
                headers=_service_headers(),
                params={"created_at": f"lt.{cutoff}"},
            )
            logger.info("cleanup: %d médias de session supprimés (>24h)", len(rows))


async def _cleanup_loop() -> None:
    while True:
        try:
            await cleanup_old_media()
        except Exception as exc:  # noqa: BLE001
            logger.error("cleanup loop error: %s", exc)
        await asyncio.sleep(3600)  # toutes les heures


@app.on_event("startup")
async def _on_startup():
    asyncio.create_task(_cleanup_loop())


def _plan_from_price_id(price_id: Optional[str], settings: Dict[str, Any]) -> Optional[str]:
    if not price_id:
        return None
    for (plan, _interval), key in PRICE_KEY.items():
        if settings.get(key) == price_id:
            return plan
    return None


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webhook signature/parse error: %s", exc)
        raise HTTPException(status_code=400, detail="Signature invalide")

    etype = event["type"]
    obj = event["data"]["object"]

    # clé effective (DB chiffrée ou env) pour d'éventuels appels API dans le traitement
    await apply_stripe_key()

    try:
        if etype == "checkout.session.completed":
            user_id = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("user_id")
            plan = (obj.get("metadata") or {}).get("plan")
            if user_id and plan in PLANS:
                await update_profile(
                    user_id,
                    {
                        "subscription_status": plan,
                        "stripe_customer_id": obj.get("customer"),
                        "stripe_subscription_id": obj.get("subscription"),
                    },
                )

        elif etype in ("customer.subscription.created", "customer.subscription.updated"):
            settings = await get_site_settings()
            sub_id = obj.get("id")
            status = obj.get("status")
            items = (obj.get("items") or {}).get("data") or []
            price_id = items[0]["price"]["id"] if items else None
            plan = (obj.get("metadata") or {}).get("plan") or _plan_from_price_id(price_id, settings)
            user_id = (obj.get("metadata") or {}).get("user_id")

            if not user_id:
                prof = await find_profile_by_subscription(sub_id)
                user_id = prof.get("id") if prof else None

            if user_id:
                if status in ("active", "trialing") and plan in PLANS:
                    await update_profile(
                        user_id,
                        {
                            "subscription_status": plan,
                            "stripe_customer_id": obj.get("customer"),
                            "stripe_subscription_id": sub_id,
                        },
                    )
                elif status in ("canceled", "unpaid", "incomplete_expired"):
                    await update_profile(user_id, {"subscription_status": "none"})

        elif etype == "customer.subscription.deleted":
            sub_id = obj.get("id")
            user_id = (obj.get("metadata") or {}).get("user_id")
            if not user_id:
                prof = await find_profile_by_subscription(sub_id)
                user_id = prof.get("id") if prof else None
            if user_id:
                await update_profile(user_id, {"subscription_status": "none"})

    except Exception as exc:  # noqa: BLE001
        # On log mais on répond 200 pour éviter les replays Stripe en boucle
        logger.error("Webhook handling error (%s): %s", etype, exc)

    return {"received": True}
