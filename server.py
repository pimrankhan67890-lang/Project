"""Vignan Smart Campus: geofenced presence and campus movement service.

The service keeps only a consented student's latest GPS point for an active
session. It clears that point when sharing stops and never adds coordinates to
event history. Production still requires Vignan identity and surveyed fences.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
import secrets
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, Numeric,
                        String, Text, UniqueConstraint, create_engine, event,
                        delete, func, select)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATIC = ROOT / "public"
ON_VERCEL = os.getenv("VERCEL", "").lower() in {"1", "true"}
APP_ENV = os.getenv("APP_ENV", "production" if ON_VERCEL else "development").lower()
configured_database_url = os.getenv("DATABASE_URL", "").strip()
if configured_database_url:
    DATABASE_URL = configured_database_url
elif ON_VERCEL:
    # Import the app cleanly so its lifespan can return a clear production
    # configuration error when no persistent database has been connected.
    DATABASE_URL = "sqlite://"
else:
    DATA.mkdir(exist_ok=True)
    DATABASE_URL = f"sqlite:///{(DATA / 'vignan-campus.sqlite3').as_posix()}"
# Hosted providers commonly supply postgresql:// URLs. This application uses
# psycopg 3, so select its SQLAlchemy driver explicitly.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip()
if not PUBLIC_BASE_URL and ON_VERCEL:
    deployment_host = (os.getenv("VERCEL_PROJECT_PRODUCTION_URL")
                       or os.getenv("VERCEL_URL", "")).strip()
    if deployment_host:
        PUBLIC_BASE_URL = deployment_host if deployment_host.startswith("https://") else f"https://{deployment_host}"
SESSION_HOURS = max(1, min(24, int(os.getenv("SESSION_HOURS", "10"))))
CONSENT_VERSION = os.getenv("CONSENT_VERSION", "v1.1")
LOCATION_ACCURACY_LIMIT_M = max(30, min(500, int(os.getenv("LOCATION_ACCURACY_LIMIT_M", "120"))))
PRESENCE_RETENTION_DAYS = max(1, min(365, int(os.getenv("PRESENCE_RETENTION_DAYS", "30"))))
SESSION_COOKIE = "vignan_session"
CSRF_COOKIE = "vignan_csrf"
COOKIE_SECURE = APP_ENV == "production"
SETUP_BOOTSTRAP_TOKEN = os.getenv("SETUP_BOOTSTRAP_TOKEN", "")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
Base = declarative_base()

engine_options: dict[str, Any] = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False, "timeout": 25}
else:
    # Keep each serverless instance's pool bounded; use the database provider's
    # pooled endpoint to limit aggregate connections across scaled instances.
    engine_options.update(pool_size=2, max_overflow=0, pool_timeout=10, pool_recycle=1800)
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return normalized.isoformat(timespec="seconds").replace("+00:00", "Z")


class CampusUser(Base):
    __tablename__ = "campus_users"
    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, nullable=False, index=True)
    full_name = Column(String(140), nullable=False)
    password_hash = Column(String(100), nullable=False)
    role = Column(String(24), nullable=False, index=True)  # admin, security, student
    student_no = Column(String(32), unique=True, index=True)
    department = Column(String(120))
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime)


class Geofence(Base):
    __tablename__ = "geofences"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    zone_type = Column(String(24), nullable=False, default="campus")
    latitude = Column(Numeric(10, 7), nullable=False)
    longitude = Column(Numeric(10, 7), nullable=False)
    radius_m = Column(Integer, nullable=False)
    active = Column(Boolean, nullable=False, default=True, index=True)
    demo_boundary = Column(Boolean, nullable=False, default=False)
    alert_entry = Column(Boolean, nullable=False, default=True)
    alert_exit = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("campus_users.id"))
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow)


class CampusConfig(Base):
    __tablename__ = "campus_config"
    id = Column(Integer, primary_key=True)
    campus_name = Column(String(120), nullable=False, default="Vignan · Vadlamudi Campus")
    retention_days = Column(Integer, nullable=False, default=PRESENCE_RETENTION_DAYS)
    updated_at = Column(DateTime, nullable=False, default=utcnow)


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    policy_version = Column(String(24), nullable=False)
    granted = Column(Boolean, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class PresenceSession(Base):
    __tablename__ = "presence_sessions"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="active", index=True)
    current_zone_id = Column(Integer, ForeignKey("geofences.id"))
    started_at = Column(DateTime, nullable=False, default=utcnow)
    last_seen_at = Column(DateTime, nullable=False, default=utcnow, index=True)
    ended_at = Column(DateTime)
    demo_record = Column(Boolean, nullable=False, default=False)


class PresenceLiveLocation(Base):
    """The latest consented position for an active session; never an event history."""
    __tablename__ = "presence_live_locations"
    session_id = Column(Integer, ForeignKey("presence_sessions.id", ondelete="CASCADE"), primary_key=True)
    student_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    latitude = Column(Numeric(10, 7), nullable=False)
    longitude = Column(Numeric(10, 7), nullable=False)
    accuracy_m = Column(Numeric(8, 2), nullable=False)
    updated_at = Column(DateTime, nullable=False, default=utcnow, index=True)
    demo_record = Column(Boolean, nullable=False, default=False)


class PresenceEvent(Base):
    __tablename__ = "presence_events"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("presence_sessions.id", ondelete="SET NULL"))
    geofence_id = Column(Integer, ForeignKey("geofences.id", ondelete="SET NULL"))
    event_type = Column(String(24), nullable=False, index=True)
    accuracy_m = Column(Integer)
    source = Column(String(24), nullable=False, default="gps")
    review_reason = Column(String(180))
    demo_record = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=utcnow, index=True)
    # Raw latitude and longitude must not be added to this table or its audit data.


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("campus_users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    body = Column(String(500), nullable=False)
    category = Column(String(24), nullable=False, default="presence")
    event_id = Column(Integer, ForeignKey("presence_events.id", ondelete="SET NULL"))
    read_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, default=utcnow, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("campus_users.id", ondelete="SET NULL"))
    action = Column(String(80), nullable=False)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(String(64))
    details = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=utcnow, index=True)


class SetupInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=140)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=12, max_length=72)
    bootstrap_token: str = Field(default="", max_length=256)
    campus_name: str = Field(default="Vignan · Vadlamudi Campus", min_length=3, max_length=120)
    seed_sample: bool = True


class LoginInput(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=72)


class StudentInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=140)
    email: str = Field(min_length=5, max_length=254)
    student_no: str = Field(min_length=2, max_length=32)
    department: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=72)


class StudentPatch(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=140)
    department: Optional[str] = Field(default=None, min_length=2, max_length=120)
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=12, max_length=72)


class StaffInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=140)
    email: str = Field(min_length=5, max_length=254)
    role: str = Field(pattern="^(admin|security)$")
    password: str = Field(min_length=12, max_length=72)


class StaffPatch(BaseModel):
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=12, max_length=72)


class GeofenceInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    zone_type: str = Field(pattern="^(campus|academic|library|hostel|sports|transport|health|other)$")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_m: int = Field(ge=25, le=5000)
    active: bool = True
    alert_entry: bool = True
    alert_exit: bool = True
    boundary_verified: bool = False


class ConsentInput(BaseModel):
    granted: bool
    policy_version: str = Field(default=CONSENT_VERSION, min_length=2, max_length=24)


class PresenceCheckInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(gt=0, le=10000)
    direction: str = Field(pattern="^(check_in|update|check_out)$", default="update")


class RetentionInput(BaseModel):
    days: int = Field(ge=1, le=365)


@dataclass
class AuthContext:
    user: CampusUser
    session: AuthSession


SETUP_LOCK = threading.Lock()
LOGIN_FAILURES: dict[str, list[float]] = {}
PRESENCE_RATE: dict[int, list[float]] = {}
LAST_PURGE_DAY: Optional[str] = None
RATE_LOCK = threading.Lock()
RATE_LIMITS: dict[str, list[float]] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def password_hash(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be at most 72 UTF-8 bytes.")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def password_matches(password: str, saved_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), saved_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "Enter a valid email address.")
    return email


def audit(db: Session, actor_id: Optional[int], action: str, entity_type: str,
          entity_id: Optional[Any] = None, details: Optional[dict[str, Any]] = None) -> None:
    # Deliberately exclude coordinates, passwords, session tokens, and message content.
    db.add(AuditLog(actor_id=actor_id, action=action, entity_type=entity_type,
                    entity_id=str(entity_id) if entity_id is not None else None,
                    details=json.dumps(details or {}, separators=(",", ":"))))


def _hit_limit(key: str, limit: int, window_seconds: int) -> bool:
    now = time.monotonic()
    with RATE_LOCK:
        hits = [t for t in RATE_LIMITS.get(key, []) if now - t < window_seconds]
        if len(hits) >= limit:
            RATE_LIMITS[key] = hits
            return False
        hits.append(now)
        RATE_LIMITS[key] = hits
        return True


def set_auth_cookies(response: Response, token: str, csrf: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600,
                        httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=SESSION_HOURS * 3600,
                        httponly=False, secure=COOKIE_SECURE, samesite="strict", path="/")


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=COOKIE_SECURE, httponly=False, samesite="strict")


def user_payload(user: CampusUser) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "full_name": user.full_name,
            "role": user.role, "student_no": user.student_no,
            "department": user.department, "active": user.active}


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Sign in to continue.")
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    auth_session = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == digest, AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow()))
    if not auth_session:
        raise HTTPException(401, "Your session expired. Sign in again.")
    user = db.get(CampusUser, auth_session.user_id)
    if not user or not user.active:
        raise HTTPException(401, "This account is not active.")
    return AuthContext(user, auth_session)


def require_roles(*roles: str):
    def dependency(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.user.role not in roles:
            raise HTTPException(403, "You do not have access to this campus function.")
        return auth
    return dependency


def require_csrf(request: Request) -> None:
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if origin and host and urlparse(origin).netloc.lower() != host.lower():
        raise HTTPException(403, "Cross-site request blocked.")
    cookie_token = request.cookies.get(CSRF_COOKIE, "")
    header_token = request.headers.get("x-csrf-token", "")
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(403, "Request verification failed. Reload the page and try again.")


def latest_consent(db: Session, user_id: int) -> Optional[ConsentRecord]:
    return db.scalar(select(ConsentRecord).where(ConsentRecord.student_id == user_id)
                     .order_by(ConsentRecord.id.desc()).limit(1))


def consent_payload(record: Optional[ConsentRecord]) -> dict[str, Any]:
    active = bool(record and record.granted and record.policy_version == CONSENT_VERSION)
    return {"active": active, "policy_version": record.policy_version if record else CONSENT_VERSION,
            "updated_at": iso(record.created_at) if record else None,
            "notice": "With your consent, your latest GPS position is visible to authorized campus administrators and security only during an active session. It is cleared when you stop, withdraw consent, exit, sign out, or the session goes stale. Zone events and times are retained; location history is not."}


def clear_live_location(db: Session, session_id: int) -> None:
    live = db.get(PresenceLiveLocation, session_id)
    if live:
        db.delete(live)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.pi / 180
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def zone_payload(zone: Geofence) -> dict[str, Any]:
    return {"id": zone.id, "name": zone.name, "zone_type": zone.zone_type,
            "latitude": float(zone.latitude), "longitude": float(zone.longitude),
            "radius_m": zone.radius_m, "active": zone.active,
            "demo_boundary": zone.demo_boundary, "boundary_verified": not zone.demo_boundary, "alert_entry": zone.alert_entry,
            "alert_exit": zone.alert_exit, "updated_at": iso(zone.updated_at)}


def event_payload(db: Session, row: PresenceEvent) -> dict[str, Any]:
    user = db.get(CampusUser, row.student_id)
    zone = db.get(Geofence, row.geofence_id) if row.geofence_id else None
    return {"id": row.id, "student_id": row.student_id,
            "student_name": user.full_name if user else "Removed account",
            "student_no": user.student_no if user else None,
            "zone_id": row.geofence_id, "zone_name": zone.name if zone else "Campus boundary",
            "event_type": row.event_type, "accuracy_m": row.accuracy_m,
            "source": row.source, "review_reason": row.review_reason,
            "demo_record": row.demo_record, "created_at": iso(row.created_at)}


def expire_stale_sessions(db: Session) -> int:
    """Close stale or no-longer-consented sessions and erase their live GPS points."""
    cutoff = utcnow() - timedelta(minutes=3)
    active_rows = db.scalars(select(PresenceSession).where(PresenceSession.status == "active")).all()
    closed = 0
    for row in active_rows:
        old_location = row.last_seen_at < cutoff
        consent = latest_consent(db, row.student_id)
        consent_invalid = not row.demo_record and not (
            consent and consent.granted and consent.policy_version == CONSENT_VERSION)
        if not old_location and not consent_invalid:
            continue
        row.status = "stale" if old_location else "stopped"
        row.ended_at = utcnow()
        clear_live_location(db, row.id)
        student = db.get(CampusUser, row.student_id)
        zone = db.get(Geofence, row.current_zone_id) if row.current_zone_id else None
        event_type = "tracking_stale" if old_location else "tracking_stopped"
        event_row = make_event(db, student, row, zone, event_type, None, source="system", demo=row.demo_record)
        if student and old_location:
            notify(db, event_row, student, "Presence session paused", "Location updates stopped. Reopen the student view to verify your presence again.")
        audit(db, None, "presence.session_stale" if old_location else "presence.consent_expired",
              "presence_session", row.id)
        closed += 1
    if closed:
        db.commit()
    return closed


def notify(db: Session, event_row: PresenceEvent, student: CampusUser, title: str, body: str) -> None:
    recipients = db.scalars(select(CampusUser).where(CampusUser.active.is_(True), CampusUser.role.in_(["admin", "security"]))).all()
    target_ids = {r.id for r in recipients}
    target_ids.add(student.id)
    for recipient_id in target_ids:
        db.add(Notification(user_id=recipient_id, title=title, body=body,
                            category="review" if event_row.event_type == "location_review" else "presence",
                            event_id=event_row.id))


def make_event(db: Session, student: CampusUser, session_row: Optional[PresenceSession],
               zone: Optional[Geofence], event_type: str, accuracy: Optional[float],
               source: str = "gps", reason: Optional[str] = None, demo: bool = False) -> PresenceEvent:
    row = PresenceEvent(student_id=student.id, session_id=session_row.id if session_row else None,
                        geofence_id=zone.id if zone else None, event_type=event_type,
                        accuracy_m=round(accuracy) if accuracy is not None else None,
                        source=source, review_reason=reason, demo_record=demo)
    db.add(row)
    db.flush()
    return row


def sample_data(db: Session, admin: CampusUser) -> None:
    # Fictional records. The approximate boundary is visibly marked DEMO and is
    # rejected by presence verification when APP_ENV=production.
    students: list[CampusUser] = []
    departments = ["Computer Science", "Electronics", "Mechanical", "Biotechnology", "Management"]
    for idx in range(1, 13):
        user = CampusUser(email=f"student{idx:02d}@example.invalid", full_name=f"Demo Student {idx:02d}",
                          password_hash=password_hash(secrets.token_urlsafe(20)), role="student",
                          student_no=f"DEMO-2026-{idx:03d}", department=departments[(idx - 1) % len(departments)], active=True)
        db.add(user)
        students.append(user)
    db.flush()
    security = CampusUser(email="security.demo@example.invalid", full_name="Demo Campus Security",
                          password_hash=password_hash(secrets.token_urlsafe(20)), role="security", active=True)
    db.add(security)
    center_lat, center_lon = 16.232529, 80.547941
    campus = Geofence(name="Vadlamudi campus boundary · DEMO", zone_type="campus",
                      latitude=center_lat, longitude=center_lon, radius_m=600,
                      active=True, demo_boundary=True, created_by=admin.id)
    db.add(campus)
    db.flush()
    local_zones = [
        ("Academic block · DEMO", "academic", 16.2331, 80.5478, 150),
        ("NTR Library · DEMO", "library", 16.2321, 80.5483, 80),
        ("Hostel precinct · DEMO", "hostel", 16.2318, 80.5472, 180),
        ("Sports complex · DEMO", "sports", 16.2330, 80.5487, 150),
    ]
    zones = [campus]
    for name, typ, lat, lon, radius in local_zones:
        z = Geofence(name=name, zone_type=typ, latitude=lat, longitude=lon, radius_m=radius,
                     active=True, demo_boundary=True, created_by=admin.id)
        db.add(z)
        zones.append(z)
    db.flush()
    for idx, user in enumerate(students[:7]):
        zone = zones[(idx % (len(zones) - 1)) + 1]
        s = PresenceSession(student_id=user.id, status="active", current_zone_id=zone.id,
                            started_at=utcnow() - timedelta(minutes=18 + idx * 13),
                            last_seen_at=utcnow() - timedelta(minutes=idx * 2), demo_record=True)
        db.add(s)
        db.flush()
        e = PresenceEvent(student_id=user.id, session_id=s.id, geofence_id=zone.id,
                          event_type="campus_entry", accuracy_m=18 + idx * 5, source="demo",
                          demo_record=True, created_at=s.started_at)
        db.add(e)
        db.flush()
        db.add(Notification(user_id=admin.id, title="Demo presence event",
                            body=f"{user.full_name} entered the campus demo boundary.", category="presence", event_id=e.id))
    # One review item makes the review path visible in the development workspace.
    review_user = students[7]
    review = make_event(db, review_user, None, None, "location_review", 380,
                        source="demo", reason="Demo sample: reported accuracy exceeds threshold.", demo=True)
    db.add(Notification(user_id=admin.id, title="Location needs review",
                        body=f"{review_user.full_name} has a low-accuracy demo check.", category="review", event_id=review.id))


def _setup_tables():
    Base.metadata.create_all(bind=engine)


def purge_expired_presence(db: Session, force: bool = False) -> int:
    global LAST_PURGE_DAY
    today_key = utcnow().date().isoformat()
    if not force and LAST_PURGE_DAY == today_key:
        return 0
    config = db.get(CampusConfig, 1)
    retention_days = config.retention_days if config else PRESENCE_RETENTION_DAYS
    cutoff = utcnow() - timedelta(days=retention_days)
    old_events = db.scalar(select(func.count(PresenceEvent.id)).where(PresenceEvent.created_at < cutoff)) or 0
    old_sessions = db.scalar(select(func.count(PresenceSession.id)).where(
        PresenceSession.status != "active", PresenceSession.ended_at.is_not(None),
        PresenceSession.ended_at < cutoff)) or 0
    if old_events:
        db.execute(delete(PresenceEvent).where(PresenceEvent.created_at < cutoff))
    if old_sessions:
        db.execute(delete(PresenceSession).where(PresenceSession.status != "active",
                                                 PresenceSession.ended_at.is_not(None),
                                                 PresenceSession.ended_at < cutoff))
    if old_events or old_sessions:
        audit(db, None, "presence.retention_purge", "presence",
              details={"events_deleted": old_events, "sessions_deleted": old_sessions,
                       "retention_days": retention_days, "cutoff_utc": iso(cutoff)})
        db.commit()
    LAST_PURGE_DAY = today_key
    return old_events + old_sessions


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if APP_ENV == "production":
        if DATABASE_URL.startswith("sqlite"):
            raise RuntimeError("Production mode requires a persistent PostgreSQL DATABASE_URL.")
        if not PUBLIC_BASE_URL.startswith("https://"):
            raise RuntimeError("Production mode requires an HTTPS Vercel URL or PUBLIC_BASE_URL.")
    _setup_tables()
    with SessionLocal() as db:
        purge_expired_presence(db, force=True)
        if APP_ENV == "production" and (db.scalar(select(func.count(CampusUser.id))) or 0) == 0 and not SETUP_BOOTSTRAP_TOKEN:
            raise RuntimeError("Production first-run setup requires SETUP_BOOTSTRAP_TOKEN; remove it after the first administrator is created.")
    yield


app = FastAPI(title="Vignan Smart Campus", version="1.0.0", lifespan=lifespan,
              docs_url=None if APP_ENV == "production" else "/docs",
              redoc_url=None if APP_ENV == "production" else "/redoc",
              openapi_url=None if APP_ENV == "production" else "/openapi.json")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/"):
        public_mutations = {"/api/setup", "/api/auth/login"}
        if request.url.path not in public_mutations:
            origin = request.headers.get("origin")
            host = request.headers.get("host")
            cookie_token = request.cookies.get(CSRF_COOKIE, "")
            header_token = request.headers.get("x-csrf-token", "")
            if origin and host and urlparse(origin).netloc.lower() != host.lower():
                return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
            if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
                return JSONResponse({"detail": "Request verification failed. Reload the page and try again."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' https://vignan.ac.in https://unpkg.com https://tile.openstreetmap.org https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com data:; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; script-src 'self' https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:; font-src 'self' https://fonts.gstatic.com; frame-src https://*.google.com; worker-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    return response


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/student", include_in_schema=False)
def student_portal():
    return FileResponse(STATIC / "index.html")


@app.get("/styles.css", include_in_schema=False)
def styles():
    return FileResponse(STATIC / "styles.css", media_type="text/css")


@app.get("/app.js", include_in_schema=False)
def script():
    return FileResponse(STATIC / "app.js", media_type="application/javascript")


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    return FileResponse(STATIC / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "vignan-smart-campus", "environment": APP_ENV}


@app.get("/api/health/ready")
def readiness(db: Session = Depends(get_db)):
    try:
        db.execute(select(1)).scalar_one()
    except Exception:
        raise HTTPException(503, "The database is not ready.")
    return {"status": "ready", "service": "vignan-smart-campus"}


@app.get("/api/map/config")
def map_config():
    # A Maps JavaScript API key is visible to browser users by design; restrict
    # it to the deployed website and Maps JavaScript API in Google Cloud.
    return {"provider": "google" if GOOGLE_MAPS_API_KEY else "osm",
            "google_maps_api_key": GOOGLE_MAPS_API_KEY}


@app.get("/api/setup/status")
def setup_status(db: Session = Depends(get_db)):
    count = db.scalar(select(func.count(CampusUser.id))) or 0
    return {"setup_required": count == 0, "environment": APP_ENV,
            "bootstrap_token_required": APP_ENV == "production" and count == 0}


def _new_session(db: Session, user: CampusUser, response: Response) -> dict[str, Any]:
    token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    db.add(AuthSession(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                       expires_at=utcnow() + timedelta(hours=SESSION_HOURS)))
    db.commit()
    set_auth_cookies(response, token, csrf)
    return {"user": user_payload(user), "csrf_token": csrf, "expires_in": SESSION_HOURS * 3600}


@app.post("/api/setup")
def setup(payload: SetupInput, response: Response, db: Session = Depends(get_db)):
    with SETUP_LOCK:
        if db.scalar(select(func.count(CampusUser.id))) or 0:
            raise HTTPException(409, "This Vignan Smart Campus workspace has already been initialized.")
        if APP_ENV == "production":
            if not SETUP_BOOTSTRAP_TOKEN:
                raise HTTPException(503, "Initial administrator setup is locked until the operator configures a bootstrap token.")
            if not hmac.compare_digest(payload.bootstrap_token, SETUP_BOOTSTRAP_TOKEN):
                raise HTTPException(403, "The administrator bootstrap token is incorrect.")
        email = normalize_email(payload.email)
        user = CampusUser(email=email, full_name=payload.full_name.strip(),
                          password_hash=password_hash(payload.password), role="admin", active=True)
        db.add(user)
        db.flush()
        db.add(CampusConfig(id=1, campus_name=payload.campus_name.strip(), retention_days=PRESENCE_RETENTION_DAYS))
        sample_accounts = None
        sample_enabled = bool(payload.seed_sample and APP_ENV != "production")
        if sample_enabled:
            sample_accounts = load_sample_workspace(db, user)
        audit(db, user.id, "workspace.setup", "campus",
              details={"campus_name": payload.campus_name.strip(), "sample_data": sample_enabled})
        db.commit()
        result = _new_session(db, user, response)
        result["sample_data_loaded"] = sample_enabled
        if sample_accounts:
            result["demo_student_login"] = sample_accounts
        return result


@app.post("/api/demo-data")
def add_demo_data(auth: AuthContext = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    existing_demo = db.scalar(select(func.count(Geofence.id)).where(Geofence.demo_boundary.is_(True))) or 0
    existing_demo += db.scalar(select(func.count(PresenceEvent.id)).where(PresenceEvent.demo_record.is_(True))) or 0
    if existing_demo or db.scalar(select(CampusUser.id).where(
            CampusUser.email == "presence.student@example.invalid")):
        raise HTTPException(409, "Synthetic demo data is already present; it cannot be loaded twice.")
    demo_login = load_sample_workspace(db, auth.user)
    audit(db, auth.user.id, "workspace.demo_data_loaded", "campus",
          details={"sample_data": True})
    db.commit()
    return {"sample_data_loaded": True, "demo_student_login": demo_login,
            "warning": "Synthetic records are not real attendance data. Demo geofences cannot verify presence in production."}


@app.post("/api/auth/login")
def login(payload: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    key = ip + ":" + payload.email.strip().lower()
    now = time.monotonic()
    failures = [t for t in LOGIN_FAILURES.get(key, []) if now - t < 900]
    if len(failures) >= 8:
        raise HTTPException(429, "Too many sign-in attempts. Try again in 15 minutes.")
    user = db.scalar(select(CampusUser).where(CampusUser.email == payload.email.strip().lower()))
    if not user or not user.active or not password_matches(payload.password, user.password_hash):
        failures.append(now)
        LOGIN_FAILURES[key] = failures
        time.sleep(0.15)
        raise HTTPException(401, "Email or password is incorrect.")
    LOGIN_FAILURES.pop(key, None)
    audit(db, user.id, "auth.login", "session")
    db.commit()
    return _new_session(db, user, response)


@app.get("/api/auth/me")
def me(auth: AuthContext = Depends(get_auth)):
    return {"user": user_payload(auth.user)}


@app.post("/api/auth/logout")
def logout(response: Response, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    auth.session.revoked_at = utcnow()
    if auth.user.role == "student":
        for active in db.scalars(select(PresenceSession).where(
                PresenceSession.student_id == auth.user.id, PresenceSession.status == "active")).all():
            clear_live_location(db, active.id)
    audit(db, auth.user.id, "auth.logout", "session", auth.session.id)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=COOKIE_SECURE, httponly=False, samesite="strict")
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    expire_stale_sessions(db)
    purge_expired_presence(db)
    config = db.get(CampusConfig, 1)
    today = utcnow().date()
    today_start = datetime.combine(today, datetime.min.time())
    tomorrow_start = today_start + timedelta(days=1)
    if auth.user.role == "student":
        active = db.scalar(select(PresenceSession).where(PresenceSession.student_id == auth.user.id,
                                                         PresenceSession.status == "active"))
        latest = db.scalar(select(PresenceEvent).where(PresenceEvent.student_id == auth.user.id)
                           .order_by(PresenceEvent.id.desc()).limit(1))
        consent = latest_consent(db, auth.user.id)
        return {"role": "student", "current_status": active.status if active else "outside",
                "current_zone": db.get(Geofence, active.current_zone_id).name if active and active.current_zone_id else None,
                "started_at": iso(active.started_at) if active else None,
                "last_seen_at": iso(active.last_seen_at) if active else None,
                "events_today": db.scalar(select(func.count(PresenceEvent.id)).where(
                    PresenceEvent.student_id == auth.user.id,
                    PresenceEvent.created_at >= today_start,
                    PresenceEvent.created_at < tomorrow_start)) or 0,
                "latest_event": event_payload(db, latest) if latest else None,
                "consent": consent_payload(consent)}
    active_sessions = db.scalars(select(PresenceSession).where(PresenceSession.status == "active")).all()
    counts = {"campus_entry": 0, "campus_exit": 0, "zone_entry": 0, "zone_exit": 0, "location_review": 0}
    for event_type in counts:
        counts[event_type] = db.scalar(select(func.count(PresenceEvent.id)).where(
            PresenceEvent.event_type == event_type,
            PresenceEvent.created_at >= today_start,
            PresenceEvent.created_at < tomorrow_start)) or 0
    zones = db.scalars(select(Geofence).order_by(Geofence.zone_type, Geofence.name)).all()
    occupancy = []
    for zone in zones:
        num = db.scalar(select(func.count(PresenceSession.id)).where(
            PresenceSession.status == "active", PresenceSession.current_zone_id == zone.id)) or 0
        occupancy.append({**zone_payload(zone), "present": num})
    unread = db.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == auth.user.id, Notification.read_at.is_(None))) or 0
    demo_geofences = db.scalar(select(func.count(Geofence.id)).where(Geofence.demo_boundary.is_(True))) or 0
    demo_events = db.scalar(select(func.count(PresenceEvent.id)).where(PresenceEvent.demo_record.is_(True))) or 0
    demo = bool(demo_geofences or demo_events)
    return {"role": auth.user.role, "campus_name": config.campus_name if config else "Vignan · Vadlamudi Campus",
            "active_students": len({s.student_id for s in active_sessions}),
            "active_sessions": len(active_sessions), "geofence_count": len(zones),
            "active_geofences": sum(1 for z in zones if z.active), "today": counts,
            "zones": occupancy, "unread_notifications": unread,
            "demo_data_present": demo, "updated_at": iso(utcnow())}


def student_access(auth: AuthContext, user_id: int):
    if auth.user.role == "student" and auth.user.id != user_id:
        raise HTTPException(403, "Students can view only their own campus record.")
    if auth.user.role not in {"admin", "security", "student"}:
        raise HTTPException(403, "You do not have access to student presence records.")


@app.get("/api/students")
def list_students(q: str = "", status: str = "all", auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    if auth.user.role not in {"admin", "security", "student"}:
        raise HTTPException(403, "You do not have access to student records.")
    query = select(CampusUser).where(CampusUser.role == "student")
    if auth.user.role == "student":
        query = query.where(CampusUser.id == auth.user.id)
    if q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where((CampusUser.full_name.ilike(pattern)) | (CampusUser.email.ilike(pattern)) |
                            (CampusUser.student_no.ilike(pattern)))
    users = db.scalars(query.order_by(CampusUser.full_name).limit(300)).all()
    items = []
    for user in users:
        active_session = db.scalar(select(PresenceSession).where(PresenceSession.student_id == user.id,
                                                                 PresenceSession.status == "active"))
        zone = db.get(Geofence, active_session.current_zone_id) if active_session and active_session.current_zone_id else None
        latest = db.scalar(select(PresenceEvent).where(PresenceEvent.student_id == user.id)
                           .order_by(PresenceEvent.id.desc()).limit(1))
        current = "inside" if active_session else "outside"
        if status not in {"all", current}:
            continue
        item = {"id": user.id, "full_name": user.full_name, "student_no": user.student_no,
                "email": user.email if auth.user.role == "admin" else None,
                "department": user.department, "active": user.active,
                "presence_status": current, "current_zone": zone.name if zone else None,
                "last_seen_at": iso(active_session.last_seen_at) if active_session else None,
                "latest_event": event_payload(db, latest) if latest else None}
        items.append(item)
    return {"items": items, "total": len(items)}


@app.post("/api/students")
def create_student(payload: StudentInput, auth: AuthContext = Depends(require_roles("admin")),
                   db: Session = Depends(get_db)):
    email = normalize_email(payload.email)
    if db.scalar(select(CampusUser.id).where(CampusUser.email == email)):
        raise HTTPException(409, "An account already uses that email address.")
    if db.scalar(select(CampusUser.id).where(CampusUser.student_no == payload.student_no.strip())):
        raise HTTPException(409, "That student number is already registered.")
    user = CampusUser(email=email, full_name=payload.full_name.strip(), password_hash=password_hash(payload.password),
                      role="student", student_no=payload.student_no.strip(), department=payload.department.strip(), active=True)
    db.add(user)
    db.flush()
    audit(db, auth.user.id, "student.created", "student", user.id,
          {"student_no": user.student_no, "department": user.department})
    db.commit()
    return {"student": user_payload(user)}


@app.patch("/api/students/{user_id}")
def update_student(user_id: int, payload: StudentPatch, auth: AuthContext = Depends(require_roles("admin")),
                   db: Session = Depends(get_db)):
    user = db.get(CampusUser, user_id)
    if not user or user.role != "student":
        raise HTTPException(404, "Student not found.")
    updates = payload.model_dump(exclude_unset=True)
    password = updates.pop("password", None)
    for key, value in updates.items():
        setattr(user, key, value)
    if password or updates.get("active") is False:
        for old in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id,
                                                         AuthSession.revoked_at.is_(None))).all():
            old.revoked_at = utcnow()
    if updates.get("active") is False:
        for active in db.scalars(select(PresenceSession).where(PresenceSession.student_id == user.id,
                                                                PresenceSession.status == "active")).all():
            active.status = "stopped"
            active.ended_at = utcnow()
            active.last_seen_at = active.ended_at
            clear_live_location(db, active.id)
            zone = db.get(Geofence, active.current_zone_id) if active.current_zone_id else None
            make_event(db, user, active, zone, "tracking_stopped", None, source="admin")
            audit(db, auth.user.id, "presence.student_access_disabled", "presence_session", active.id)
    if password:
        user.password_hash = password_hash(password)
    audit(db, auth.user.id, "student.updated", "student", user.id,
          {"fields": sorted(updates.keys()) + (["password_reset"] if password else [])})
    db.commit()
    return {"student": user_payload(user)}


@app.post("/api/staff")
def create_staff(payload: StaffInput, auth: AuthContext = Depends(require_roles("admin")),
                 db: Session = Depends(get_db)):
    email = normalize_email(payload.email)
    if db.scalar(select(CampusUser.id).where(CampusUser.email == email)):
        raise HTTPException(409, "An account already uses that email address.")
    user = CampusUser(email=email, full_name=payload.full_name.strip(), password_hash=password_hash(payload.password),
                      role=payload.role, active=True)
    db.add(user)
    db.flush()
    audit(db, auth.user.id, "staff.created", "user", user.id, {"role": user.role})
    db.commit()
    return {"user": user_payload(user)}


@app.get("/api/staff")
def list_staff(auth: AuthContext = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    rows = db.scalars(select(CampusUser).where(CampusUser.role.in_(["admin", "security"]))
                      .order_by(CampusUser.role, CampusUser.full_name)).all()
    return {"items": [user_payload(row) for row in rows], "total": len(rows)}


@app.patch("/api/staff/{user_id}")
def update_staff(user_id: int, payload: StaffPatch, auth: AuthContext = Depends(require_roles("admin")),
                 db: Session = Depends(get_db)):
    user = db.get(CampusUser, user_id)
    if not user or user.role not in {"admin", "security"}:
        raise HTTPException(404, "Campus staff account not found.")
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "Choose an access change to apply.")
    if updates.get("active") is False:
        if user.id == auth.user.id:
            raise HTTPException(409, "You cannot disable the account you are using.")
        if user.role == "admin":
            active_admins = db.scalar(select(func.count(CampusUser.id)).where(
                CampusUser.role == "admin", CampusUser.active.is_(True))) or 0
            if active_admins <= 1:
                raise HTTPException(409, "At least one active campus administrator must remain.")
        user.active = False
    elif "active" in updates:
        user.active = updates["active"]
    password = updates.get("password")
    if password:
        user.password_hash = password_hash(password)
    if updates.get("active") is False or password:
        for session_row in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id,
                                                                 AuthSession.revoked_at.is_(None))).all():
            session_row.revoked_at = utcnow()
    audit(db, auth.user.id, "staff.updated", "user", user.id,
          {"fields": sorted(updates.keys()), "active": user.active})
    db.commit()
    return {"user": user_payload(user)}


def validate_zone_inside_campus(db: Session, payload: GeofenceInput, existing_id: Optional[int] = None):
    if APP_ENV == "production" and payload.active and not payload.boundary_verified:
        raise HTTPException(400, "Confirm that this geofence uses a surveyed and institution-approved boundary before activating it.")
    if payload.zone_type == "campus":
        return
    campus_zones = db.scalars(select(Geofence).where(Geofence.zone_type == "campus", Geofence.active.is_(True))).all()
    if not campus_zones:
        raise HTTPException(409, "Create an approved campus-boundary geofence before adding campus sub-zones.")
    contained = any(distance_m(payload.latitude, payload.longitude, float(c.latitude), float(c.longitude)) + payload.radius_m <= c.radius_m
                    for c in campus_zones if c.id != existing_id)
    if not contained:
        raise HTTPException(400, "This zone must fit inside the campus boundary. Check its center and radius.")


@app.get("/api/geofences")
def list_geofences(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    zones = db.scalars(select(Geofence).order_by(Geofence.zone_type, Geofence.name)).all()
    return {"items": [zone_payload(z) for z in zones], "total": len(zones)}


@app.post("/api/geofences")
def create_geofence(payload: GeofenceInput, auth: AuthContext = Depends(require_roles("admin")),
                    db: Session = Depends(get_db)):
    validate_zone_inside_campus(db, payload)
    if payload.zone_type == "campus" and payload.active:
        current = db.scalar(select(Geofence.id).where(Geofence.zone_type == "campus", Geofence.active.is_(True)))
        if current:
            raise HTTPException(409, "Pause the active campus boundary before creating another.")
    zone = Geofence(name=payload.name.strip(), zone_type=payload.zone_type,
                    latitude=payload.latitude, longitude=payload.longitude, radius_m=payload.radius_m,
                    active=payload.active, demo_boundary=not payload.boundary_verified, alert_entry=payload.alert_entry,
                    alert_exit=payload.alert_exit, created_by=auth.user.id, updated_at=utcnow())
    db.add(zone)
    db.flush()
    audit(db, auth.user.id, "geofence.created", "geofence", zone.id,
          {"name": zone.name, "zone_type": zone.zone_type, "radius_m": zone.radius_m})
    db.commit()
    return {"geofence": zone_payload(zone)}


@app.patch("/api/geofences/{zone_id}")
def update_geofence(zone_id: int, payload: GeofenceInput, auth: AuthContext = Depends(require_roles("admin")),
                    db: Session = Depends(get_db)):
    zone = db.get(Geofence, zone_id)
    if not zone:
        raise HTTPException(404, "Geo-zone not found.")
    validate_zone_inside_campus(db, payload, zone.id)
    if payload.zone_type == "campus" and payload.active:
        conflict = db.scalar(select(Geofence.id).where(Geofence.zone_type == "campus", Geofence.active.is_(True), Geofence.id != zone.id))
        if conflict:
            raise HTTPException(409, "There is another active campus boundary.")
    for key, value in payload.model_dump(exclude={"boundary_verified"}).items():
        setattr(zone, key, value)
    zone.demo_boundary = not payload.boundary_verified
    zone.updated_at = utcnow()
    audit(db, auth.user.id, "geofence.updated", "geofence", zone.id,
          {"name": zone.name, "zone_type": zone.zone_type, "radius_m": zone.radius_m, "active": zone.active})
    db.commit()
    return {"geofence": zone_payload(zone)}


@app.get("/api/consent")
def get_consent(auth: AuthContext = Depends(require_roles("student")), db: Session = Depends(get_db)):
    return consent_payload(latest_consent(db, auth.user.id))


@app.put("/api/consent")
def set_consent(payload: ConsentInput, auth: AuthContext = Depends(require_roles("student")),
                db: Session = Depends(get_db)):
    if payload.policy_version != CONSENT_VERSION:
        raise HTTPException(409, "The privacy notice has changed. Reload it before making your choice.")
    record = ConsentRecord(student_id=auth.user.id, policy_version=payload.policy_version,
                           granted=payload.granted, created_at=utcnow())
    db.add(record)
    if not payload.granted:
        for active in db.scalars(select(PresenceSession).where(PresenceSession.student_id == auth.user.id,
                                                                PresenceSession.status == "active")).all():
            active.status = "stopped"
            active.ended_at = utcnow()
            active.last_seen_at = active.ended_at
            clear_live_location(db, active.id)
            event_row = make_event(db, auth.user, active, db.get(Geofence, active.current_zone_id) if active.current_zone_id else None,
                                   "tracking_stopped", None, source="student")
            audit(db, auth.user.id, "presence.consent_withdrawn", "presence_session", active.id)
    audit(db, auth.user.id, "privacy.consent_changed", "consent", details={"granted": payload.granted, "policy_version": payload.policy_version})
    db.commit()
    return consent_payload(record)


def current_presence(db: Session, user_id: int) -> Optional[PresenceSession]:
    return db.scalar(select(PresenceSession).where(PresenceSession.student_id == user_id,
                                                    PresenceSession.status == "active").order_by(PresenceSession.id.desc()).limit(1))


@app.post("/api/presence/check")
def check_presence(payload: PresenceCheckInput, auth: AuthContext = Depends(require_roles("student")),
                   db: Session = Depends(get_db)):
    now_mono = time.monotonic()
    recent = [t for t in PRESENCE_RATE.get(auth.user.id, []) if now_mono - t < 20]
    if len(recent) >= 3:
        raise HTTPException(429, "Location checks are arriving too quickly. Wait a moment and try again.")
    recent.append(now_mono)
    PRESENCE_RATE[auth.user.id] = recent
    expire_stale_sessions(db)
    consent = latest_consent(db, auth.user.id)
    if not consent or not consent.granted or consent.policy_version != CONSENT_VERSION:
        raise HTTPException(403, "Review and accept the current location notice before starting a campus presence session.")
    if payload.accuracy_m > LOCATION_ACCURACY_LIMIT_M:
        active = current_presence(db, auth.user.id)
        if active:
            clear_live_location(db, active.id)
        event_row = make_event(db, auth.user, current_presence(db, auth.user.id), None, "location_review",
                               payload.accuracy_m, reason=f"Reported accuracy exceeds {LOCATION_ACCURACY_LIMIT_M} m.")
        admins = db.scalars(select(CampusUser).where(CampusUser.active.is_(True), CampusUser.role.in_(["admin", "security"]))).all()
        for recipient in admins:
            db.add(Notification(user_id=recipient.id, title="Location check needs review",
                                body=f"{auth.user.full_name} shared a low-accuracy presence check.",
                                category="review", event_id=event_row.id))
        audit(db, auth.user.id, "presence.location_review", "presence_event", event_row.id,
              {"accuracy_m": round(payload.accuracy_m)})
        db.commit()
        return {"status": "needs_review", "message": "GPS accuracy is too low to verify presence. Move to an open area and try again.",
                "accuracy_limit_m": LOCATION_ACCURACY_LIMIT_M, "event": event_payload(db, event_row)}

    campus_zones = db.scalars(select(Geofence).where(Geofence.zone_type == "campus", Geofence.active.is_(True))).all()
    if not campus_zones:
        raise HTTPException(409, "Campus boundary is not configured. Contact the campus administrator.")
    if APP_ENV == "production" and any(z.demo_boundary for z in campus_zones):
        raise HTTPException(409, "The campus boundary is a demo configuration and cannot verify live presence.")
    campus_match = next((z for z in campus_zones if distance_m(payload.latitude, payload.longitude,
                                                               float(z.latitude), float(z.longitude)) <= z.radius_m), None)
    active = current_presence(db, auth.user.id)
    now = utcnow()
    if campus_match is None:
        if active:
            prior_zone = db.get(Geofence, active.current_zone_id) if active.current_zone_id else None
            if prior_zone and prior_zone.zone_type != "campus":
                make_event(db, auth.user, active, prior_zone, "zone_exit", payload.accuracy_m)
            active.status = "exited"
            active.ended_at = now
            active.last_seen_at = now
            clear_live_location(db, active.id)
            event_row = make_event(db, auth.user, active, campus_zones[0], "campus_exit", payload.accuracy_m)
            if campus_zones[0].alert_exit:
                notify(db, event_row, auth.user, "Campus exit recorded", f"{auth.user.full_name} left the campus boundary.")
            audit(db, auth.user.id, "presence.campus_exit", "presence_event", event_row.id)
            db.commit()
            return {"status": "exited", "message": "Campus exit recorded.", "zone": None, "event": event_payload(db, event_row)}
        if payload.direction == "check_in":
            return {"status": "outside", "message": "Your location is outside the active campus boundary. No presence was recorded."}
        return {"status": "outside", "message": "You are outside the active campus boundary."}

    if payload.direction == "check_out":
        raise HTTPException(409, "Your location is still inside the campus boundary. Tracking remains active until you leave or stop it.")

    subzones = db.scalars(select(Geofence).where(Geofence.zone_type != "campus", Geofence.active.is_(True))).all()
    matches = [(distance_m(payload.latitude, payload.longitude, float(z.latitude), float(z.longitude)), z)
               for z in subzones]
    match = next((z for dist, z in sorted(matches, key=lambda pair: pair[0]) if dist <= z.radius_m), campus_match)
    event_rows: list[PresenceEvent] = []
    if not active:
        active = PresenceSession(student_id=auth.user.id, status="active", current_zone_id=campus_match.id,
                                 started_at=now, last_seen_at=now)
        db.add(active)
        db.flush()
        entry = make_event(db, auth.user, active, campus_match, "campus_entry", payload.accuracy_m)
        event_rows.append(entry)
        if campus_match.alert_entry:
            notify(db, entry, auth.user, "Campus entry verified", f"{auth.user.full_name} entered the campus boundary.")
        if match.id != campus_match.id:
            active.current_zone_id = match.id
            zone_entry = make_event(db, auth.user, active, match, "zone_entry", payload.accuracy_m)
            event_rows.append(zone_entry)
            if match.alert_entry:
                notify(db, zone_entry, auth.user, f"Entered {match.name}", f"Campus presence verified in {match.name}.")
        audit(db, auth.user.id, "presence.campus_entry", "presence_session", active.id,
              {"zone_id": match.id, "accuracy_m": round(payload.accuracy_m)})
        result_status = "verified"
        message = "Campus presence verified. Location sharing is active while this session remains open."
    else:
        old_zone = db.get(Geofence, active.current_zone_id) if active.current_zone_id else campus_match
        active.last_seen_at = now
        if old_zone and old_zone.id != match.id:
            if old_zone.zone_type != "campus":
                exit_row = make_event(db, auth.user, active, old_zone, "zone_exit", payload.accuracy_m)
                event_rows.append(exit_row)
                if old_zone.alert_exit:
                    notify(db, exit_row, auth.user, f"Left {old_zone.name}", f"{auth.user.full_name} left {old_zone.name}.")
            active.current_zone_id = match.id
            if match.id != campus_match.id:
                entry = make_event(db, auth.user, active, match, "zone_entry", payload.accuracy_m)
                event_rows.append(entry)
                if match.alert_entry:
                    notify(db, entry, auth.user, f"Entered {match.name}", f"Campus presence verified in {match.name}.")
            audit(db, auth.user.id, "presence.zone_transition", "presence_session", active.id,
                  {"from_zone_id": old_zone.id if old_zone else None, "to_zone_id": match.id})
        if old_zone and old_zone.zone_type == "campus" and match.id == campus_match.id:
            active.current_zone_id = campus_match.id
        result_status = "verified" if event_rows else "still_inside"
        message = "Presence refreshed." if not event_rows else f"Presence verified in {match.name}."
    live_location = db.get(PresenceLiveLocation, active.id)
    if not live_location:
        live_location = PresenceLiveLocation(session_id=active.id, student_id=auth.user.id,
                                             latitude=payload.latitude, longitude=payload.longitude,
                                             accuracy_m=payload.accuracy_m, updated_at=now,
                                             demo_record=active.demo_record)
        db.add(live_location)
    else:
        live_location.latitude = payload.latitude
        live_location.longitude = payload.longitude
        live_location.accuracy_m = payload.accuracy_m
        live_location.updated_at = now
    db.commit()
    return {"status": result_status, "message": message, "zone": zone_payload(match),
            "last_seen_at": iso(active.last_seen_at), "event": event_payload(db, event_rows[-1]) if event_rows else None}


@app.post("/api/presence/stop")
def stop_presence(auth: AuthContext = Depends(require_roles("student")), db: Session = Depends(get_db)):
    active = current_presence(db, auth.user.id)
    if not active:
        return {"status": "outside", "message": "No active presence session."}
    active.status = "stopped"
    active.ended_at = utcnow()
    active.last_seen_at = active.ended_at
    clear_live_location(db, active.id)
    zone = db.get(Geofence, active.current_zone_id) if active.current_zone_id else None
    row = make_event(db, auth.user, active, zone, "tracking_stopped", None, source="student")
    audit(db, auth.user.id, "presence.tracking_stopped", "presence_session", active.id)
    db.commit()
    return {"status": "stopped", "message": "Location sharing stopped. This does not record a campus exit.", "event": event_payload(db, row)}


def live_row(db: Session, session_row: PresenceSession) -> dict[str, Any]:
    user = db.get(CampusUser, session_row.student_id)
    zone = db.get(Geofence, session_row.current_zone_id) if session_row.current_zone_id else None
    location = db.get(PresenceLiveLocation, session_row.id)
    return {"session_id": session_row.id, "student_id": user.id if user else None,
            "student_name": user.full_name if user else "Removed account",
            "student_no": user.student_no if user else None,
            "department": user.department if user else None,
            "zone_id": zone.id if zone else None, "zone_name": zone.name if zone else "Campus",
            "started_at": iso(session_row.started_at), "last_seen_at": iso(session_row.last_seen_at),
            "demo_record": session_row.demo_record,
            "latitude": float(location.latitude) if location else None,
            "longitude": float(location.longitude) if location else None,
            "accuracy_m": float(location.accuracy_m) if location else None,
            "location_updated_at": iso(location.updated_at) if location else None}


@app.get("/api/presence/live")
def live_presence(zone_id: Optional[int] = None, q: str = "", auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    expire_stale_sessions(db)
    purge_expired_presence(db)
    if auth.user.role == "student":
        rows = db.scalars(select(PresenceSession).where(PresenceSession.student_id == auth.user.id,
                                                         PresenceSession.status == "active")).all()
    elif auth.user.role in {"admin", "security"}:
        stmt = select(PresenceSession).where(PresenceSession.status == "active")
        if zone_id:
            stmt = stmt.where(PresenceSession.current_zone_id == zone_id)
        rows = db.scalars(stmt.order_by(PresenceSession.last_seen_at.desc()).limit(500)).all()
        if q.strip():
            needle = q.strip().lower()
            rows = [r for r in rows if needle in (db.get(CampusUser, r.student_id).full_name.lower() + " " +
                                                   str(db.get(CampusUser, r.student_id).student_no or "").lower())]
        audit(db, auth.user.id, "presence.live_view", "presence", details={"count": len(rows)})
        audit(db, auth.user.id, "presence.location_map_view", "live_locations", details={
            "count": sum(1 for row in rows if db.get(PresenceLiveLocation, row.id))})
        db.commit()
    else:
        raise HTTPException(403, "You do not have access to live presence.")
    return {"items": [live_row(db, row) for row in rows], "total": len(rows), "updated_at": iso(utcnow())}


@app.get("/api/presence/events")
def presence_events(q: str = "", event_type: str = "all", zone_id: Optional[int] = None,
                    limit: int = 100, offset: int = 0, auth: AuthContext = Depends(get_auth),
                    db: Session = Depends(get_db)):
    if auth.user.role not in {"admin", "security", "student"}:
        raise HTTPException(403, "You do not have access to campus activity history.")
    limit = max(1, min(250, limit))
    purge_expired_presence(db)
    if auth.user.role in {"admin", "security"}:
        audit(db, auth.user.id, "presence.history_view", "presence", details={"limit": limit, "event_type": event_type})
    stmt = select(PresenceEvent)
    if auth.user.role == "student":
        stmt = stmt.where(PresenceEvent.student_id == auth.user.id)
    if event_type != "all":
        stmt = stmt.where(PresenceEvent.event_type == event_type)
    if zone_id:
        stmt = stmt.where(PresenceEvent.geofence_id == zone_id)
    rows = db.scalars(stmt.order_by(PresenceEvent.created_at.desc()).offset(max(0, offset)).limit(limit)).all()
    items = [event_payload(db, row) for row in rows]
    if q.strip():
        needle = q.strip().lower()
        items = [item for item in items if needle in (item["student_name"] + " " + str(item["student_no"] or "") + " " + item["zone_name"]).lower()]
    if auth.user.role in {"admin", "security"}:
        db.commit()
    return {"items": items, "total": len(items), "limit": limit, "offset": offset}


@app.get("/api/notifications")
def notifications(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.user_id == auth.user.id)
                      .order_by(Notification.created_at.desc()).limit(100)).all()
    return {"items": [{"id": n.id, "title": n.title, "body": n.body, "category": n.category,
                       "event_id": n.event_id, "read": n.read_at is not None, "created_at": iso(n.created_at)} for n in rows],
            "unread": sum(1 for n in rows if n.read_at is None)}


@app.post("/api/notifications/{notification_id}/read")
def read_notification(notification_id: int, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    row = db.get(Notification, notification_id)
    if not row or row.user_id != auth.user.id:
        raise HTTPException(404, "Notification not found.")
    row.read_at = utcnow()
    db.commit()
    return {"ok": True}


@app.post("/api/notifications/read-all")
def read_all_notifications(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.user_id == auth.user.id, Notification.read_at.is_(None))).all()
    for row in rows:
        row.read_at = utcnow()
    db.commit()
    return {"updated": len(rows)}


@app.get("/api/audit")
def audit_history(limit: int = 100, auth: AuthContext = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    limit = max(1, min(250, limit))
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return {"items": [{"id": row.id, "actor": db.get(CampusUser, row.actor_id).full_name if row.actor_id and db.get(CampusUser, row.actor_id) else "System",
                        "action": row.action, "entity_type": row.entity_type, "entity_id": row.entity_id,
                        "details": json.loads(row.details or "{}"), "created_at": iso(row.created_at)} for row in rows]}


@app.get("/api/reports/presence.csv")
def export_events(event_type: str = "all", auth: AuthContext = Depends(require_roles("admin", "security")),
                  db: Session = Depends(get_db)):
    stmt = select(PresenceEvent).order_by(PresenceEvent.created_at.desc()).limit(10000)
    if event_type != "all":
        stmt = stmt.where(PresenceEvent.event_type == event_type)
    rows = db.scalars(stmt).all()
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["Event ID", "Student ID", "Student", "Event", "Zone", "Accuracy (m)", "Source", "Timestamp UTC"])
    def safe_cell(value: Any) -> Any:
        if isinstance(value, str) and value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    for row in rows:
        data = event_payload(db, row)
        writer.writerow([safe_cell(data["id"]), safe_cell(data["student_no"]), safe_cell(data["student_name"]),
                         safe_cell(data["event_type"]), safe_cell(data["zone_name"]), safe_cell(data["accuracy_m"]),
                         safe_cell(data["source"]), safe_cell(data["created_at"])])
    audit(db, auth.user.id, "presence.report_export", "presence", details={"rows": len(rows), "event_type": event_type})
    db.commit()
    stream.seek(0)
    return StreamingResponse(iter([stream.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=vignan-campus-presence.csv"})


@app.get("/api/privacy/overview")
def privacy_overview(auth: AuthContext = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    users = db.scalars(select(CampusUser).where(CampusUser.role == "student", CampusUser.active.is_(True))).all()
    consented = 0
    for user in users:
        record = latest_consent(db, user.id)
        if record and record.granted and record.policy_version == CONSENT_VERSION:
            consented += 1
    demo_count = db.scalar(select(func.count(Geofence.id)).where(Geofence.demo_boundary.is_(True))) or 0
    config = db.get(CampusConfig, 1)
    return {"active_students": len(users), "consented_students": consented,
            "without_consent": len(users) - consented, "consent_version": CONSENT_VERSION,
            "accuracy_limit_m": LOCATION_ACCURACY_LIMIT_M, "demo_geofences": demo_count,
            "raw_coordinates_stored": False,
            "live_location_policy": "Latest exact position is held only for an active, consented session and cleared when that session ends. No location history is kept.",
            "retention_days": config.retention_days if config else PRESENCE_RETENTION_DAYS,
            "retention_note": "Zone events and ended-session records are purged after the configured period. Exact GPS is held only as the latest point for an active session; it is not included in event history."}


@app.put("/api/privacy/retention")
def set_retention(payload: RetentionInput, auth: AuthContext = Depends(require_roles("admin")),
                  db: Session = Depends(get_db)):
    config = db.get(CampusConfig, 1)
    if not config:
        config = CampusConfig(id=1, campus_name="Vignan · Vadlamudi Campus", retention_days=payload.days)
        db.add(config)
    old_days = config.retention_days
    config.retention_days = payload.days
    config.updated_at = utcnow()
    audit(db, auth.user.id, "privacy.retention_updated", "campus_config",
          details={"previous_days": old_days, "retention_days": payload.days})
    db.commit()
    purge_expired_presence(db, force=True)
    return {"retention_days": config.retention_days}


def create_demo_student_login(db: Session, admin: CampusUser) -> tuple[CampusUser, str]:
    email = "presence.student@example.invalid"
    existing = db.scalar(select(CampusUser).where(CampusUser.email == email))
    if existing:
        return existing, ""
    password = secrets.token_urlsafe(15) + "aA7!"
    student = CampusUser(email=email, full_name="Demo Student · Check-in", password_hash=password_hash(password),
                         role="student", student_no="DEMO-PRESENCE-001", department="Demonstration")
    db.add(student)
    db.flush()
    return student, password


def load_sample_workspace(db: Session, admin: CampusUser) -> dict[str, Any]:
    sample_data(db, admin)
    student, temp_password = create_demo_student_login(db, admin)
    return {"student_email": student.email, "student_password": temp_password}
