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
from urllib.parse import urlparse
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import httpx
import stripe
from fastapi import FastAPI, Request, HTTPException, Header, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# LiveKit (SFU) — import GARDÉ : si le SDK n'est pas installé, l'app démarre quand même
# et seul l'endpoint /livekit/token renverra une erreur 500 claire.
try:
    from livekit import api as livekit_api  # SDK serveur officiel (génération de tokens)
    _LIVEKIT_IMPORT_ERROR: Optional[str] = None
except Exception as _lk_exc:  # pragma: no cover
    livekit_api = None  # type: ignore[assignment]
    _LIVEKIT_IMPORT_ERROR = str(_lk_exc)

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
# LiveKit (SFU) — lues depuis l'environnement (déjà définies dans Coolify), jamais en dur.
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "").strip()
MAX_LIVEKIT_STAGE = 10  # nombre max de participants pouvant publier (caméra/micro/écran) par room
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
    """Vérifie le token d'accès Supabase et renvoie l'utilisateur (id, email).
    Logue la VRAIE raison d'un rejet (config manquante / token expiré / Supabase injoignable)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Token manquant — reconnecte-toi")
    token = authorization.split(" ", 1)[1].strip()

    # Vérifier la configuration serveur avant tout (cause fréquente de "Token invalide" trompeur).
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.error(
            "Config Supabase incomplète: SUPABASE_URL=%r, SERVICE_ROLE_KEY défini=%s",
            SUPABASE_URL, bool(SUPABASE_SERVICE_ROLE_KEY),
        )
        raise HTTPException(status_code=500, detail="Configuration serveur incomplète (SUPABASE_URL / SERVICE_ROLE_KEY)")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {token}"},
            )
    except Exception as exc:  # réseau / DNS / TLS → Supabase injoignable
        logger.error("Supabase injoignable lors de la validation du token (%s): %s", SUPABASE_URL, exc)
        raise HTTPException(status_code=502, detail="Service d'authentification injoignable")

    if resp.status_code != 200:
        logger.warning("Validation token échouée: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
        if resp.status_code in (401, 403):
            raise HTTPException(status_code=401, detail="Session expirée ou token invalide — reconnecte-toi")
        raise HTTPException(status_code=401, detail=f"Token rejeté par Supabase (HTTP {resp.status_code})")
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
        logger.warning("Accès admin refusé pour %r (ADMIN_EMAILS=%s)", email or "?", ADMIN_EMAILS)
        raise HTTPException(status_code=403, detail="Accès réservé à l'administrateur (email non autorisé)")
    return user


async def get_stripe_secret_record() -> Optional[str]:
    """Valeur CHIFFRÉE de la clé secrète Stripe (table stripe_secrets, service-role only).
    Schéma : id='default', colonne encrypted_secret_key."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/stripe_secrets",
            headers=_service_headers(),
            params={"id": "eq.default", "select": "encrypted_secret_key"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0].get("encrypted_secret_key")
    return None


async def store_stripe_secret(encrypted: str) -> bool:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/stripe_secrets",
            headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            params={"on_conflict": "id"},
            json={
                "id": "default",
                "encrypted_secret_key": encrypted,
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


async def list_auth_users() -> List[Dict[str, Any]]:
    """Liste TOUS les comptes via l'API admin Supabase (GoTrue, service role).
    Source de vérité fiable (≠ table profiles qui peut être vide/non peuplée)."""
    users: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20) as client:
        page = 1
        while page <= 50:  # garde-fou (50 * 1000 = 50k comptes max)
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers=_service_headers(),
                params={"page": page, "per_page": 1000},
            )
            if resp.status_code != 200:
                logger.error("list_auth_users échec: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
                break
            data = resp.json()
            batch = data.get("users", []) if isinstance(data, dict) else (data or [])
            if not batch:
                break
            users.extend(batch)
            if len(batch) < 1000:
                break
            page += 1
    return users


async def fetch_profiles_map() -> Dict[str, Dict[str, Any]]:
    """Map {id: profil} pour enrichir la liste des comptes auth (plan, avatar, etc.)."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(),
            params={"select": "id,email,full_name,avatar_url,subscription_status,comp_access_plan,comp_access_until"},
        )
    if resp.status_code != 200:
        logger.error("fetch_profiles_map échec: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
        return {}
    return {row["id"]: row for row in resp.json() if row.get("id")}


async def upsert_profile(row: Dict[str, Any]) -> bool:
    """Insère ou met à jour un profil (merge sur id) — garantit que l'octroi d'accès
    fonctionne même si la ligne profiles n'existe pas encore."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=representation"}),
            params={"on_conflict": "id"},
            json=row,
        )
    if resp.status_code not in (200, 201):
        logger.error("upsert_profile échec: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
        return False
    return True


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


# =========================================================================== #
# 🤖 CLÉ API IA (OpenAI) — chiffrée au repos (comme la clé Stripe), jamais en dur.
# =========================================================================== #
OPENAI_API_KEY_ENV = os.environ.get("OPENAI_API_KEY", "")

class AiKeyBody(BaseModel):
    openai_key: Optional[str] = None

async def get_ai_secret_record() -> Optional[str]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/ai_secrets", headers=_service_headers(),
                                params={"id": "eq.default", "select": "encrypted_openai_key"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0].get("encrypted_openai_key")
    return None

async def store_ai_secret(encrypted: str) -> bool:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{SUPABASE_URL}/rest/v1/ai_secrets",
                                 headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                                 params={"on_conflict": "id"},
                                 json={"id": "default", "encrypted_openai_key": encrypted,
                                       "updated_at": datetime.now(timezone.utc).isoformat()})
    return resp.status_code in (200, 201, 204)

async def get_openai_key() -> Optional[str]:
    """Clé OpenAI effective : DB chiffrée en priorité, sinon variable d'env."""
    return decrypt_secret(await get_ai_secret_record()) or OPENAI_API_KEY_ENV or None

@app.post("/admin/ai-keys")
async def set_ai_keys(body: AiKeyBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    if body.openai_key:
        k = body.openai_key.strip()
        if not k.startswith("sk-"):
            raise HTTPException(status_code=400, detail="La clé OpenAI doit commencer par sk-")
        if not await store_ai_secret(encrypt_secret(k)):
            raise HTTPException(status_code=500, detail="Échec de l'enregistrement de la clé IA")
    return {"ok": True}

@app.get("/admin/ai-keys")
async def get_ai_keys(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    plain = decrypt_secret(await get_ai_secret_record())
    effective = plain or OPENAI_API_KEY_ENV
    return {"configured": bool(effective), "last4": effective[-4:] if effective else "",
            "source": "db" if plain else ("env" if OPENAI_API_KEY_ENV else "none")}


# =========================================================================== #
# 🔴 ENREGISTREMENT COMPLET + 🤖 TRANSCRIPTION IA (FR) + RÉSUMÉ — option premium
#   Coûte cost_record_transcribe crédits (admin-éditable, défaut 4), débités à l'hôte
#   (sauf coach abonné « illimité »). Consentement via playlists.record_enabled.
# =========================================================================== #
RECORDINGS_BUCKET = "session-recordings"
TRANSCRIBE_MODEL = os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
SUMMARY_MODEL = os.environ.get("OPENAI_SUMMARY_MODEL", "gpt-4o-mini")

class RecordStartBody(BaseModel):
    session_id: str

async def _openai_transcribe(audio: bytes, filename: str, content_type: str, key: str) -> str:
    data = {"model": TRANSCRIBE_MODEL, "language": "fr", "response_format": "text"}
    files = {"file": (filename or "audio.webm", audio, content_type or "audio/webm")}
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post("https://api.openai.com/v1/audio/transcriptions",
                                 headers={"Authorization": f"Bearer {key}"}, data=data, files=files)
    if resp.status_code != 200:
        raise RuntimeError(f"transcription HTTP {resp.status_code}: {(resp.text or '')[:300]}")
    return (resp.text or "").strip()

async def _openai_refine(raw_text: str, key: str) -> Dict[str, str]:
    """Réécrit proprement en FR + génère un résumé / notes de cours. Renvoie {transcript, summary}."""
    if not raw_text.strip():
        return {"transcript": "", "summary": ""}
    sys = ("Tu es un assistant qui met en forme la transcription d'une session live (cours/coaching) en français. "
           "Corrige la ponctuation et les fautes, structure par moments/sujets, sans inventer de contenu. "
           "Réponds en JSON strict avec deux clés : \"transcript\" (texte propre et structuré) et "
           "\"summary\" (résumé + notes de cours en points clés, en markdown).")
    payload = {"model": SUMMARY_MODEL, "temperature": 0.3, "response_format": {"type": "json_object"},
               "messages": [{"role": "system", "content": sys},
                            {"role": "user", "content": raw_text[:120000]}]}
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post("https://api.openai.com/v1/chat/completions",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                 json=payload)
    if resp.status_code != 200:
        # repli : on garde au moins le texte brut
        return {"transcript": raw_text, "summary": ""}
    import json as _json
    content = resp.json()["choices"][0]["message"]["content"]
    try:
        obj = _json.loads(content)
        return {"transcript": obj.get("transcript") or raw_text, "summary": obj.get("summary") or ""}
    except Exception:  # noqa: BLE001
        return {"transcript": raw_text, "summary": content}

async def _sign_recording_url(path: Optional[str], expires: int = 3600) -> Optional[str]:
    """URL signée (temporaire) vers un enregistrement du bucket PRIVÉ. None si échec/chemin absent."""
    if not path:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/storage/v1/object/sign/{RECORDINGS_BUCKET}/{path}",
                headers=_service_headers(), json={"expiresIn": expires})
        if resp.status_code == 200:
            body = resp.json()
            signed = body.get("signedURL") or body.get("signedUrl")
            if signed:
                return f"{SUPABASE_URL}/storage/v1{signed}"
    except Exception:  # noqa: BLE001
        pass
    return None

async def _record_authz(session_id: str, uid: str, is_admin: bool = False) -> None:
    if is_admin:
        return  # 💳 l'admin a un contrôle total : jamais bloqué
    authz = await get_session_authz(session_id)
    host_id = authz.get("host_id") if authz else None
    cohosts = (authz.get("cohosts") if authz else None) or []
    if uid != host_id and uid not in cohosts:
        raise HTTPException(status_code=403, detail="Réservé à l'hôte de la session")

def _is_admin_email(user: Dict[str, Any]) -> bool:
    return (user.get("email") or "").strip().lower() in ADMIN_EMAILS

@app.post("/session/record/start")
async def record_start(body: RecordStartBody, authorization: Optional[str] = Header(default=None)):
    """Active l'option premium : débite les crédits à l'hôte (sauf abo illimité) + active le consentement."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    # 💳 Jamais débité ni bloqué : ADMIN (crédits illimités) ou COACH abonné « illimité ».
    is_admin = _is_admin_email(user)
    await _record_authz(body.session_id, uid, is_admin)
    settings = await get_pricing_settings()
    cost = int(settings.get("cost_record_transcribe", 4) or 0)
    unlimited = is_admin or await is_coach_unlimited(uid)
    spent = 0
    if not unlimited and cost > 0:
        bal = await _spend_credits(uid, cost, "spend_record",
                                   ref=f"record:{body.session_id}:{uid}", note=f"record+IA {body.session_id}")
        spent = cost
        balance = bal
    else:
        balance = await get_balance(uid)
    await upsert_playlist_fields(body.session_id, {"record_enabled": True})
    return {"ok": True, "cost": spent, "balance": balance, "unlimited": unlimited}

@app.post("/session/record/stop")
async def record_stop(body: RecordStartBody, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    await _record_authz(body.session_id, uid, _is_admin_email(user))
    await upsert_playlist_fields(body.session_id, {"record_enabled": False})
    return {"ok": True}

@app.post("/session/record/upload")
async def record_upload(file: UploadFile = File(...), session_id: str = Form(...),
                        authorization: Optional[str] = Header(default=None)):
    """Reçoit l'audio complet (toutes voix + musique), le stocke, transcrit (FR) + résume."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not session_id or not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    await _record_authz(session_id, uid, _is_admin_email(user))
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Fichier audio vide")
    if len(data) > 300 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Enregistrement trop volumineux (max 300 Mo)")
    # 🔒 On NE fait JAMAIS confiance au Content-Type du client (sinon text/html/svg → XSS stocké
    #     servi depuis l'origine du stockage). On force un type audio canonique selon l'extension.
    raw_ct = (file.content_type or "").split(";")[0].strip().lower()
    if "ogg" in raw_ct:
        ext, content_type = "ogg", "audio/ogg"
    elif "mp4" in raw_ct or "m4a" in raw_ct or "aac" in raw_ct:
        ext, content_type = "m4a", "audio/mp4"
    else:
        ext, content_type = "webm", "audio/webm"
    ts = int(datetime.now(timezone.utc).timestamp())
    storage_path = f"{session_id}/{uid}/{ts}.{ext}"
    async with httpx.AsyncClient(timeout=300) as client:
        up = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/{RECORDINGS_BUCKET}/{storage_path}",
            headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                     "Content-Type": content_type, "x-upsert": "true"},
            content=data)
    if up.status_code not in (200, 201):
        logger.error("recording upload échec: %s %s", up.status_code, (up.text or "")[:200])
        raise HTTPException(status_code=500, detail="Upload de l'enregistrement échoué")
    # 🔒 Bucket privé : pas d'URL publique. On stocke seulement le chemin et on sert via URL signée.
    audio_url = await _sign_recording_url(storage_path)
    # crée la ligne (processing)
    async with httpx.AsyncClient(timeout=10) as client:
        ins = await client.post(f"{SUPABASE_URL}/rest/v1/session_recordings",
                                headers=_service_headers({"Prefer": "return=representation"}),
                                json={"session_id": session_id, "host_id": uid, "audio_path": storage_path,
                                      "status": "processing"})
    rec = ins.json()[0] if ins.status_code in (200, 201) and ins.json() else {"id": None}
    rec_id = rec.get("id")
    # transcription + résumé
    key = await get_openai_key()
    patch: Dict[str, Any] = {}
    if not key:
        patch = {"status": "error", "error": "Clé OpenAI non configurée (admin → Clés IA)"}
    else:
        try:
            raw = await _openai_transcribe(data, f"{session_id}.{ext}", content_type, key)
            # 🚫 Audio vide / silencieux : Whisper "hallucine" des phrases sur du silence.
            #    On NE fabrique PAS de faux résumé → message explicite, le résumé reste dérivé du réel.
            if not raw or not raw.strip():
                patch = {"status": "done", "transcript": "",
                         "summary": "⚠️ Aucun audio capté pendant l'enregistrement (silence). "
                                    "Vérifiez que le micro est activé et que la musique joue, puis réessayez."}
            else:
                refined = await _openai_refine(raw, key)
                patch = {"status": "done", "transcript": refined["transcript"], "summary": refined["summary"]}
        except Exception as exc:  # noqa: BLE001
            logger.error("transcription échec (rec=%s): %s", rec_id, exc)
            patch = {"status": "error", "error": str(exc)[:500]}
    if rec_id is not None:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.patch(f"{SUPABASE_URL}/rest/v1/session_recordings",
                               headers=_service_headers({"Prefer": "return=minimal"}),
                               params={"id": f"eq.{rec_id}"}, json=patch)
    return {"ok": patch.get("status") == "done", "id": rec_id, "audio_url": audio_url, **patch}

