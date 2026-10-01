"""
📣 PROMO PARTICIPANT PENDANT LE LIVE — règles PURES (aucun réseau, aucune base).

Un participant prépare une promo (image, titre, texte, lien facultatif), choisit une
durée/tarif fixés par l'hôte, envoie la demande. L'hôte REFUSE (aucun débit) ou ACCEPTE ;
le participant paie alors par le Checkout Stripe EXISTANT (même compte plateforme, même
commission, même portefeuille que la billetterie). Payée, la promo est PRÊTE ; l'hôte la
DIFFUSE quand il veut : le SERVEUR fixe started_at / ends_at (source de vérité), chaque
client n'affiche que le temps RESTANT. Rien n'est remboursé automatiquement (V1).

V1 = hôtes en mode COMMISSION uniquement (seul mode où l'argent transite par la
plateforme). Le mode abonnement se branchera plus tard sur `hote_eligible`.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

# ─── Statuts et transitions (validées CÔTÉ SERVEUR) ────────────────────────────
REQUESTED = "requested"
REJECTED = "rejected"
ACCEPTED = "accepted"
PAYMENT_PENDING = "payment_pending"
PAYMENT_FAILED = "payment_failed"
READY = "ready"                      # payée, en attente de diffusion
BROADCASTING = "broadcasting"
COMPLETED = "completed"
STOPPED_EARLY = "stopped_early"
STATUTS = (REQUESTED, REJECTED, ACCEPTED, PAYMENT_PENDING, PAYMENT_FAILED, READY,
           BROADCASTING, COMPLETED, STOPPED_EARLY)

TRANSITIONS: Dict[str, Tuple[str, ...]] = {
    REQUESTED: (ACCEPTED, REJECTED),
    ACCEPTED: (PAYMENT_PENDING,),
    PAYMENT_PENDING: (READY, PAYMENT_FAILED, PAYMENT_PENDING),
    PAYMENT_FAILED: (PAYMENT_PENDING,),
    READY: (BROADCASTING,),
    BROADCASTING: (COMPLETED, STOPPED_EARLY),
}
# Une demande « ouverte » empêche d'en déposer une autre dans la même session.
OUVERTS = (REQUESTED, ACCEPTED, PAYMENT_PENDING, PAYMENT_FAILED, READY, BROADCASTING)
# Le paiement ne peut être lancé que depuis ces états (jamais avant l'acceptation).
PAYABLES = (ACCEPTED, PAYMENT_PENDING, PAYMENT_FAILED)


def transition_autorisee(depuis: str, vers: str) -> bool:
    return vers in TRANSITIONS.get(str(depuis or ""), ())


# ─── Bornes TECHNIQUES (pas une politique commerciale) ─────────────────────────
DUREE_MIN_S = 5
DUREE_MAX_S = 3600
PRIX_MIN = 0.5        # minimum technique Stripe (CHF)
PRIX_MAX = 10000.0
OFFRES_MAX = 20
TITRE_MAX = 60
TEXTE_MAX = 280
URL_MAX = 500
DEVISE = "CHF"


class RegleRefusee(ValueError):
    """Entrée refusée par une règle : le message est destiné à l'écran."""


def valider_offres(brut: Any) -> List[Dict[str, Any]]:
    """Normalise les tarifs de l'hôte : [{id, duree_s, prix, actif}]. Lève RegleRefusee."""
    if brut is None:
        return []
    if not isinstance(brut, list):
        raise RegleRefusee("Tarifs illisibles")
    if len(brut) > OFFRES_MAX:
        raise RegleRefusee(f"{OFFRES_MAX} tarifs au plus")
    sortie, vus = [], set()
    for o in brut:
        if not isinstance(o, dict):
            raise RegleRefusee("Tarif illisible")
        # 01/10 : type EXPLICITE (« free » / « paid ») — défaut « paid » (offres d'avant). Une offre
        # gratuite n'est JAMAIS un « payant à 0 CHF » : le minimum payant reste exigé.
        genre = str(o.get("type") or "paid").strip().lower()
        if genre not in ("free", "paid"):
            raise RegleRefusee("Type d'offre inconnu (gratuit ou payant)")
        try:
            duree = int(o.get("duree_s"))
            prix = 0.0 if genre == "free" else round(float(o.get("prix")), 2)
        except (TypeError, ValueError):
            raise RegleRefusee("Durée et prix doivent être des nombres")
        if isinstance(o.get("duree_s"), bool) or not (DUREE_MIN_S <= duree <= DUREE_MAX_S):
            raise RegleRefusee(f"Durée entre {DUREE_MIN_S} s et {DUREE_MAX_S} s")
        if genre == "paid" and not (PRIX_MIN <= prix <= PRIX_MAX):
            raise RegleRefusee(f"Prix entre {PRIX_MIN:g} et {PRIX_MAX:g} {DEVISE}")
        oid = str(o.get("id") or "").strip()[:40] or uuid.uuid4().hex[:12]
        if not re.match(r"^[A-Za-z0-9_-]{1,40}$", oid) or oid in vus:
            oid = uuid.uuid4().hex[:12]
        vus.add(oid)
        sortie.append({"id": oid, "duree_s": duree, "prix": prix, "actif": o.get("actif") is not False, "type": genre})
    return sortie