@app.get("/session/recordings")
async def session_recordings(authorization: Optional[str] = Header(default=None)):
    """Enregistrements + transcriptions de l'hôte (consultation + téléchargement)."""
    user = await get_user_from_token(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/session_recordings", headers=_service_headers(),
                                params={"host_id": f"eq.{user.get('id')}", "select": "*",
                                        "order": "created_at.desc", "limit": "100"})
    rows = resp.json() if resp.status_code == 200 else []
    # 🔒 Bucket privé : on (re)génère une URL signée temporaire pour chaque enregistrement.
    for r in rows:
        r["audio_url"] = await _sign_recording_url(r.get("audio_path"))
    return {"recordings": rows}


@app.delete("/session/recordings/{rec_id}")
async def delete_recording(rec_id: int, authorization: Optional[str] = Header(default=None)):
    """Supprime un enregistrement : FICHIER du bucket privé + ligne en base.
    Le coach ne supprime QUE ses propres enregistrements (admin = tous)."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    is_admin = _is_admin_email(user)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/session_recordings", headers=_service_headers(),
                                params={"id": f"eq.{rec_id}", "select": "id,host_id,audio_path", "limit": "1"})
        rows = resp.json() if resp.status_code == 200 else []
        if not rows:
            raise HTTPException(status_code=404, detail="Enregistrement introuvable")
        rec = rows[0]
        if not is_admin and rec.get("host_id") != uid:
            raise HTTPException(status_code=403, detail="Vous ne pouvez supprimer que vos propres enregistrements")
        # 1) Retirer le FICHIER du stockage (bucket privé) — pas juste masquer.
        path = rec.get("audio_path")
        if path:
            try:
                await client.delete(
                    f"{SUPABASE_URL}/storage/v1/object/{RECORDINGS_BUCKET}/{path}",
                    headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"})
            except Exception as exc:  # noqa: BLE001
                logger.error("suppression fichier enregistrement échec (%s): %s", path, exc)
        # 2) Supprimer la ligne en base.
        await client.delete(f"{SUPABASE_URL}/rest/v1/session_recordings", headers=_service_headers(),
                            params={"id": f"eq.{rec_id}"})
    return {"ok": True}


# ============================================================================
#  PAGE PROMO / AFFICHE DE SESSION (configurable par le coach, lien partageable)
#  Stockée sur la ligne `playlists` (colonnes promo_*). Média (affiche/vidéo 9:16) dans le
#  bucket public session-media. Lecture PUBLIQUE (via backend service role → pas de blocage RLS).
# ============================================================================
class PromoBody(BaseModel):
    session_id: str
    enabled: Optional[bool] = None
    media_url: Optional[str] = None
    media_type: Optional[str] = None       # 'image' | 'video'
    description: Optional[str] = None
    cta_text: Optional[str] = None
    payment_link: Optional[str] = None     # vide/None = session GRATUITE
    price: Optional[str] = None
    format: Optional[str] = None           # '9:16' | '16:9' (cadrage de l'affiche/vidéo)

async def _promo_authz(session_id: str, user: Dict[str, Any]) -> None:
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    if _is_admin_email(user):
        return
    uid = user.get("id")
    authz = await get_session_authz(session_id)
    host_id = authz.get("host_id") if authz else None
    cohosts = (authz.get("cohosts") if authz else None) or []
    # 🔒 Strict : seul l'hôte (ou co-hôte / admin) édite la promo. On NE « réclame » JAMAIS une session
    #    sans hôte ici (= prise de contrôle / IDOR). L'hôte est défini à la création/config de la session.
    if uid != host_id and uid not in cohosts:
        raise HTTPException(status_code=403, detail="Réservé à l'hôte de la session")

@app.post("/session/promo")
async def save_promo(body: PromoBody, authorization: Optional[str] = Header(default=None)):
    """Enregistre/met à jour la page promo de la session (coach/hôte)."""
    user = await get_user_from_token(authorization)
    await _promo_authz(body.session_id, user)
    # 🔒 N'accepter que des URL http(s) pour le lien de paiement et le média (bloque javascript:/data: → XSS).
    def _check_url(val: Optional[str], label: str) -> None:
        if val and val.strip() and not val.strip().lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail=f"{label} invalide (doit commencer par http(s)://)")
    _check_url(body.payment_link, "Lien de paiement")
    _check_url(body.media_url, "URL du média")
    if body.media_type is not None and body.media_type not in ("image", "video", ""):
        raise HTTPException(status_code=400, detail="Type de média invalide")
    if body.format is not None and body.format not in ("9:16", "16:9", ""):
        raise HTTPException(status_code=400, detail="Format invalide")
    mapping = [("enabled", "promo_enabled"), ("media_url", "promo_media_url"),
               ("media_type", "promo_media_type"), ("description", "promo_description"),
               ("cta_text", "promo_cta"), ("payment_link", "promo_payment_link"), ("price", "promo_price"),
               ("format", "promo_format")]
    patch: Dict[str, Any] = {}
    for attr, col in mapping:
        v = getattr(body, attr)
        if v is not None:
            patch[col] = v
    if patch:
        await upsert_playlist_fields(body.session_id, patch)
    return {"ok": True}

@app.post("/session/promo/media")
async def upload_promo_media(file: UploadFile = File(...), session_id: str = Form(...),
                             authorization: Optional[str] = Header(default=None)):
    """Upload de l'affiche (image) OU de la vidéo 9:16 de la page promo → bucket public session-media."""
    user = await get_user_from_token(authorization)
    await _promo_authz(session_id, user)
    # 🔒 On ne fait PAS confiance au Content-Type client : on n'autorise QUE des formats RASTER/vidéo
    #    canoniques (SVG/HTML rejetés → pas de XSS stocké servi depuis l'origine du bucket public).
    raw_ct = (file.content_type or "").split(";")[0].strip().lower()
    IMAGE_TYPES = {"image/jpeg": ("image", "jpg", "image/jpeg"), "image/png": ("image", "png", "image/png"),
                   "image/webp": ("image", "webp", "image/webp"), "image/gif": ("image", "gif", "image/gif")}
    VIDEO_TYPES = {"video/mp4": ("video", "mp4", "video/mp4"), "video/webm": ("video", "webm", "video/webm"),
                   "video/quicktime": ("video", "mov", "video/quicktime")}
    spec = IMAGE_TYPES.get(raw_ct) or VIDEO_TYPES.get(raw_ct)
    if not spec:
        raise HTTPException(status_code=400, detail="Format non supporté (JPEG, PNG, WebP, GIF, MP4, WebM, MOV)")
    media_type, ext, safe_ct = spec
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Fichier trop volumineux (max 200 Mo)")
    ts = int(datetime.now(timezone.utc).timestamp())
    storage_path = f"promo/{session_id}/{ts}.{ext}"  # extension canonique (pas de nom client)
    async with httpx.AsyncClient(timeout=180) as client:
        up = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/{SESSION_MEDIA_BUCKET}/{storage_path}",
            headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                     "Content-Type": safe_ct, "x-upsert": "true"},  # type CANONIQUE forcé (jamais le client)
            content=data)
    if up.status_code not in (200, 201):
        logger.error("promo media upload échec: %s %s", up.status_code, (up.text or "")[:200])
        raise HTTPException(status_code=500, detail="Upload échoué")
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SESSION_MEDIA_BUCKET}/{storage_path}"
    return {"url": public_url, "media_type": media_type}