def offres_actives(offres: Any) -> List[Dict[str, Any]]:
    try:
        return [o for o in valider_offres(offres) if o["actif"]]
    except RegleRefusee:
        return []


def url_externe(brut: Any) -> Optional[str]:
    """Lien « Découvrir » : http(s) uniquement, sinon None (aucun bouton). Lève si dangereux."""
    s = str(brut or "").strip()
    if not s:
        return None
    if len(s) > URL_MAX:
        raise RegleRefusee("Lien trop long")
    if not re.match(r"^https?://[^\s<>\"'`]+$", s, re.I):
        raise RegleRefusee("Lien invalide : http:// ou https:// uniquement")
    return s


def texte_propre(brut: Any, maxi: int) -> str:
    """Texte brut (jamais du HTML interprété côté client) : espaces normalisés, borné."""
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(brut or ""))
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:maxi]


def valider_demande(corps: Dict[str, Any], offres: Any, media_prefixe: str) -> Dict[str, Any]:
    """Contenu + tarif d'une demande. `media_prefixe` = URL publique du bucket média :
    une image hors de ce stockage (donc non contrôlée par l'upload du backend) est refusée."""
    actives = {o["id"]: o for o in offres_actives(offres)}
    offre = actives.get(str(corps.get("offre_id") or ""))
    if not offre:
        raise RegleRefusee("Ce tarif n'est plus proposé")
    titre = texte_propre(corps.get("titre"), TITRE_MAX)
    texte = texte_propre(corps.get("texte"), TEXTE_MAX)
    if not titre:
        raise RegleRefusee("Titre requis")
    media = str(corps.get("media_url") or "").strip()
    if media and not (media_prefixe and media.startswith(media_prefixe)):
        raise RegleRefusee("Image invalide : utilise l'envoi d'image de la promo")
    # Gratuit / payant : décidé par l'OFFRE DE L'HÔTE (jamais par un champ envoyé par le participant).
    return {"offre_id": offre["id"], "duration_seconds": offre["duree_s"], "price_chf": offre["prix"],
            "gratuit": offre.get("type") == "free",
            "currency": DEVISE, "title": titre, "body": texte, "media_url": media or None,
            "external_url": url_externe(corps.get("lien"))}


# ─── Temps (serveur = source de vérité) ────────────────────────────────────────
def maintenant() -> datetime:
    return datetime.now(timezone.utc)