# 🔒 Anti-SSRF : on ne récupère une miniature QUE depuis ces plateformes vidéo connues (jamais une URL
#    arbitraire → pas d'accès aux services internes / métadonnées cloud).
_THUMB_HOSTS = ("instagram.com", "facebook.com", "fb.watch", "tiktok.com", "vimeo.com",
                "youtube.com", "youtu.be")

def _thumb_host(url: str) -> Optional[str]:
    """hostname si l'URL est http(s) ET appartient (exactement ou en sous-domaine) à une plateforme connue, sinon None."""
    try:
        p = urlparse(url)
    except Exception:  # noqa: BLE001
        return None
    if p.scheme not in ("http", "https") or not p.hostname:
        return None
    host = p.hostname.lower().rstrip(".")
    if any(host == d or host.endswith("." + d) for d in _THUMB_HOSTS):
        return host
    return None

async def _fetch_text_capped(client: httpx.AsyncClient, url: str, params: Optional[Dict[str, Any]] = None,
                             max_bytes: int = 524288) -> Optional[str]:
    """GET en lisant AU PLUS max_bytes (anti-DoS / amplification)."""
    try:
        async with client.stream("GET", url, params=params) as r:
            if r.status_code != 200:
                return None
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= max_bytes:
                    break
            return bytes(buf[:max_bytes]).decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        return None