def lire_instant(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def fenetre_diffusion(duree_s: int, t0: Optional[datetime] = None) -> Tuple[str, str]:
    t0 = t0 or maintenant()
    return t0.isoformat(), (t0 + timedelta(seconds=int(duree_s))).isoformat()


def secondes_restantes(ends_at: Any, t: Optional[datetime] = None) -> int:
    fin = lire_instant(ends_at)
    if not fin:
        return 0
    return max(0, int(round((fin - (t or maintenant())).total_seconds())))


def duree_reellement_diffusee(started_at: Any, duree_s: int, t: Optional[datetime] = None) -> int:
    debut = lire_instant(started_at)
    if not debut:
        return 0
    return max(0, min(int(duree_s), int((( t or maintenant()) - debut).total_seconds())))


def est_terminee(promo: Dict[str, Any], t: Optional[datetime] = None) -> bool:
    return (promo or {}).get("status") == BROADCASTING and secondes_restantes(promo.get("ends_at"), t) <= 0


def hote_eligible(payment_type: Optional[str]) -> bool:
    """V1 : seuls les hôtes en mode COMMISSION encaissent via la plateforme."""
    return payment_type == "commission"


# Mode de la promo pour un hôte donné. « commission » : parcours complet, paiement réel.
# « super_admin » (hotfix 30/09) : le super-admin EXISTANT (ADMIN_EMAILS) voit, configure,
# modère et diffuse ; mais s'il n'est pas en mode commission, AUCUNE destination financière
# n'existe pour lui (même règle que les billets payants, /session/configure) : le paiement
# réel reste fermé, seul un test SANS ARGENT (accepted -> ready) lui est ouvert.
MODE_COMMISSION = "commission"
MODE_SUPER_ADMIN = "super_admin"


def mode_promo(payment_type: Optional[str], hote_est_super_admin: bool) -> Optional[str]:
    if hote_eligible(payment_type):
        return MODE_COMMISSION
    if hote_est_super_admin:
        return MODE_SUPER_ADMIN
    return None


def paiement_reel_possible(mode: Optional[str]) -> bool:
    """01/10 (partie B) : le super-admin UNIQUE, HÔTE de sa session, encaisse aussi réellement — même
    pipeline que le mode commission (Stripe plateforme → compute_commission → wallet_add de l'hôte).
    Le mode est TOUJOURS calculé depuis l'hôte de la session (jamais l'appelant) : un super-admin
    participant chez un coach n'y gagne aucun droit financier. Abonnement ordinaire : None, inchangé."""
    return mode in (MODE_COMMISSION, MODE_SUPER_ADMIN)


def test_sans_paiement_possible(mode: Optional[str], statut: str) -> bool:
    """Seul chemin vers READY sans paiement : super-admin hors commission, demande ACCEPTÉE."""
    return mode == MODE_SUPER_ADMIN and statut == ACCEPTED


# ─── 01/10 : position / taille de la promo DIFFUSÉE (partie A) ─────────────────────────────────
# Fractions de la SCÈNE (0..1) : coin haut-gauche (x, y) et largeur (w) ; la hauteur suit le contenu.
# None = position par défaut (en bas, comme avant). Bornage FIN (barre, champ, plancher en px) : côté
# écran (sceneLive.placementPromo) ; ici on ne garde que des nombres sûrs.
LAYOUT_W_MIN = 0.15


def valider_layout(brut: Any) -> Optional[Dict[str, float]]:
    if brut is None:
        return None
    if not isinstance(brut, dict):
        raise RegleRefusee("Position illisible")
    sortie: Dict[str, float] = {}
    for k in ("x", "y", "w"):
        v = brut.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
            raise RegleRefusee("Position illisible")
        sortie[k] = round(min(1.0, max(0.0, float(v))), 4)
    sortie["w"] = max(LAYOUT_W_MIN, sortie["w"])
    return sortie


def vue_publique(promo: Dict[str, Any], t: Optional[datetime] = None) -> Dict[str, Any]:
    """Ce que TOUS les participants reçoivent d'une promo diffusée (aucune donnée de paiement)."""
    return {"id": promo.get("id"), "title": promo.get("title") or "", "body": promo.get("body") or "",
            "media_url": promo.get("media_url"), "external_url": promo.get("external_url"),
            "participant_name": promo.get("participant_name") or "",
            "started_at": promo.get("started_at"), "ends_at": promo.get("ends_at"),
            "duration_seconds": promo.get("duration_seconds"),
            "layout": promo.get("layout") if isinstance(promo.get("layout"), dict) else None,
            "remaining_seconds": secondes_restantes(promo.get("ends_at"), t)}


# ─── Schéma (migration idempotente, AJOUT PUR) ─────────────────────────────────
# Sauvegarde : copie de `playlists` AVANT d'y ajouter les deux colonnes (créée une seule
# fois, `if not exists`). Rollback documenté dans infra/promo/live-promos.sql.
SQL_SCHEMA = """
create table if not exists public.playlists_backup_live_promo_20260930 as table public.playlists;
alter table public.playlists
  add column if not exists live_promo_enabled boolean default false,
  add column if not exists live_promo_offres  jsonb   default '[]'::jsonb;
create table if not exists public.live_promos (
  id                      uuid primary key default gen_random_uuid(),
  session_id              text not null,
  host_id                 uuid not null,
  participant_id          uuid not null,
  participant_name        text,
  offre_id                text,
  duration_seconds        integer not null check (duration_seconds between 5 and 3600),
  price_chf               numeric(10,2) not null check (price_chf > 0),
  currency                text not null default 'CHF',
  media_url               text,
  title                   text not null,
  body                    text,
  external_url            text,
  status                  text not null default 'requested' check (status in
    ('requested','rejected','accepted','payment_pending','payment_failed','ready','broadcasting','completed','stopped_early')),
  requested_at            timestamptz not null default now(),
  decided_at              timestamptz,
  checkout_attempt        integer not null default 0,
  stripe_session_id       text unique,
  stripe_payment_intent   text,
  paid_at                 timestamptz,
  commission_percent      numeric(5,2),
  commission_chf          numeric(10,2),
  net_chf                 numeric(10,2),
  wallet_ref              text,
  started_at              timestamptz,
  ends_at                 timestamptz,
  stopped_at              timestamptz,
  stopped_by              uuid,
  actual_duration_seconds integer,
  stop_reason             text,
  updated_at              timestamptz not null default now()
);
create index if not exists live_promos_session_idx on public.live_promos(session_id, status);
create index if not exists live_promos_participant_idx on public.live_promos(participant_id);
create unique index if not exists live_promos_une_diffusion on public.live_promos(session_id) where status = 'broadcasting';
alter table public.live_promos enable row level security;
alter table public.live_promos add column if not exists test_sans_paiement boolean not null default false;
alter table public.live_promos add column if not exists layout jsonb;
alter table public.live_promos add column if not exists gratuit boolean not null default false;
alter table public.live_promos drop constraint if exists live_promos_price_chf_check;
alter table public.live_promos add constraint live_promos_price_chf_check check (gratuit or price_chf > 0);
"""