@app.get("/promo/thumbnail")
async def promo_thumbnail(url: str):
    """À partir d'un lien vidéo (Instagram, Facebook, YouTube, TikTok, Vimeo), renvoie UNIQUEMENT la
    miniature (og:image / oEmbed thumbnail_url). { thumbnail_url, video_url }. null si introuvable.
    🔒 Restreint aux plateformes connues (anti-SSRF), lecture plafonnée (anti-DoS)."""
    host = _thumb_host(url)
    if not host:
        # URL hors plateformes autorisées → pas de fetch (anti-SSRF) : vignette neutre côté frontend.
        return {"thumbnail_url": None, "video_url": url}
    import json as _json
    thumb: Optional[str] = None

    # YouTube : miniature déduite de l'id (AUCUNE requête sortante).
    ytm = re.search(r'(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([\w-]{6,})', url)
    if ytm:
        thumb = f"https://i.ytimg.com/vi/{ytm.group(1)}/hqdefault.jpg"

    # Vimeo / TikTok : oEmbed officiel (endpoints CONSTANTS de confiance ; l'URL n'est qu'un paramètre).
    if not thumb and (host == "vimeo.com" or host.endswith(".vimeo.com")):
        async with httpx.AsyncClient(timeout=8) as c:
            txt = await _fetch_text_capped(c, "https://vimeo.com/api/oembed.json", params={"url": url}, max_bytes=65536)
        if txt:
            try: thumb = _json.loads(txt).get("thumbnail_url")
            except Exception: pass  # noqa: BLE001
    if not thumb and (host == "tiktok.com" or host.endswith(".tiktok.com")):
        async with httpx.AsyncClient(timeout=8) as c:
            txt = await _fetch_text_capped(c, "https://www.tiktok.com/oembed", params={"url": url}, max_bytes=65536)
        if txt:
            try: thumb = _json.loads(txt).get("thumbnail_url")
            except Exception: pass  # noqa: BLE001

    # Instagram / Facebook : og:image de la page (host déjà validé dans l'allowlist). follow_redirects=False
    # → pas de rebond vers un hôte interne. Lecture plafonnée à 512 Ko.
    if not thumb:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False,
                                     headers={"User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"}) as c:
            html = await _fetch_text_capped(c, url)
        if html:
            m = (re.search(r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)', html, re.I)
                 or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', html, re.I)
                 or re.search(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)', html, re.I))
            if m:
                thumb = m.group(1).replace("&amp;", "&").strip()

    if thumb and not thumb.lower().startswith(("http://", "https://")):
        thumb = None
    return {"thumbnail_url": thumb, "video_url": url}


@app.get("/session/my-last")
async def my_last_session(authorization: Optional[str] = Header(default=None)):
    """Renvoie la DERNIÈRE session de l'utilisateur (host_id = uid), pour le bouton « Ma session ».
    Exclut la ligne de playlist personnelle (owner-*). None si l'utilisateur n'a aucune session."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/playlists", headers=_service_headers(),
                                params={"host_id": f"eq.{uid}", "session_id": "not.like.owner-*",
                                        "select": "session_id,updated_at", "order": "updated_at.desc", "limit": "1"})
    rows = resp.json() if resp.status_code == 200 else []
    return {"session_id": rows[0]["session_id"] if rows else None}

@app.get("/session/promo/{session_id}")
async def get_promo(session_id: str):
    """Lecture PUBLIQUE de la page promo (lien partageable, visiteur non authentifié)."""
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant invalide")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/playlists", headers=_service_headers(),
                                params={"session_id": f"eq.{session_id}",
                                        "select": "promo_enabled,promo_media_url,promo_media_type,promo_description,promo_cta,promo_payment_link,promo_price,promo_format",
                                        "limit": "1"})
    rows = resp.json() if resp.status_code == 200 else []
    if not rows:
        raise HTTPException(status_code=404, detail="Session introuvable")
    r = rows[0]
    return {
        "session_id": session_id,
        "enabled": bool(r.get("promo_enabled")),
        "media_url": r.get("promo_media_url"),
        "media_type": r.get("promo_media_type"),
        "description": r.get("promo_description"),
        "cta_text": r.get("promo_cta"),
        "payment_link": r.get("promo_payment_link"),
        "price": r.get("promo_price"),
        "format": r.get("promo_format") or "9:16",
    }


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


# --------------------------------------------------------------------------- #
# LiveKit (SFU) — génération de tokens d'accès (room = session BoostTribe)
#   rôle "stage"  : publie caméra/micro/écran (max 10 publishers / room)
#   rôle "viewer" : regarde seulement (illimité)
# --------------------------------------------------------------------------- #
class LiveKitTokenBody(BaseModel):
    session_id: str
    identity: str
    name: Optional[str] = None
    role: str = "viewer"  # "stage" | "viewer"


class LiveKitParticipantBody(BaseModel):
    session_id: str
    identity: str  # identité LiveKit du participant ciblé (promotion / rétrogradation)


def _require_livekit_ready() -> None:
    """Vérifie SDK + configuration LiveKit ; lève une 500 claire sinon."""
    if livekit_api is None:
        logger.error("livekit-api non importable: %s", _LIVEKIT_IMPORT_ERROR)
        raise HTTPException(status_code=500, detail="SDK LiveKit indisponible côté serveur")
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=500,
            detail="LiveKit non configuré (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)",
        )


def _sanitize_identity(raw: Optional[str]) -> str:
    """Ne garde que des caractères sûrs (anti-collision/usurpation), tronqué."""
    return re.sub(r"[^A-Za-z0-9_-]", "", (raw or ""))[:64]


def _clean_name(raw: Optional[str], fallback: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", (raw or "")).strip()[:80]
    return name or fallback


async def _optional_user(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    """Résout l'utilisateur Supabase si un token valide est fourni, sinon None (best-effort)."""
    if not authorization:
        return None
    try:
        return await get_user_from_token(authorization)
    except Exception:
        return None


async def _is_host_or_cohost(session_id: str, user_id: Optional[str]) -> bool:
    if not user_id:
        return False
    authz = await get_session_authz(session_id)
    if not authz:
        return False
    cohosts = authz.get("cohosts") or []
    return user_id == authz.get("host_id") or user_id in cohosts


async def _count_livekit_publishers(session_id: str) -> int:
    """Compte les participants pouvant PUBLIER déjà présents dans la room.
    Si la room n'existe pas encore (ou service injoignable) → 0 (best-effort)."""
    lkapi = livekit_api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    try:
        resp = await lkapi.room.list_participants(
            livekit_api.ListParticipantsRequest(room=session_id)
        )
        count = 0
        for p in resp.participants:
            perm = getattr(p, "permission", None)
            if perm is not None and getattr(perm, "can_publish", False):
                count += 1
        return count
    except Exception as exc:  # room inexistante (404) ou erreur réseau → on considère 0
        logger.info("LiveKit list_participants(%s) → 0 publishers (%s)", session_id, exc)
        return 0
    finally:
        try:
            await lkapi.aclose()
        except Exception:  # pragma: no cover
            pass


async def _set_livekit_publish(session_id: str, identity: str, can_publish: bool) -> None:
    """(Hôte) accorde/retire le droit de publier à un participant déjà dans la room (RoomService)."""
    lkapi = livekit_api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    try:
        await lkapi.room.update_participant(
            livekit_api.UpdateParticipantRequest(
                room=session_id,
                identity=identity,
                permission=livekit_api.ParticipantPermission(
                    can_subscribe=True,
                    can_publish=can_publish,
                    can_publish_data=can_publish,
                ),
            )
        )
    except Exception as exc:
        logger.warning("LiveKit update_participant(%s, %s) échec: %s", session_id, identity, exc)
        raise HTTPException(status_code=404, detail="participant_not_found")
    finally:
        try:
            await lkapi.aclose()
        except Exception:  # pragma: no cover
            pass


@app.post("/livekit/token")
async def livekit_token(body: LiveKitTokenBody, authorization: Optional[str] = Header(default=None)):
    """Émet un token LiveKit.
    - role="stage" : RÉSERVÉ à l'hôte/co-hôte authentifié (publie caméra/micro/écran), cap 10.
      L'identité est FORCÉE à l'user_id vérifié (anti-usurpation / anti-élévation de privilège).
    - role="viewer" : lecture seule. Jonction anonyme autorisée (lien/QR) ; si un token Supabase
      valide est fourni, l'identité est liée au compte, sinon préfixée "anon-".
    """
    _require_livekit_ready()

    session_id = (body.session_id or "").strip()
    if not session_id or not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")

    requested_role = body.role if body.role in ("stage", "viewer") else "viewer"
    user = await _optional_user(authorization)
    user_id = (user or {}).get("id")

    # L'identité de la room = l'identifiant applicatif du participant (socket userId, unique PAR onglet).
    # Indispensable : (a) la grille caméra du front mappe les pistes par cet id ; (b) deux onglets d'un
    # même compte ne doivent pas partager la même identité (LiveKit déconnecte les doublons d'identité).
    # L'AUTORISATION de publier (rôle stage) reste, elle, vérifiée via le JWT Supabase (hôte/co-hôte).
    identity = _sanitize_identity(body.identity)
    if not identity:
        raise HTTPException(status_code=400, detail="identity requis")
    meta = (user or {}).get("user_metadata") or {}
    name = _clean_name(meta.get("full_name") or body.name or (user or {}).get("email"), identity)

    if requested_role == "stage":
        # 🔒 Publier = être hôte/co-hôte authentifié de CETTE session (anti token-minting / anti self-élévation).
        if not user_id:
            raise HTTPException(status_code=401, detail="authentification requise pour publier")
        if not await _is_host_or_cohost(session_id, user_id):
            raise HTTPException(status_code=403, detail="stage_reserved_to_host")
        # Limite scène : refuser un nouveau publisher si la room est déjà pleine (10 max).
        if await _count_livekit_publishers(session_id) >= MAX_LIVEKIT_STAGE:
            raise HTTPException(status_code=409, detail="stage_full")
        can_publish = True
    else:
        can_publish = False

    grants = livekit_api.VideoGrants(
        room_join=True,
        room=session_id,
        can_subscribe=True,
        can_publish=can_publish,
        can_publish_data=can_publish,  # données réservées aux publishers (viewer = lecture seule)
    )
    token = (
        livekit_api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
        .with_ttl(timedelta(hours=6))
        .to_jwt()
    )
    return {"token": token, "url": LIVEKIT_URL, "identity": identity, "role": "stage" if can_publish else "viewer"}


@app.post("/livekit/promote")
async def livekit_promote(body: LiveKitParticipantBody, authorization: Optional[str] = Header(default=None)):
    """(Hôte/co-hôte) promeut un viewer en stage — accorde le droit de publier (cap 10)."""
    _require_livekit_ready()
    user = await get_user_from_token(authorization)  # 401 si token invalide
    uid = user.get("id")
    session_id = (body.session_id or "").strip()
    target = (body.identity or "").strip()
    if not session_id or not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    if not target:
        raise HTTPException(status_code=400, detail="identity requis")
    if not await _is_host_or_cohost(session_id, uid):
        raise HTTPException(status_code=403, detail="host_only")
    if await _count_livekit_publishers(session_id) >= MAX_LIVEKIT_STAGE:
        raise HTTPException(status_code=409, detail="stage_full")
    await _set_livekit_publish(session_id, target, True)
    return {"ok": True, "identity": target, "role": "stage"}


@app.post("/livekit/demote")
async def livekit_demote(body: LiveKitParticipantBody, authorization: Optional[str] = Header(default=None)):
    """(Hôte/co-hôte) retire un participant de la scène — lui retire le droit de publier."""
    _require_livekit_ready()
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    session_id = (body.session_id or "").strip()
    target = (body.identity or "").strip()
    if not session_id or not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    if not target:
        raise HTTPException(status_code=400, detail="identity requis")
    if not await _is_host_or_cohost(session_id, uid):
        raise HTTPException(status_code=403, detail="host_only")
    await _set_livekit_publish(session_id, target, False)
    return {"ok": True, "identity": target, "role": "viewer"}


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
    # ❌ Abonnements désactivés : BoostTribe fonctionne désormais 100% en CRÉDITS.
    #    Utiliser POST /stripe/buy-credits (paiement unique CHF) pour acheter un pack.
    raise HTTPException(status_code=410, detail="Les abonnements ne sont plus proposés. Achetez des crédits.")
    if not await apply_stripe_key():  # noqa: B018  (code conservé pour rollback éventuel)
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
    target_email = (body.email or "").strip().lower()
    if not user_id:
        if not target_email:
            raise HTTPException(status_code=400, detail="email ou user_id requis")
        prof = await get_profile_by_email(target_email)
        if prof:
            user_id = prof["id"]
        else:
            # Repli : retrouver le compte via l'API admin Supabase (profiles peut être vide)
            au = next(
                (u for u in await list_auth_users() if (u.get("email") or "").lower() == target_email),
                None,
            )
            if not au:
                raise HTTPException(status_code=404, detail="Compte introuvable pour cet email")
            user_id = au["id"]
            target_email = (au.get("email") or target_email).lower()

    # Upsert (merge sur id) → fonctionne même si la ligne profiles n'existe pas encore.
    row: Dict[str, Any] = {"id": user_id, "comp_access_plan": body.plan, "comp_access_until": body.until}
    if target_email:
        row["email"] = target_email
    if not await upsert_profile(row):
        # Repli ultime : PATCH si l'upsert a échoué (ex. colonnes requises supplémentaires)
        await update_profile(user_id, {"comp_access_plan": body.plan, "comp_access_until": body.until})
    # 🏆 Un accès accordé par l'admin = coach ILLIMITÉ : on écrit aussi un abo coach ACTIF + type
    #    'subscription' → crédits illimités côté backend (is_coach_unlimited) ET RLS (has_open_session_access).
    try:
        await update_profile(user_id, {"coach_payment_type": "subscription"})
        await upsert_coach_subscription(user_id, {"status": "active", "current_period_end": body.until,
                                                  "stripe_subscription_id": f"admin-grant:{user_id}"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("grant-access: synchro abo coach échec (%s): %s", user_id, exc)
    return {"ok": True, "user_id": user_id, "plan": body.plan, "until": body.until}


@app.post("/admin/revoke-access")
async def revoke_access(body: RevokeAccessBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    await update_profile(body.user_id, {"comp_access_plan": None, "comp_access_until": None})
    # Annule l'abo coach SEULEMENT s'il provient d'un accès admin (jamais un vrai abo Stripe payant).
    try:
        sub = await get_coach_subscription(body.user_id)
        if sub and str(sub.get("stripe_subscription_id") or "").startswith("admin-grant:"):
            await upsert_coach_subscription(body.user_id, {"status": "canceled", "current_period_end": None})
    except Exception as exc:  # noqa: BLE001
        logger.warning("revoke-access: annulation abo coach échec (%s): %s", body.user_id, exc)
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
    # Source de vérité = API admin Supabase (tous les comptes), enrichie par la table profiles.
    auth_users = await list_auth_users()
    profiles = await fetch_profiles_map()
    rows: List[Dict[str, Any]] = []
    for u in auth_users:
        uid = u.get("id")
        prof = profiles.get(uid, {})
        meta = u.get("user_metadata") or {}
        rows.append({
            "id": uid,
            "email": u.get("email") or prof.get("email"),
            "full_name": prof.get("full_name") or meta.get("full_name") or meta.get("name"),
            "avatar_url": prof.get("avatar_url") or meta.get("avatar_url"),
            "subscription_status": prof.get("subscription_status"),
            "comp_access_plan": prof.get("comp_access_plan"),
            "comp_access_until": prof.get("comp_access_until"),
            "created_at": u.get("created_at"),
        })
    # Tri par date de création décroissante (comptes récents en premier)
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return {"users": rows}


# =========================================================================== #
# 💳 SYSTÈME DE CRÉDITS (remplace les abonnements)
#   1 crédit = 1 accès à un live (rejoindre OU héberger). Tout est éditable admin.
#   Écritures du ledger via RPC service-role (add_credits / spend_credits, atomiques).
# =========================================================================== #
class SpendBody(BaseModel):
    action: str          # "join" | "host"
    session_id: str

class OfferCreditsBody(BaseModel):
    email: Optional[str] = None
    user_id: Optional[str] = None
    credits: int
    note: Optional[str] = None

class BuyCreditsBody(BaseModel):
    pack_id: int

class PackBody(BaseModel):
    id: Optional[int] = None
    name: str
    credits: int
    price_chf: float
    is_highlighted: bool = False
    audience: str = "participant"     # participant | creator
    sort: int = 0
    active: bool = True

class PricingSettingsBody(BaseModel):
    services_shown: Optional[List[str]] = None
    offers: Optional[Dict[str, Any]] = None
    cost_join: Optional[int] = None
    cost_host: Optional[int] = None
    cost_record_transcribe: Optional[int] = None
    credit_validity_months: Optional[int] = None
    signup_free_credits: Optional[int] = None


async def get_pricing_settings() -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/pricing_settings",
            headers=_service_headers(), params={"id": "eq.default", "select": "*"},
        )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    # repli défauts si la table n'est pas encore initialisée
    return {"services_shown": ["live", "visio", "stage", "chat"], "offers": {},
            "cost_join": 1, "cost_host": 1, "cost_record_transcribe": 4,
            "credit_validity_months": 12, "signup_free_credits": 1}

async def _credit_validity_months() -> int:
    try:
        return int((await get_pricing_settings()).get("credit_validity_months") or 12)
    except Exception:  # noqa: BLE001
        return 12

async def get_credit_packs(active_only: bool = True) -> List[Dict[str, Any]]:
    params = {"select": "*", "order": "audience.asc,sort.asc"}
    if active_only:
        params["active"] = "eq.true"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/credit_packs", headers=_service_headers(), params=params)
    return resp.json() if resp.status_code == 200 else []

async def get_balance(user_id: str) -> int:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_service_headers(), params={"id": f"eq.{user_id}", "select": "credits"},
        )
    if resp.status_code == 200 and resp.json():
        return int(resp.json()[0].get("credits") or 0)
    return 0

async def _rpc(fn: str, args: Dict[str, Any]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10) as client:
        return await client.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", headers=_service_headers(), json=args)

async def _add_credits(user_id: str, amount: int, reason: str, ref: Optional[str] = None,
                       note: Optional[str] = None, expires_months: Optional[int] = None) -> int:
    expires = None
    if expires_months:
        expires = (datetime.now(timezone.utc) + timedelta(days=30 * expires_months)).isoformat()
    resp = await _rpc("add_credits", {"p_user": user_id, "p_amount": amount, "p_reason": reason,
                                      "p_ref": ref, "p_note": note, "p_expires": expires})
    if resp.status_code not in (200, 204):
        logger.error("add_credits RPC échec: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
        raise HTTPException(status_code=500, detail="Échec du crédit")
    try:
        return int(resp.json())
    except Exception:  # noqa: BLE001
        return await get_balance(user_id)

async def _spend_credits(user_id: str, amount: int, reason: str, ref: str, note: Optional[str] = None) -> int:
    if amount <= 0:
        return await get_balance(user_id)
    resp = await _rpc("spend_credits", {"p_user": user_id, "p_amount": amount, "p_reason": reason,
                                        "p_ref": ref, "p_note": note})
    if resp.status_code in (200, 204):
        try:
            return int(resp.json())
        except Exception:  # noqa: BLE001
            return await get_balance(user_id)
    # P0001 'insufficient_credits' → 402
    if "insufficient_credits" in (resp.text or ""):
        raise HTTPException(status_code=402, detail="Crédits insuffisants")
    logger.error("spend_credits RPC échec: HTTP %s — %s", resp.status_code, (resp.text or "")[:300])
    raise HTTPException(status_code=500, detail="Échec du débit de crédits")


@app.get("/credits/config")
async def credits_config():
    """Config publique pour la page tarifaire + l'assistant : packs actifs + réglages/offres."""
    settings = await get_pricing_settings()
    packs = await get_credit_packs(active_only=True)
    return {
        "packs": packs,
        "services_shown": settings.get("services_shown") or [],
        "offers": settings.get("offers") or {},
        "cost_join": settings.get("cost_join", 1),
        "cost_host": settings.get("cost_host", 1),
        "cost_record_transcribe": settings.get("cost_record_transcribe", 4),
        "credit_validity_months": settings.get("credit_validity_months", 12),
        "signup_free_credits": settings.get("signup_free_credits", 1),
        "currency": "CHF",
    }

@app.get("/credits/me")
async def credits_me(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/credit_ledger",
            headers=_service_headers(),
            params={"user_id": f"eq.{uid}", "select": "delta,reason,note,created_at,expires_at",
                    "order": "created_at.desc", "limit": "50"},
        )
    ledger = resp.json() if resp.status_code == 200 else []
    return {"balance": await get_balance(uid), "ledger": ledger}

@app.post("/credits/signup-bonus")
async def credits_signup_bonus(authorization: Optional[str] = Header(default=None)):
    """1er cours offert : crédite signup_free_credits une seule fois (idempotent par user)."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    n = int((await get_pricing_settings()).get("signup_free_credits") or 0)
    if n <= 0:
        return {"balance": await get_balance(uid), "granted": 0}
    bal = await _add_credits(uid, n, "signup_bonus", ref=f"signup:{uid}",
                             note="1er cours offert", expires_months=await _credit_validity_months())
    return {"balance": bal, "granted": n}

@app.post("/credits/spend")
async def credits_spend(body: SpendBody, authorization: Optional[str] = Header(default=None)):
    """Débite cost_join / cost_host (atomique + idempotent par session)."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    sid = (body.session_id or "").strip()
    if not sid or not SESSION_ID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    # 💎 Coach abonné « Illimité » → aucun débit de crédits (héberge/rejoint sans limite).
    if await is_coach_unlimited(uid):
        return {"ok": True, "balance": await get_balance(uid), "spent": 0, "unlimited": True}
    settings = await get_pricing_settings()
    if body.action == "join":
        cost, reason = int(settings.get("cost_join", 1)), "spend_join"
    elif body.action == "host":
        cost, reason = int(settings.get("cost_host", 1)), "spend_host"
    else:
        raise HTTPException(status_code=400, detail="Action invalide")
    bal = await _spend_credits(uid, cost, reason, ref=f"{sid}:{uid}", note=f"{body.action} {sid}")
    return {"ok": True, "balance": bal, "spent": cost}

@app.post("/stripe/buy-credits")
async def buy_credits(body: BuyCreditsBody, authorization: Optional[str] = Header(default=None)):
    """Checkout Stripe ONE-TIME (mode payment, CHF) pour acheter un pack de crédits."""
    if not await apply_stripe_key():
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    user = await get_user_from_token(authorization)
    uid, email = user.get("id"), user.get("email")
    packs = await get_credit_packs(active_only=True)
    pack = next((p for p in packs if int(p["id"]) == int(body.pack_id)), None)
    if not pack:
        raise HTTPException(status_code=404, detail="Pack introuvable")
    amount = round(float(pack["price_chf"]) * 100)
    # Offre de lancement : bonus % de crédits (réglage admin)
    settings = await get_pricing_settings()
    launch = (settings.get("offers") or {}).get("launch") or {}
    bonus_credits = 0
    if launch.get("enabled") and launch.get("percent"):
        ends = launch.get("ends_at")
        active = True
        if ends:
            try:
                active = datetime.fromisoformat(str(ends).replace("Z", "+00:00")) > datetime.now(timezone.utc)
            except Exception:  # noqa: BLE001
                active = True
        if active:
            bonus_credits = int(round(int(pack["credits"]) * float(launch["percent"]) / 100.0))
    total_credits = int(pack["credits"]) + bonus_credits
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": "chf",
                "unit_amount": amount,
                "product_data": {"name": f"{pack['name']} — {total_credits} crédits BoostTribe"},
            },
            "quantity": 1,
        }],
        success_url=f"{FRONTEND_URL}/pricing?success=1",
        cancel_url=f"{FRONTEND_URL}/pricing?canceled=1",
        client_reference_id=uid,
        customer_email=email,
        metadata={"user_id": uid, "pack_id": str(pack["id"]), "credits": str(total_credits)},
    )
    return {"url": session.url}


# --------------------------------------------------------------------------- #
# 💳 ADMIN crédits : offrir des crédits + config (packs / réglages)
# --------------------------------------------------------------------------- #
@app.post("/admin/offer-credits")
async def offer_credits(body: OfferCreditsBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    if not body.credits or body.credits <= 0:
        raise HTTPException(status_code=400, detail="Nombre de crédits invalide")
    user_id = body.user_id
    if not user_id:
        target = (body.email or "").strip().lower()
        if not target:
            raise HTTPException(status_code=400, detail="email ou user_id requis")
        prof = await get_profile_by_email(target)
        if prof:
            user_id = prof["id"]
        else:
            au = next((u for u in await list_auth_users() if (u.get("email") or "").lower() == target), None)
            if not au:
                raise HTTPException(status_code=404, detail="Compte introuvable pour cet email")
            user_id = au["id"]
            await upsert_profile({"id": user_id, "email": target})
    # ref unique → évite un double crédit en cas de double-clic immédiat
    ref = f"offered:{user_id}:{int(datetime.now(timezone.utc).timestamp())}"
    bal = await _add_credits(user_id, int(body.credits), "offered", ref=ref,
                             note=body.note or "Crédits offerts (admin)",
                             expires_months=await _credit_validity_months())
    return {"ok": True, "user_id": user_id, "credits": body.credits, "balance": bal}

@app.get("/admin/credit-offers")
async def admin_credit_offers(authorization: Optional[str] = Header(default=None)):
    """Historique des crédits offerts (qui, combien, quand, note) — enrichi de l'email."""
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/credit_ledger",
            headers=_service_headers(),
            params={"reason": "eq.offered", "select": "id,user_id,delta,note,created_at,expires_at",
                    "order": "created_at.desc", "limit": "200"},
        )
    rows = resp.json() if resp.status_code == 200 else []
    profiles = await fetch_profiles_map()
    for r in rows:
        r["email"] = (profiles.get(r.get("user_id")) or {}).get("email")
    return {"offers": rows}

# ── Crédits offerts : éditer / supprimer une entrée (admin) ───────────────────
class CreditGrantPatch(BaseModel):
    amount: Optional[int] = None
    note: Optional[str] = None

@app.get("/admin/credit-grants")
async def admin_credit_grants(authorization: Optional[str] = Header(default=None)):
    """Liste des crédits offerts (id, email, montant, note, date) — éditable/supprimable."""
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/credit_ledger", headers=_service_headers(),
                                params={"reason": "eq.offered", "select": "id,user_id,delta,note,created_at",
                                        "order": "created_at.desc", "limit": "300"})
    rows = resp.json() if resp.status_code == 200 else []
    profiles = await fetch_profiles_map()
    grants = [{"id": r.get("id"), "email": (profiles.get(r.get("user_id")) or {}).get("email"),
               "amount": r.get("delta"), "note": r.get("note"), "created_at": r.get("created_at")} for r in rows]
    return {"grants": grants}

@app.patch("/admin/credit-grants/{grant_id}")
async def admin_update_grant(grant_id: int, body: CreditGrantPatch, authorization: Optional[str] = Header(default=None)):
    """Modifie le montant (delta) et/ou la note d'un crédit offert."""
    await require_admin(authorization)
    patch: Dict[str, Any] = {}
    if body.amount is not None:
        patch["delta"] = int(body.amount)
    if body.note is not None:
        patch["note"] = body.note
    if not patch:
        return {"ok": True}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(f"{SUPABASE_URL}/rest/v1/credit_ledger", headers=_service_headers(),
                                  params={"id": f"eq.{grant_id}", "reason": "eq.offered"}, json=patch)
    return {"ok": resp.status_code in (200, 204)}

@app.delete("/admin/credit-grants/{grant_id}")
async def admin_delete_grant(grant_id: int, authorization: Optional[str] = Header(default=None)):
    """Supprime une entrée de crédits offerts."""
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(f"{SUPABASE_URL}/rest/v1/credit_ledger", headers=_service_headers(),
                                   params={"id": f"eq.{grant_id}", "reason": "eq.offered"})
    return {"ok": resp.status_code in (200, 204)}

# ── Essai gratuit → paiement automatique (réglage admin) ──────────────────────
class TrialConfigBody(BaseModel):
    trial_days: int
    auto_charge_enabled: bool

@app.get("/admin/trial-config")
async def admin_get_trial_config(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    s = await get_pricing_settings()
    return {"trial_days": int(s.get("trial_days") or 3),
            "auto_charge_enabled": bool(s.get("auto_charge_enabled"))}

@app.post("/admin/trial-config")
async def admin_save_trial_config(body: TrialConfigBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    days = max(0, min(90, int(body.trial_days)))
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(f"{SUPABASE_URL}/rest/v1/pricing_settings",
                                  headers=_service_headers({"Prefer": "return=minimal"}),
                                  params={"id": "eq.default"},
                                  json={"trial_days": days, "auto_charge_enabled": bool(body.auto_charge_enabled),
                                        "updated_at": datetime.now(timezone.utc).isoformat()})
    # TODO (flux récurrent Stripe) : à l'expiration de l'essai, créer un abonnement Stripe récurrent
    #   (mode='subscription') pour les coachs concernés. Base prête ; activation via auto_charge_enabled.
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Échec d'enregistrement de l'essai")
    return {"ok": True}

@app.get("/admin/credit-config")
async def admin_credit_config(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    return {"packs": await get_credit_packs(active_only=False), "settings": await get_pricing_settings()}

@app.post("/admin/credit-packs")
async def admin_save_pack(body: PackBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    if body.audience not in ("participant", "creator"):
        raise HTTPException(status_code=400, detail="Audience invalide")
    row = {"name": body.name, "credits": body.credits, "price_chf": body.price_chf,
           "is_highlighted": body.is_highlighted, "audience": body.audience,
           "sort": body.sort, "active": body.active, "updated_at": datetime.now(timezone.utc).isoformat()}
    async with httpx.AsyncClient(timeout=10) as client:
        if body.id:
            resp = await client.patch(f"{SUPABASE_URL}/rest/v1/credit_packs",
                                      headers=_service_headers({"Prefer": "return=representation"}),
                                      params={"id": f"eq.{body.id}"}, json=row)
        else:
            resp = await client.post(f"{SUPABASE_URL}/rest/v1/credit_packs",
                                     headers=_service_headers({"Prefer": "return=representation"}), json=row)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Échec d'enregistrement du pack")
    data = resp.json()
    return {"ok": True, "pack": data[0] if isinstance(data, list) and data else data}

@app.delete("/admin/credit-packs/{pack_id}")
async def admin_delete_pack(pack_id: int, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(f"{SUPABASE_URL}/rest/v1/credit_packs",
                                   headers=_service_headers(), params={"id": f"eq.{pack_id}"})
    return {"ok": resp.status_code in (200, 204)}

@app.post("/admin/pricing-settings")
async def admin_save_pricing_settings(body: PricingSettingsBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k in ("services_shown", "offers", "cost_join", "cost_host", "cost_record_transcribe", "credit_validity_months", "signup_free_credits"):
        v = getattr(body, k)
        if v is not None:
            patch[k] = v
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(f"{SUPABASE_URL}/rest/v1/pricing_settings",
                                  headers=_service_headers({"Prefer": "return=representation"}),
                                  params={"id": "eq.default"}, json=patch)
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Échec d'enregistrement des réglages")
    return {"ok": True, "settings": await get_pricing_settings()}


# =========================================================================== #
# 🎟️ BILLETTERIE COACH — sessions payantes (CHF) + PORTEFEUILLE (style Spordateur)
#   Coexiste avec les crédits. Les billets sont payés sur le compte plateforme
#   (PAS de Stripe Connect). La part coach (prix - commission) alimente son SOLDE ;
#   le coach renseigne son IBAN et DEMANDE des virements, l'admin les traite à la main.
#   Commission/offre/prix ENTIÈREMENT éditables par l'admin.
# =========================================================================== #
class SessionConfigBody(BaseModel):
    session_id: str
    mode: str                        # open | paid | private
    price_chf: Optional[float] = None
    capacity: Optional[int] = None

class BuyTicketBody(BaseModel):
    session_id: str

class CoachBankBody(BaseModel):
    iban: str
    holder: str

class CommissionSettingsBody(BaseModel):
    commission_percent: Optional[float] = None
    fees_included: Optional[bool] = None
    launch_offer: Optional[Dict[str, Any]] = None
    price_min_chf: Optional[float] = None
    price_max_chf: Optional[float] = None
    coach_sub_price_chf: Optional[float] = None   # prix de l'abo « Coach Illimité » (CHF/mois)


_COMMISSION_DEFAULTS = {
    "commission_percent": 15, "fees_included": True,
    "launch_offer": {"active": True, "percent": 0, "scope": "first_month", "days": 30},
    "price_min_chf": 5, "price_max_chf": 500, "currency": "CHF",
    "coach_sub_price_chf": 99.99,
}

async def get_commission_settings() -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/commission_settings",
                                headers=_service_headers(), params={"id": "eq.default", "select": "*"})
    if resp.status_code == 200 and resp.json():
        row = resp.json()[0]
        if row.get("coach_sub_price_chf") is None:
            row["coach_sub_price_chf"] = _COMMISSION_DEFAULTS["coach_sub_price_chf"]
        return row
    return dict(_COMMISSION_DEFAULTS)

async def get_coach_payment_type(uid: str) -> str:
    """Type de paiement du coach (admin) : 'subscription' (défaut) | 'commission'."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/profiles", headers=_service_headers(),
                                params={"id": f"eq.{uid}", "select": "coach_payment_type"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0].get("coach_payment_type") or "subscription"
    return "subscription"

async def get_coach_subscription(uid: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/coach_subscriptions", headers=_service_headers(),
                                params={"user_id": f"eq.{uid}", "select": "*"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None

def _subscription_active(sub: Optional[Dict[str, Any]]) -> bool:
    if not sub:
        return False
    if sub.get("status") not in ("active", "trialing"):
        return False
    end = sub.get("current_period_end")
    if not end:
        return True
    try:
        return datetime.fromisoformat(str(end).replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except Exception:  # noqa: BLE001
        return True

async def _get_comp_access(uid: str) -> tuple:
    """(comp_access_plan, comp_access_until) du profil — accès accordé par l'admin."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/profiles", headers=_service_headers(),
                                params={"id": f"eq.{uid}", "select": "comp_access_plan,comp_access_until"})
    if resp.status_code == 200 and resp.json():
        r = resp.json()[0]
        return r.get("comp_access_plan"), r.get("comp_access_until")
    return None, None

def _comp_access_active(plan: Optional[str], until: Optional[str]) -> bool:
    """Un accès admin (pro/enterprise) non expiré = coach ILLIMITÉ."""
    if plan not in ("pro", "enterprise"):
        return False
    if not until:
        return True
    try:
        return datetime.fromisoformat(str(until).replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except Exception:  # noqa: BLE001
        return True

async def is_coach_unlimited(uid: str) -> bool:
    """Crédits ILLIMITÉS si : accès admin actif (comp_access pro/enterprise), OU coach 'subscription' avec abo actif.
    ⚠️ Un accès accordé par l'admin (abo illimité 99.99) débloque donc directement les crédits illimités."""
    plan, until = await _get_comp_access(uid)
    if _comp_access_active(plan, until):
        return True
    if await get_coach_payment_type(uid) != "subscription":
        return False
    return _subscription_active(await get_coach_subscription(uid))

async def upsert_coach_subscription(uid: str, patch: Dict[str, Any]) -> None:
    patch = {"user_id": uid, "updated_at": datetime.now(timezone.utc).isoformat(), **patch}
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(f"{SUPABASE_URL}/rest/v1/coach_subscriptions",
                          headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                          params={"on_conflict": "user_id"}, json=patch)

async def find_coach_sub_by_stripe_id(sub_id: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/coach_subscriptions", headers=_service_headers(),
                                params={"stripe_subscription_id": f"eq.{sub_id}", "select": "*"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None

async def _sync_coach_subscription(uid: str, sub_id: Optional[str]) -> None:
    """Récupère l'abo Stripe et enregistre statut + fin de période (idempotent)."""
    status, period_end = "active", None
    if sub_id:
        try:
            sub = stripe.Subscription.retrieve(sub_id)
            status = sub.get("status") or "active"
            cpe = sub.get("current_period_end")
            if cpe:
                period_end = datetime.fromtimestamp(cpe, tz=timezone.utc).isoformat()
        except Exception as exc:  # noqa: BLE001
            logger.warning("retrieve abo coach %s échec: %s", sub_id, exc)
    await upsert_coach_subscription(uid, {"stripe_subscription_id": sub_id,
                                          "status": status, "current_period_end": period_end})

async def get_coach_wallet(uid: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/coach_wallet",
                                headers=_service_headers(), params={"user_id": f"eq.{uid}", "select": "*"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return {"user_id": uid, "balance_chf": 0, "total_revenue_chf": 0, "first_sale_at": None}

async def get_coach_bank(uid: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/coach_bank",
                                headers=_service_headers(), params={"user_id": f"eq.{uid}", "select": "*"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None

async def wallet_add(uid: str, delta: float, reason: str, ref: Optional[str], is_revenue: bool) -> None:
    """Mouvement de portefeuille atomique + idempotent (via RPC wallet_add)."""
    await _rpc("wallet_add", {"p_user": uid, "p_delta": round(delta, 2),
                              "p_reason": reason, "p_ref": ref, "p_is_revenue": is_revenue})

async def get_session_row(session_id: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/playlists", headers=_service_headers(),
                                params={"session_id": f"eq.{session_id}",
                                        "select": "session_id,host_id,mode,price_chf,capacity,record_enabled"})
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None

async def count_paid_tickets(session_id: str) -> int:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/tickets",
                                headers=_service_headers({"Prefer": "count=exact"}),
                                params={"session_id": f"eq.{session_id}", "status": "eq.paid",
                                        "select": "id", "limit": "1"})
    rng = resp.headers.get("content-range", "")
    if "/" in rng:
        try:
            return int(rng.split("/")[-1])
        except Exception:  # noqa: BLE001
            pass
    return len(resp.json()) if resp.status_code == 200 else 0

async def has_valid_ticket(session_id: str, uid: str) -> bool:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/tickets", headers=_service_headers(),
                                params={"session_id": f"eq.{session_id}", "buyer_user_id": f"eq.{uid}",
                                        "status": "eq.paid", "select": "id", "limit": "1"})
    return resp.status_code == 200 and bool(resp.json())

async def pending_payout_total(uid: str) -> float:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/payout_requests", headers=_service_headers(),
                                params={"user_id": f"eq.{uid}", "status": "eq.requested",
                                        "select": "amount_chf"})
    rows = resp.json() if resp.status_code == 200 else []
    return round(sum(float(r.get("amount_chf") or 0) for r in rows), 2)

def _launch_active(settings: Dict[str, Any], wallet: Dict[str, Any]) -> bool:
    """Offre de lancement active pour CE coach (ex. 0% pendant ses 30 premiers jours)."""
    lo = settings.get("launch_offer") or {}
    if not lo.get("active"):
        return False
    days = int(lo.get("days") or 30)
    first = (wallet or {}).get("first_sale_at")
    if not first:
        return True  # avant la 1re vente → dans la fenêtre
    try:
        start = datetime.fromisoformat(str(first).replace("Z", "+00:00"))
        return datetime.now(timezone.utc) < start + timedelta(days=days)
    except Exception:  # noqa: BLE001
        return True

async def compute_commission(price_chf: float, coach_uid: str) -> Dict[str, Any]:
    settings = await get_commission_settings()
    # 💎 Coach abonné « Illimité » → 0% de commission (il garde 100% de ses ventes).
    if await is_coach_unlimited(coach_uid):
        return {"percent": 0.0, "commission_chf": 0.0, "net_chf": round(price_chf, 2),
                "fees_included": bool(settings.get("fees_included", True))}
    wallet = await get_coach_wallet(coach_uid)
    pct = float(settings.get("commission_percent") or 0)
    if _launch_active(settings, wallet):
        pct = float((settings.get("launch_offer") or {}).get("percent") or 0)
    commission = round(price_chf * pct / 100.0, 2)
    return {"percent": pct, "commission_chf": commission, "net_chf": round(price_chf - commission, 2),
            "fees_included": bool(settings.get("fees_included", True))}

async def _create_ticket_from_session(obj: Dict[str, Any], meta: Dict[str, Any], event_id: Optional[str]) -> None:
    """Billet 'paid' depuis un Checkout terminé (idempotent) + crédite le SOLDE du coach."""
    if obj.get("payment_status") not in ("paid", None):
        return
    stripe_session_id = obj.get("id")
    coach_uid = meta.get("coach_user_id")
    price = float(meta.get("price_chf") or 0)
    commission = float(meta.get("commission_chf") or 0)
    net = round(price - commission, 2)
    cust = obj.get("customer_details") if isinstance(obj.get("customer_details"), dict) else None
    row = {
        "session_id": meta.get("session_id"),
        "buyer_user_id": obj.get("client_reference_id") or meta.get("buyer_user_id"),
        "buyer_email": (cust or {}).get("email") or obj.get("customer_email"),
        "coach_user_id": coach_uid,
        "stripe_session_id": stripe_session_id,
        "stripe_payment_intent": obj.get("payment_intent"),
        "amount_chf": price,
        "commission_chf": commission,
        "commission_percent": float(meta.get("commission_percent") or 0),
        "status": "paid",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/tickets",
            headers=_service_headers({"Prefer": "resolution=ignore-duplicates,return=minimal"}),
            params={"on_conflict": "stripe_session_id"}, json=row)
    # Crédite le portefeuille du coach (net = prix - commission), idempotent sur l'event Stripe.
    if coach_uid and net > 0 and resp.status_code in (200, 201, 204):
        await wallet_add(coach_uid, net, "sale", f"sale:{stripe_session_id}", True)
    elif resp.status_code not in (200, 201, 204, 409):
        logger.error("insert billet HTTP %s: %s", resp.status_code, (resp.text or "")[:300])


@app.get("/billetterie/config")
async def billetterie_config():
    """Réglages publics (devise, garde-fous prix) pour l'UI coach."""
    s = await get_commission_settings()
    return {"currency": s.get("currency", "CHF"),
            "price_min_chf": s.get("price_min_chf", 5),
            "price_max_chf": s.get("price_max_chf", 500),
            "commission_percent": s.get("commission_percent", 15),
            "coach_sub_price_chf": s.get("coach_sub_price_chf", 99.99)}

@app.get("/session/info/{session_id}")
async def session_info(session_id: str):
    """Infos d'accès publiques d'une session (mode/prix/capacité/places restantes)."""
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    row = await get_session_row(session_id)
    mode = (row or {}).get("mode") or "open"
    price = (row or {}).get("price_chf")
    capacity = (row or {}).get("capacity")
    sold = await count_paid_tickets(session_id) if mode == "paid" else 0
    sold_out = bool(capacity) and mode == "paid" and sold >= int(capacity)
    return {"mode": mode, "price_chf": price, "capacity": capacity,
            "sold": sold, "sold_out": sold_out, "currency": "CHF",
            "record_enabled": bool((row or {}).get("record_enabled"))}

# ---- Coach : PLAN (type de paiement + abonnement « Coach Illimité ») ----------
@app.get("/coach/plan")
async def coach_plan(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    settings = await get_commission_settings()
    ptype = await get_coach_payment_type(uid)
    sub = await get_coach_subscription(uid)
    plan, until = await _get_comp_access(uid)
    comp_active = _comp_access_active(plan, until)
    active = _subscription_active(sub) or comp_active  # accès admin = abo actif
    unlimited = await is_coach_unlimited(uid)
    return {
        "payment_type": ptype,
        "unlimited": unlimited,
        "subscription_active": active,
        "subscription_status": (sub or {}).get("status") or ("active" if comp_active else None),
        "current_period_end": (sub or {}).get("current_period_end"),
        "sub_price_chf": float(settings.get("coach_sub_price_chf") or 99.99),
        "commission_percent": float(settings.get("commission_percent") or 0),
        "currency": "CHF",
    }

@app.post("/coach/subscribe")
async def coach_subscribe(authorization: Optional[str] = Header(default=None)):
    """Checkout Stripe RÉCURRENT (mode subscription) pour l'abo « Coach Illimité » 99.99 CHF/mois.
    Réservé à ce plan coach — le grand public reste en ACHAT UNIQUE de crédits."""
    if not await apply_stripe_key():
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    user = await get_user_from_token(authorization)
    uid, email = user.get("id"), user.get("email")
    settings = await get_commission_settings()
    price = float(settings.get("coach_sub_price_chf") or 99.99)
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price_data": {"currency": "chf", "unit_amount": round(price * 100),
                                    "recurring": {"interval": "month"},
                                    "product_data": {"name": "Coach Illimité — BoostTribe"}},
                     "quantity": 1}],
        success_url=f"{FRONTEND_URL}/wallet?coach_sub=success",
        cancel_url=f"{FRONTEND_URL}/wallet?coach_sub=canceled",
        client_reference_id=uid,
        customer_email=email,
        metadata={"kind": "coach_sub", "user_id": uid},
        subscription_data={"metadata": {"kind": "coach_sub", "user_id": uid}},
    )
    return {"url": session.url}

# ---- Coach : PORTEFEUILLE (solde / revenus / IBAN / demandes de virement) ----
@app.get("/coach/wallet")
async def coach_wallet(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    w = await get_coach_wallet(uid)
    bank = await get_coach_bank(uid)
    pending = await pending_payout_total(uid)
    async with httpx.AsyncClient(timeout=10) as client:
        pr = await client.get(f"{SUPABASE_URL}/rest/v1/payout_requests", headers=_service_headers(),
                              params={"user_id": f"eq.{uid}", "select": "*",
                                      "order": "created_at.desc", "limit": "100"})
        lg = await client.get(f"{SUPABASE_URL}/rest/v1/wallet_ledger", headers=_service_headers(),
                              params={"user_id": f"eq.{uid}", "select": "*",
                                      "order": "created_at.desc", "limit": "100"})
    requests = pr.json() if pr.status_code == 200 else []
    balance = round(float(w.get("balance_chf") or 0), 2)
    available = round(balance - pending, 2)
    return {
        "balance_chf": balance,
        "available_chf": max(available, 0),
        "total_revenue_chf": round(float(w.get("total_revenue_chf") or 0), 2),
        "pending_chf": pending,
        "payout_count": len(requests),
        "iban": (bank or {}).get("iban"),
        "holder": (bank or {}).get("holder"),
        "has_iban": bool((bank or {}).get("iban")),
        "requests": requests,
        "ledger": lg.json() if lg.status_code == 200 else [],
    }

@app.post("/coach/bank")
async def coach_bank_save(body: CoachBankBody, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    iban = re.sub(r"\s+", "", body.iban or "").upper()
    if len(iban) < 15 or len(iban) > 34 or not re.match(r"^[A-Z]{2}[0-9A-Z]+$", iban):
        raise HTTPException(status_code=400, detail="IBAN invalide")
    if not (body.holder or "").strip():
        raise HTTPException(status_code=400, detail="Titulaire du compte requis")
    patch = {"user_id": uid, "iban": iban, "holder": body.holder.strip(),
             "updated_at": datetime.now(timezone.utc).isoformat()}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{SUPABASE_URL}/rest/v1/coach_bank",
                                 headers=_service_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                                 params={"on_conflict": "user_id"}, json=patch)
    if resp.status_code not in (200, 201, 204):
        raise HTTPException(status_code=500, detail="Échec d'enregistrement de l'IBAN")
    return {"ok": True, "iban": iban, "holder": patch["holder"]}

@app.post("/coach/payout-request")
async def coach_payout_request(authorization: Optional[str] = Header(default=None)):
    """Le coach demande un virement de tout son solde disponible (traité ensuite par l'admin)."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    bank = await get_coach_bank(uid)
    if not bank or not bank.get("iban"):
        raise HTTPException(status_code=400, detail="Renseignez d'abord votre IBAN")
    w = await get_coach_wallet(uid)
    pending = await pending_payout_total(uid)
    available = round(float(w.get("balance_chf") or 0) - pending, 2)
    if available <= 0:
        raise HTTPException(status_code=400, detail="Aucun solde à virer")
    row = {"user_id": uid, "amount_chf": available, "iban": bank["iban"], "status": "requested",
           "created_at": datetime.now(timezone.utc).isoformat()}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{SUPABASE_URL}/rest/v1/payout_requests",
                                 headers=_service_headers({"Prefer": "return=representation"}), json=row)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Échec de la demande de virement")
    return {"ok": True, "amount_chf": available}

@app.get("/coach/sales")
async def coach_sales(authorization: Optional[str] = Header(default=None)):
    """Ventes du coach : billets vendus + totaux."""
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/tickets", headers=_service_headers(),
                                params={"coach_user_id": f"eq.{uid}", "select": "*",
                                        "order": "created_at.desc", "limit": "300"})
    rows = resp.json() if resp.status_code == 200 else []
    paid = [t for t in rows if t.get("status") == "paid"]
    gross = round(sum(float(t.get("amount_chf") or 0) for t in paid), 2)
    commission = round(sum(float(t.get("commission_chf") or 0) for t in paid), 2)
    return {"tickets": rows, "count_paid": len(paid), "gross_chf": gross,
            "commission_chf": commission, "net_chf": round(gross - commission, 2)}

# ---- Configuration d'accès d'une session (hôte) ----------------------------
@app.post("/session/configure")
async def session_configure(body: SessionConfigBody, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    uid = user.get("id")
    if not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    if body.mode not in ("open", "paid", "private"):
        raise HTTPException(status_code=400, detail="Mode invalide")
    row = await get_session_authz(body.session_id)
    if row and row.get("host_id") and row.get("host_id") != uid:
        raise HTTPException(status_code=403, detail="Seul l'hôte peut configurer la session")
    patch: Dict[str, Any] = {"mode": body.mode}
    if body.mode == "paid":
        s = await get_commission_settings()
        # 💳 Les sessions « Payante (billet CHF) » (argent via la plateforme) sont réservées aux coachs
        #    en mode COMMISSION. En « abonnement », le coach encaisse ses élèves lui-même (hors plateforme)
        #    via son lien/QR privé → mode Payante interdit.
        if await get_coach_payment_type(uid) != "commission":
            raise HTTPException(status_code=403,
                                detail="Les sessions payantes (billet CHF) sont réservées au mode commission. "
                                       "En abonnement, encaisse tes élèves via ton lien/QR privé (session privée).")
        if body.price_chf is None:
            raise HTTPException(status_code=400, detail="Prix requis")
        pmin, pmax = float(s.get("price_min_chf") or 0), float(s.get("price_max_chf") or 1e9)
        if not (pmin <= float(body.price_chf) <= pmax):
            raise HTTPException(status_code=400, detail=f"Prix hors limites ({pmin}–{pmax} CHF)")
        patch["price_chf"] = round(float(body.price_chf), 2)
        patch["capacity"] = int(body.capacity) if body.capacity else None
    else:
        patch["price_chf"] = None
        patch["capacity"] = None
    if not (row and row.get("host_id")):
        patch["host_id"] = uid
    await upsert_playlist_fields(body.session_id, patch)
    return {"ok": True, "mode": body.mode, "price_chf": patch.get("price_chf"), "capacity": patch.get("capacity")}

# ---- Participant : achat d'une place (billet) — Checkout compte plateforme ---
@app.post("/tickets/buy")
async def buy_ticket(body: BuyTicketBody, authorization: Optional[str] = Header(default=None)):
    if not await apply_stripe_key():
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    user = await get_user_from_token(authorization)
    uid, email = user.get("id"), user.get("email")
    if not SESSION_ID_RE.match(body.session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    row = await get_session_row(body.session_id)
    if not row or row.get("mode") != "paid":
        raise HTTPException(status_code=400, detail="Cette session n'est pas payante")
    if await has_valid_ticket(body.session_id, uid):
        return {"already": True}
    capacity = row.get("capacity")
    if capacity and await count_paid_tickets(body.session_id) >= int(capacity):
        raise HTTPException(status_code=409, detail="Complet (toutes les places sont vendues)")
    coach_uid = row.get("host_id")
    price = float(row.get("price_chf") or 0)
    if price <= 0 or not coach_uid:
        raise HTTPException(status_code=400, detail="Session payante mal configurée")
    comm = await compute_commission(price, coach_uid)
    amount_cents = round(price * 100)
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{"price_data": {"currency": "chf", "unit_amount": amount_cents,
                                    "product_data": {"name": f"Place — live BoostTribe ({body.session_id})"}},
                     "quantity": 1}],
        success_url=f"{FRONTEND_URL}/session/{body.session_id}?ticket=success",
        cancel_url=f"{FRONTEND_URL}/session/{body.session_id}?ticket=canceled",
        client_reference_id=uid,
        customer_email=email,
        metadata={"kind": "ticket", "session_id": body.session_id, "buyer_user_id": uid,
                  "coach_user_id": coach_uid, "price_chf": str(price),
                  "commission_chf": str(comm["commission_chf"]), "commission_percent": str(comm["percent"])},
    )
    return {"url": session.url}

@app.get("/tickets/check/{session_id}")
async def ticket_check(session_id: str, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Identifiant de session invalide")
    return {"has_ticket": await has_valid_ticket(session_id, user.get("id"))}

@app.get("/tickets/me")
async def tickets_me(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/tickets", headers=_service_headers(),
                                params={"buyer_user_id": f"eq.{user.get('id')}", "select": "*",
                                        "order": "created_at.desc", "limit": "200"})
    return {"tickets": resp.json() if resp.status_code == 200 else []}

# ---- Admin : Billetterie & Commission --------------------------------------
@app.get("/admin/commission-config")
async def admin_commission_config(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    return {"settings": await get_commission_settings()}

@app.post("/admin/commission-settings")
async def admin_save_commission(body: CommissionSettingsBody, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k in ("commission_percent", "fees_included", "launch_offer", "price_min_chf", "price_max_chf", "coach_sub_price_chf"):
        v = getattr(body, k)
        if v is not None:
            patch[k] = v
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(f"{SUPABASE_URL}/rest/v1/commission_settings",
                                  headers=_service_headers({"Prefer": "return=representation"}),
                                  params={"id": "eq.default"}, json=patch)
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Échec d'enregistrement")
    return {"ok": True, "settings": await get_commission_settings()}

class CoachPaymentTypeBody(BaseModel):
    user_id: str
    payment_type: str    # subscription | commission

@app.post("/admin/coach-payment-type")
async def admin_set_coach_payment_type(body: CoachPaymentTypeBody, authorization: Optional[str] = Header(default=None)):
    """L'admin choisit le type de paiement d'un coach (défaut 'subscription')."""
    await require_admin(authorization)
    if body.payment_type not in ("subscription", "commission"):
        raise HTTPException(status_code=400, detail="Type invalide")
    await update_profile(body.user_id, {"coach_payment_type": body.payment_type})
    return {"ok": True, "user_id": body.user_id, "payment_type": body.payment_type}

@app.get("/admin/coaches")
async def admin_coaches(authorization: Optional[str] = Header(default=None)):
    """Liste des comptes avec type de paiement + statut d'abonnement (gestion coach)."""
    await require_admin(authorization)
    auth_users = await list_auth_users()
    profiles = await fetch_profiles_map()
    async with httpx.AsyncClient(timeout=10) as client:
        sresp = await client.get(f"{SUPABASE_URL}/rest/v1/coach_subscriptions",
                                 headers=_service_headers(), params={"select": "*"})
    subs = {s.get("user_id"): s for s in (sresp.json() if sresp.status_code == 200 else [])}
    rows: List[Dict[str, Any]] = []
    for u in auth_users:
        uid = u.get("id")
        prof = profiles.get(uid, {})
        sub = subs.get(uid)
        rows.append({
            "id": uid,
            "email": u.get("email") or prof.get("email"),
            "full_name": prof.get("full_name"),
            "coach_payment_type": prof.get("coach_payment_type") or "subscription",
            "subscription_status": (sub or {}).get("status"),
            "subscription_active": _subscription_active(sub),
            "current_period_end": (sub or {}).get("current_period_end"),
        })
    rows.sort(key=lambda r: r.get("email") or "")
    return {"coaches": rows}

@app.get("/admin/billetterie/sales")
async def admin_billetterie_sales(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/tickets", headers=_service_headers(),
                                params={"select": "*", "order": "created_at.desc", "limit": "500"})
    rows = resp.json() if resp.status_code == 200 else []
    profiles = await fetch_profiles_map()
    for r in rows:
        r["coach_email"] = (profiles.get(r.get("coach_user_id")) or {}).get("email")
        r["buyer_email_resolved"] = r.get("buyer_email") or (profiles.get(r.get("buyer_user_id")) or {}).get("email")
    paid = [t for t in rows if t.get("status") == "paid"]
    return {"sales": rows, "count_paid": len(paid),
            "gross_chf": round(sum(float(t.get("amount_chf") or 0) for t in paid), 2),
            "commission_chf": round(sum(float(t.get("commission_chf") or 0) for t in paid), 2)}

# ---- Admin : VIREMENTS (payouts) -------------------------------------------
@app.get("/admin/payouts")
async def admin_payouts(authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/payout_requests", headers=_service_headers(),
                                params={"select": "*", "order": "created_at.desc", "limit": "500"})
    rows = resp.json() if resp.status_code == 200 else []
    profiles = await fetch_profiles_map()
    for r in rows:
        prof = profiles.get(r.get("user_id")) or {}
        r["coach_email"] = prof.get("email")
        r["coach_name"] = prof.get("full_name")
    return {"payouts": rows,
            "pending_total_chf": round(sum(float(r.get("amount_chf") or 0)
                                           for r in rows if r.get("status") == "requested"), 2)}

@app.post("/admin/payouts/{payout_id}/pay")
async def admin_payout_pay(payout_id: int, authorization: Optional[str] = Header(default=None)):
    """Marque un virement comme payé → déduit le solde du coach (mouvement withdrawal)."""
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{SUPABASE_URL}/rest/v1/payout_requests", headers=_service_headers(),
                                params={"id": f"eq.{payout_id}", "select": "*"})
    rows = resp.json() if resp.status_code == 200 else []
    if not rows:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    pr = rows[0]
    if pr.get("status") != "requested":
        raise HTTPException(status_code=400, detail="Demande déjà traitée")
    await wallet_add(pr["user_id"], -float(pr["amount_chf"]), "withdrawal", f"payout:{payout_id}", False)
    async with httpx.AsyncClient(timeout=10) as client:
        upd = await client.patch(f"{SUPABASE_URL}/rest/v1/payout_requests",
                                 headers=_service_headers({"Prefer": "return=minimal"}),
                                 params={"id": f"eq.{payout_id}"},
                                 json={"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()})
    if upd.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Échec de la mise à jour")
    return {"ok": True}

@app.post("/admin/payouts/{payout_id}/reject")
async def admin_payout_reject(payout_id: int, authorization: Optional[str] = Header(default=None)):
    await require_admin(authorization)
    async with httpx.AsyncClient(timeout=10) as client:
        upd = await client.patch(f"{SUPABASE_URL}/rest/v1/payout_requests",
                                 headers=_service_headers({"Prefer": "return=minimal"}),
                                 params={"id": f"eq.{payout_id}", "status": "eq.requested"},
                                 json={"status": "rejected"})
    if upd.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Échec de la mise à jour")
    return {"ok": True}


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
            meta = obj.get("metadata") or {}
            user_id = obj.get("client_reference_id") or meta.get("user_id")
            # 💳 NOUVEAU MODÈLE : achat de PACK de CRÉDITS (mode payment). Idempotent sur l'event id.
            credits = meta.get("credits")
            if user_id and credits:
                try:
                    months = await _credit_validity_months()
                    await _add_credits(
                        user_id, int(credits), "purchase",
                        ref=f"stripe:{event.get('id')}",
                        note=f"Achat pack {meta.get('pack_id')}",
                        expires_months=months,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.error("crédit achat échoué (user=%s): %s", user_id, exc)
            # 🎟️ BILLETTERIE : achat d'une PLACE payante (destination charge vers le coach).
            if meta.get("kind") == "ticket":
                try:
                    await _create_ticket_from_session(obj, meta, event.get("id"))
                except Exception as exc:  # noqa: BLE001
                    logger.error("billet création échouée (session=%s): %s", meta.get("session_id"), exc)
            # 💎 ABONNEMENT COACH « Illimité » (mode subscription) → enregistre l'abo actif.
            if meta.get("kind") == "coach_sub" and user_id:
                try:
                    await _sync_coach_subscription(user_id, obj.get("subscription"))
                except Exception as exc:  # noqa: BLE001
                    logger.error("abo coach échoué (user=%s): %s", user_id, exc)
            # (Ancien modèle abonnement public — conservé pour compat, plus utilisé par le front)
            plan = meta.get("plan")
            if user_id and plan in PLANS and not credits:
                await update_profile(
                    user_id,
                    {
                        "subscription_status": plan,
                        "stripe_customer_id": obj.get("customer"),
                        "stripe_subscription_id": obj.get("subscription"),
                    },
                )

        elif etype in ("customer.subscription.created", "customer.subscription.updated"):
            sub_id = obj.get("id")
            status = obj.get("status")
            sub_meta = obj.get("metadata") or {}
            # 💎 Abonnement COACH : maj statut + fin de période (par metadata ou par id connu).
            coach_existing = await find_coach_sub_by_stripe_id(sub_id)
            if sub_meta.get("kind") == "coach_sub" or coach_existing:
                cuid = sub_meta.get("user_id") or (coach_existing or {}).get("user_id")
                if cuid:
                    cpe = obj.get("current_period_end")
                    period_end = datetime.fromtimestamp(cpe, tz=timezone.utc).isoformat() if cpe else None
                    await upsert_coach_subscription(cuid, {"stripe_subscription_id": sub_id,
                                                           "status": status, "current_period_end": period_end})
                return {"received": True}
            # (Ancien modèle abonnement public — conservé pour compat)
            settings = await get_site_settings()
            items = (obj.get("items") or {}).get("data") or []
            price_id = items[0]["price"]["id"] if items else None
            plan = sub_meta.get("plan") or _plan_from_price_id(price_id, settings)
            user_id = sub_meta.get("user_id")

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
            # 💎 Abonnement COACH supprimé → statut canceled (crédits illimités désactivés).
            coach_existing = await find_coach_sub_by_stripe_id(sub_id)
            if coach_existing:
                await upsert_coach_subscription(coach_existing["user_id"], {"status": "canceled"})
                return {"received": True}
            user_id = (obj.get("metadata") or {}).get("user_id")
            if not user_id:
                prof = await find_profile_by_subscription(sub_id)
                user_id = prof.get("id") if prof else None
            if user_id:
                await update_profile(user_id, {"subscription_status": "none"})

        elif etype == "invoice.paid":
            # 💎 Renouvellement d'abo coach payé → prolonge la période + statut actif.
            sub_id = obj.get("subscription")
            if sub_id and await find_coach_sub_by_stripe_id(sub_id):
                coach = await find_coach_sub_by_stripe_id(sub_id)
                await _sync_coach_subscription(coach["user_id"], sub_id)

        elif etype == "charge.refunded":
            # 🎟️ Remboursement → billet invalidé + ajustement du solde coach (net retiré).
            pi = obj.get("payment_intent")
            if pi:
                async with httpx.AsyncClient(timeout=10) as client:
                    look = await client.get(
                        f"{SUPABASE_URL}/rest/v1/tickets", headers=_service_headers(),
                        params={"stripe_payment_intent": f"eq.{pi}", "status": "eq.paid", "select": "*"})
                    tkts = look.json() if look.status_code == 200 else []
                    if tkts:
                        await client.patch(
                            f"{SUPABASE_URL}/rest/v1/tickets",
                            headers=_service_headers({"Prefer": "return=minimal"}),
                            params={"stripe_payment_intent": f"eq.{pi}", "status": "eq.paid"},
                            json={"status": "refunded"})
                for t in tkts:
                    net = round(float(t.get("amount_chf") or 0) - float(t.get("commission_chf") or 0), 2)
                    if t.get("coach_user_id") and net:
                        await wallet_add(t["coach_user_id"], -net, "refund", f"refund:{pi}:{t.get('id')}", True)

    except Exception as exc:  # noqa: BLE001
        # On log mais on répond 200 pour éviter les replays Stripe en boucle
        logger.error("Webhook handling error (%s): %s", etype, exc)

    return {"received": True}
