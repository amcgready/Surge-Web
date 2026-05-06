#!/usr/bin/env python3
"""
surge_orchestrator.py — Surge deploy orchestrator.

Takes the user's wizard config + the schema (serialized from the
frontend's serviceMeta + mediaServerMeta) and produces a working
docker-compose deployment.

Architecture overview
=====================
Stdlib-only Python module that runs on the deploy target. The only
external dependency is `docker compose` itself.

Phases:
  1. Load manifest (schema export) + config (wizard output) + state
     (persisted secrets from prior runs).
  2. Materialize secrets — generate random values for any
     compose.secrets entry on enabled services that doesn't already
     have a persisted value. New secrets are saved to state.json.
  3. Resolve markers — walk every service's env, files, scripts'
     env, and replace fromSecret / fromServiceSecret / fromService /
     fromConfig markers with concrete values. Apply whenService and
     whenMediaServer gates.
  4. Render compose.yml + write seeded files.
  5. Run `docker compose up -d` for non-blocked containers.
  6. Wait for services.
  7. Run fetchScripts in parallel, capture JSON output as runtime
     values, persist to state.json.
  8. Re-render any consumers of runtime values, start blocked
     sub-containers.
  9. Run postDeployScripts in dependency order.
 10. Save final state.

State file
==========
state.json (in --state-dir, defaults to alongside compose.yml) holds:
  {
    "secrets": {
      "<serviceKey>.<secretName>": "<random-value>",
      ...
    },
    "runtimeValues": {
      "<serviceKey>.<fieldName>": "<fetched-value>",
      ...
    }
  }

Re-runs reuse persisted values rather than rotating them — rotating
would break already-running services that have written the old
secret into their config.

CLI usage
=========
  surge_orchestrator.py [options]

Options:
  --manifest PATH       Path to schema export JSON (required)
  --config PATH         Path to wizard config JSON (required)
  --state-dir PATH      Where state.json lives (default: ./.surge)
  --output-dir PATH     Where compose.yml + seeded files land
                        (default: ./surge-deploy)
  --dry-run             Resolve everything, write artifacts, but skip
                        `docker compose up` and script execution.
                        Used for verification before a real deploy.
  --skip-up             Like --dry-run but writes artifacts. Useful
                        when you want to inspect compose.yml before
                        a real `docker compose up` (run by hand).
  --skip-scripts        Don't run any fetch/configure scripts after
                        compose up. Containers come up but no
                        cross-service wiring is applied.
  --verbose             More log output.

Exit codes
==========
  0  Success
  1  Generic failure (config error, schema mismatch, etc.)
  2  Docker compose failure
  3  Script execution failure
  6  Required CLI arg missing
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import json
import logging
import os
import secrets as _secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("surge-orchestrator")


# ---------------------------------------------------------------------
# Constants — must stay in sync with frontend/src/AdditionalServicesStep.js
# and frontend/src/composePreview.js
# ---------------------------------------------------------------------

# Path tokens recognized in mount sources + compose.files hostPaths.
KNOWN_PATH_TOKENS = {"mediaRoot", "configRoot", "userSharesRoot"}

# Surge env defaults applied to every container.
SURGE_ENV_DEFAULTS = {
    "TZ":    "${TZ:-UTC}",
    "PUID":  "99",
    "PGID":  "100",
    "UMASK": "022",
}
# Surge compose defaults — per-container fields applied unless overridden.
SURGE_COMPOSE_DEFAULTS = {
    "networkMode": "host",
    "restart":     "unless-stopped",
}


# ---------------------------------------------------------------------
# Manifest + Config + State
# ---------------------------------------------------------------------

class Manifest:
    """The schema export — loaded from manifest.json. Wraps the
    serviceMeta + mediaServerMeta objects from the frontend."""

    def __init__(self, raw: dict):
        self.service_meta:      dict = raw.get("serviceMeta", {})
        self.media_server_meta: dict = raw.get("mediaServerMeta", {})

    @classmethod
    def load(cls, path: Path) -> "Manifest":
        with path.open() as f:
            return cls(json.load(f))

    def all_meta(self) -> dict:
        """Both registries combined, keyed by service name."""
        return {**self.service_meta, **self.media_server_meta}

    def get_service(self, key: str) -> Optional[dict]:
        """Look up by key across both registries."""
        return self.all_meta().get(key)


class Config:
    """The user's wizard output — what they selected on each step."""

    def __init__(self, raw: dict):
        self.raw: dict = raw

    @classmethod
    def load(cls, path: Path) -> "Config":
        with path.open() as f:
            return cls(json.load(f))

    @property
    def media_server(self) -> str:
        return self.raw.get("mediaServer") or ""

    @property
    def content_enhancement(self) -> dict:
        return self.raw.get("contentEnhancement") or {}

    def is_service_enabled(self, key: str) -> bool:
        return bool(self.content_enhancement.get(key))

    def is_media_server(self, key: str) -> bool:
        return self.media_server == key

    def enabled_services(self, manifest: Manifest) -> list[tuple[str, dict]]:
        """[(key, meta), ...] for every service that's part of THIS
        deploy. Services flagged as `external` (the user already has
        them running outside Surge) are skipped — no container, no
        secrets, no fetch/configure scripts. The marker resolver
        handles cross-references TO externals separately, returning
        the user-provided URL/apiKey instead of the in-bundle Docker
        DNS name + state.json secret."""
        out: list[tuple[str, dict]] = []
        if (self.media_server
                and manifest.media_server_meta.get(self.media_server)
                and not self.is_external(self.media_server)):
            out.append((self.media_server, manifest.media_server_meta[self.media_server]))
        for key, enabled in self.content_enhancement.items():
            if enabled and manifest.service_meta.get(key) and not self.is_external(key):
                out.append((key, manifest.service_meta[key]))
        return out

    def is_external(self, key: str) -> bool:
        """True when the user marked `key` as already-running outside
        Surge. Read from config.externalServices.<key>.external."""
        ext = (self.raw.get("externalServices") or {}).get(key) or {}
        return bool(ext.get("external"))

    def external_info(self, key: str) -> dict:
        """Return {url, apiKey, userId} for an external service, or
        {} if not flagged external. userId is meaningful for
        jellyfin/emby where the schema's fetchScript normally
        captures it via /Users API; when the user runs those
        externally they have to supply it explicitly."""
        ext = (self.raw.get("externalServices") or {}).get(key) or {}
        if not ext.get("external"):
            return {}
        return {
            "url":    ext.get("url", ""),
            "apiKey": ext.get("apiKey", ""),
            "userId": ext.get("userId", ""),
        }


class State:
    """Persisted secrets + runtime-fetched values. Survives across
    orchestrator runs so secrets aren't rotated on every deploy."""

    def __init__(self, secrets: Optional[dict] = None,
                 runtime_values: Optional[dict] = None):
        self.secrets: dict        = secrets or {}
        self.runtime_values: dict = runtime_values or {}

    @classmethod
    def load(cls, path: Path) -> "State":
        if not path.exists():
            return cls()
        with path.open() as f:
            raw = json.load(f)
        return cls(
            secrets=raw.get("secrets", {}),
            runtime_values=raw.get("runtimeValues", {}),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write so a partial save can't corrupt state mid-write.
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8",
            dir=path.parent, prefix=".state-", suffix=".tmp",
            delete=False,
        ) as tmp:
            json.dump(
                {"secrets": self.secrets, "runtimeValues": self.runtime_values},
                tmp, indent=2, sort_keys=True,
            )
            tmp_path = tmp.name
        os.replace(tmp_path, path)
        # Make state.json read-restricted — it has all generated secrets.
        os.chmod(path, 0o600)

    def get_secret(self, service: str, name: str) -> Optional[str]:
        return self.secrets.get(f"{service}.{name}")

    def set_secret(self, service: str, name: str, value: str) -> None:
        self.secrets[f"{service}.{name}"] = value

    def get_runtime(self, service: str, field: str) -> Optional[str]:
        return self.runtime_values.get(f"{service}.{field}")

    def set_runtime(self, service: str, field: str, value: str) -> None:
        self.runtime_values[f"{service}.{field}"] = value


# ---------------------------------------------------------------------
# Secret materialization
# ---------------------------------------------------------------------

def materialize_secrets(manifest: Manifest, config: Config, state: State) -> None:
    """Generate any secrets declared on enabled services that don't
    yet have a persisted value. Mutates state in place."""
    for service_key, meta in config.enabled_services(manifest):
        secret_decls = (meta.get("compose") or {}).get("secrets") or {}
        for secret_name, decl in secret_decls.items():
            if state.get_secret(service_key, secret_name):
                # Already persisted from a prior run — don't rotate.
                continue
            if decl.get("generate") == "random":
                length = int(decl.get("length", 32))
                # token_hex(n) → 2n hex chars; we want exactly `length` chars.
                # Use urlsafe_b64 then truncate for arbitrary lengths.
                value = _secrets.token_urlsafe(length * 2)[:length]
                state.set_secret(service_key, secret_name, value)
                log.info("Generated %d-char secret for %s.%s",
                         length, service_key, secret_name)


# ---------------------------------------------------------------------
# Path resolution — mediaRoot/configRoot/userSharesRoot tokens to
# host paths. Mirrors resolveMount() in AdditionalServicesStep.js.
# ---------------------------------------------------------------------

class PathResolver:
    """Resolves token-prefixed paths to absolute host paths based on
    the user's platform choice (Unraid cache-on, Unraid cache-off,
    Docker)."""

    def __init__(self, config: Config):
        self.platform: str = config.raw.get("platform") or "docker"
        self.unraid: dict   = config.raw.get("unraid") or {}
        self.docker: dict   = config.raw.get("docker") or {}

    def media_root(self) -> str:
        """U2 in the path-shorthand notation."""
        if self.platform == "unraid":
            if self.unraid.get("useCacheDrive"):
                return self.unraid.get("cachePath") or "/mnt/cache"
            return "/mnt/user"
        return self.docker.get("rootPath") or "/srv/surge"

    def config_root(self) -> str:
        """U1 — appdata path on Unraid; same as mediaRoot on Docker."""
        if self.platform == "unraid":
            if self.unraid.get("useCacheDrive"):
                return self.unraid.get("appdataPath") or "/mnt/user/appdata"
            return "/mnt/user/appdata"
        return self.docker.get("rootPath") or "/srv/surge"

    def user_shares_root(self) -> str:
        """Always /mnt/user on Unraid; mediaRoot on Docker."""
        if self.platform == "unraid":
            return "/mnt/user"
        return self.docker.get("rootPath") or "/srv/surge"

    def resolve(self, src: str, *, service_key: str = "") -> str:
        """Resolve a path with token prefix + <service> placeholders."""
        # Substitute <service> placeholder.
        out = src.replace("<service>", service_key)
        # Pick off the leading token (if any).
        first_seg = out.split("/", 1)[0]
        rest = out[len(first_seg):]  # includes leading slash if present
        if first_seg == "mediaRoot":
            return self.media_root() + rest
        if first_seg == "configRoot":
            return self.config_root() + rest
        if first_seg == "userSharesRoot":
            return self.user_shares_root() + rest
        # Absolute or arbitrary path — pass through.
        return out


# ---------------------------------------------------------------------
# Marker resolver — port of composePreview.js's renderEnvMarker etc.
# ---------------------------------------------------------------------

class MarkerOmit:
    """Sentinel — return value when an env marker is gated off."""
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __repr__(self):
        return "<OMIT>"

OMIT = MarkerOmit()


def read_dotted(obj: Any, path: str) -> Any:
    """Walks a dot-separated path through nested dicts. Returns None
    if any segment is missing."""
    if not obj or not path:
        return None
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def resolve_env_marker(
    marker: Any,
    service_key: str,
    meta: dict,
    config: Config,
    state: State,
    *,
    runtime_required: bool = False,
) -> Any:
    """Resolve a single env marker to its concrete string value, or
    OMIT if a gate excludes it.

    runtime_required=True means: if a fromService marker hits a
    runtime value not yet captured, raise (caller is past the
    fetch-scripts phase). Default False returns the placeholder
    string `<RUNTIME-FETCH:svc.field>` so a first-pass render
    completes without runtime values."""

    # Plain literal — pass through, with ${name} substitution.
    if isinstance(marker, str):
        return substitute_template_refs(marker, service_key, meta, config, state)
    if isinstance(marker, (int, float, bool)):
        return str(marker).lower() if isinstance(marker, bool) else str(marker)
    if not isinstance(marker, dict):
        return ""

    # Conditional gate: media-server choice.
    if "whenMediaServer" in marker:
        if config.media_server != marker["whenMediaServer"]:
            return OMIT
        inner = {k: v for k, v in marker.items() if k != "whenMediaServer"}
        return resolve_env_marker(inner, service_key, meta, config, state,
                                  runtime_required=runtime_required)

    # Conditional gate: service enabled.
    if "whenService" in marker:
        if not config.is_service_enabled(marker["whenService"]):
            return OMIT
        inner = {k: v for k, v in marker.items() if k != "whenService"}
        return resolve_env_marker(inner, service_key, meta, config, state,
                                  runtime_required=runtime_required)

    # Literal value (often paired with a gate above).
    if "value" in marker:
        return substitute_template_refs(
            str(marker["value"]), service_key, meta, config, state,
        )

    # Same-service secret reference.
    if "fromSecret" in marker:
        v = state.get_secret(service_key, marker["fromSecret"])
        if v is None:
            raise RuntimeError(
                f"{service_key}: env references secret '{marker['fromSecret']}' "
                f"but no value is materialized in state — "
                f"materialize_secrets() should have run first.",
            )
        return v

    # Cross-service secret reference. Existing-services mode: if the
    # target is flagged external, the user has it running outside
    # Surge — bypass state.json and read the apiKey straight from
    # config.externalServices.<key>.apiKey. Only key/token-shaped
    # secrets are supported externally; anything else falls through
    # and will surface the placeholder.
    if "fromServiceSecret" in marker:
        target = marker["fromServiceSecret"]
        if config.is_external(target):
            secret_name = (marker.get("secret") or "").lower()
            if "key" in secret_name or "token" in secret_name:
                ext = config.external_info(target)
                if ext.get("apiKey"):
                    return ext["apiKey"]
            # Field shape we don't know how to derive externally.
            return f"<FROM-EXTERNAL:{target}.{marker['secret']}>"
        v = state.get_secret(target, marker["secret"])
        if v is None:
            # The target service may not be enabled — fromServiceSecret
            # without a whenService gate is a schema bug we surface
            # rather than silently failing.
            raise RuntimeError(
                f"{service_key}: env references "
                f"{marker['fromServiceSecret']}.{marker['secret']} but no "
                f"value is materialized — either the target service isn't "
                f"enabled (consider whenService gate) or materialize_secrets "
                f"hasn't run.",
            )
        return v

    # Runtime-fetched value from another service's fetchScript.
    # Same external bypass as fromServiceSecret. .url and .apiKey/
    # .token are the supported fields; anything else (custom
    # fetchScript outputs) falls through to the placeholder so the
    # gap is visible.
    if "fromService" in marker:
        target = marker["fromService"]
        if config.is_external(target):
            ext = config.external_info(target)
            field = (marker.get("field") or "").lower()
            if field == "url" and ext.get("url"):
                return ext["url"]
            if field in ("apikey", "token", "plextoken") and ext.get("apiKey"):
                return ext["apiKey"]
            # Jellyfin/Emby userId — supplied by user alongside apiKey.
            if field == "userid" and ext.get("userId"):
                return ext["userId"]
            return f"<FROM-EXTERNAL:{target}.{marker['field']}>"
        v = state.get_runtime(marker["fromService"], marker["field"])
        if v is not None:
            return v
        if runtime_required:
            raise RuntimeError(
                f"{service_key}: env references runtime value "
                f"{marker['fromService']}.{marker['field']} but it hasn't "
                f"been captured. Did the fetchScript run?",
            )
        # First-pass render: emit a placeholder. The orchestrator will
        # re-render this env after fetchScripts complete.
        return f"<RUNTIME-FETCH:{marker['fromService']}.{marker['field']}>"

    # User-config lookup (supports dot-notation).
    if "fromConfig" in marker:
        v = read_dotted(config.raw, marker["fromConfig"])
        if v not in (None, ""):
            return str(v).lower() if isinstance(v, bool) else str(v)
        if "defaultValue" in marker:
            return str(marker["defaultValue"])
        return ""

    # generate marker shouldn't appear directly in env (it's a
    # secret-declaration shape). Defensive fallthrough.
    if "generate" in marker:
        log.warning("%s: env contains a 'generate' marker — should only "
                    "appear in compose.secrets, not env. Returning empty.",
                    service_key)
        return ""

    return ""


def substitute_template_refs(
    literal: str,
    service_key: str,
    meta: dict,
    config: Config,
    state: State,
) -> str:
    """Replace ${name} or ${dotted.path} in a literal string with:
    same-service secret > user-config (dotted-path) > '<UNRESOLVED>'."""
    import re
    pat = re.compile(r"\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}")

    def repl(m):
        name = m.group(1)
        # TZ stays as-is — it's a docker-compose env-default expression.
        if name == "TZ":
            return m.group(0)
        # Same-service secret? Single-segment names only.
        if "." not in name:
            secret_decls = (meta.get("compose") or {}).get("secrets") or {}
            if name in secret_decls:
                v = state.get_secret(service_key, name)
                if v is not None:
                    return v
                raise RuntimeError(
                    f"{service_key}: ${{{name}}} references secret '{name}' "
                    f"but no value is materialized.",
                )
        # User-config (supports dotted paths).
        v = read_dotted(config.raw, name)
        if v is not None and v != "":
            return str(v).lower() if isinstance(v, bool) else str(v)
        return f"<UNRESOLVED:{name}>"

    return pat.sub(repl, literal)


def resolve_env_dict(
    env_decl: dict,
    service_key: str,
    meta: dict,
    config: Config,
    state: State,
    *,
    runtime_required: bool = False,
) -> dict:
    """Resolve every entry in an env declaration; drop OMIT entries."""
    out: dict[str, str] = {}
    for name, marker in env_decl.items():
        v = resolve_env_marker(marker, service_key, meta, config, state,
                               runtime_required=runtime_required)
        if v is OMIT:
            continue
        out[name] = v
    return out


# ---------------------------------------------------------------------
# Container rendering — produces the compose YAML's services section.
# ---------------------------------------------------------------------

def container_name_for(service_key: str) -> str:
    return service_key.lower()


def render_container(
    *,
    service_key: str,
    sub_key: Optional[str],
    sub: dict,
    meta: dict,
    config: Config,
    state: State,
    paths: PathResolver,
    is_sub: bool = False,
) -> dict:
    """Build a single docker-compose service entry from a (possibly
    sub-)container spec. is_sub=True when this is a sub-container of
    a multi-container service."""
    out: dict[str, Any] = {
        "image":         sub["image"],
        "network_mode":  sub.get("networkMode", SURGE_COMPOSE_DEFAULTS["networkMode"]),
        "restart":       SURGE_COMPOSE_DEFAULTS["restart"],
    }

    if sub.get("ports"):
        out["ports"] = list(sub["ports"])

    # Volumes — resolve token-prefixed source paths.
    if sub.get("mounts"):
        out["volumes"] = []
        for m in sub["mounts"]:
            host = paths.resolve(m["src"], service_key=service_key)
            spec = f"{host}:{m['dst']}"
            if m.get("options"):
                spec += f":{m['options']}"
            out["volumes"].append(spec)

    # Environment: SURGE_ENV_DEFAULTS as base, then user overrides for
    # PUID/PGID/UMASK from the wizard's Storage Config step (defaults
    # are 99/100/022 — Unraid's nobody:users — but non-Unraid hosts
    # often need their own UID/GID), then per-container env overrides.
    env_map = dict(SURGE_ENV_DEFAULTS)
    if config.raw.get("userId"):  env_map["PUID"]  = str(config.raw["userId"])
    if config.raw.get("groupId"): env_map["PGID"]  = str(config.raw["groupId"])
    if config.raw.get("umask"):   env_map["UMASK"] = str(config.raw["umask"])
    if sub.get("env"):
        rendered = resolve_env_dict(sub["env"], service_key, meta,
                                    config, state)
        env_map.update(rendered)
    out["environment"] = [f"{k}={v}" for k, v in env_map.items()]

    # FUSE / multi-container glue fields.
    if sub.get("capAdd"):
        out["cap_add"] = list(sub["capAdd"])
    if sub.get("securityOpt"):
        out["security_opt"] = list(sub["securityOpt"])
    if sub.get("devices"):
        out["devices"] = list(sub["devices"])
    if sub.get("sysctls"):
        out["sysctls"] = dict(sub["sysctls"])
    if sub.get("command"):
        out["command"] = sub["command"]
    if sub.get("tty"):
        out["tty"] = True
    if sub.get("shmSize"):
        out["shm_size"] = sub["shmSize"]
    if sub.get("healthcheck"):
        out["healthcheck"] = sub["healthcheck"]
    if sub.get("dependsOn") and len(sub["dependsOn"]) > 0:
        translated: dict[str, dict] = {}
        for dep_sub_key, condition in sub["dependsOn"].items():
            dep_name = (container_name_for(service_key) if dep_sub_key == service_key
                        else f"{container_name_for(service_key)}-{dep_sub_key}")
            translated[dep_name] = condition or {}
        out["depends_on"] = translated

    if is_sub and sub.get("networkMode") == "bridge":
        out["networks"] = [f"{container_name_for(service_key)}-internal"]

    return out


# ---------------------------------------------------------------------
# Compose renderer — top-level
# ---------------------------------------------------------------------

def render_compose(
    manifest: Manifest, config: Config, state: State, paths: PathResolver,
) -> dict:
    """Render the full docker-compose document. Returns a dict ready
    for YAML serialization."""
    services: dict[str, Any] = {}
    networks: dict[str, Any] = {}

    for service_key, meta in config.enabled_services(manifest):
        compose = meta.get("compose") or {}
        if not compose:
            continue

        if compose.get("services"):
            # Multi-container.
            for sub_key, sub in compose["services"].items():
                cname = (container_name_for(service_key) if sub_key == service_key
                         else f"{container_name_for(service_key)}-{sub_key}")
                services[cname] = render_container(
                    service_key=service_key, sub_key=sub_key, sub=sub,
                    meta=meta, config=config, state=state, paths=paths,
                    is_sub=True,
                )
            # Auto-emit a private bridge network if any sub uses it.
            if any(s.get("networkMode") == "bridge"
                   for s in compose["services"].values()):
                networks[f"{container_name_for(service_key)}-internal"] = {
                    "driver": "bridge",
                }
        else:
            # Single-container.
            services[container_name_for(service_key)] = render_container(
                service_key=service_key, sub_key=None, sub=compose,
                meta=meta, config=config, state=state, paths=paths,
                is_sub=False,
            )

    # VPN routing post-process. When gluetun is enabled and any
    # service has vpnRoute=true, hoist its ports onto gluetun and
    # swap the service to network_mode: service:gluetun. See
    # apply_vpn_routing for the rationale (compose forbids both a
    # network namespace share AND host port mapping on the same
    # service — ports must live on the namespace owner).
    apply_vpn_routing(services, config)

    doc: dict[str, Any] = {"services": services}
    if networks:
        doc["networks"] = networks
    return doc


def apply_vpn_routing(services: dict, config: Config) -> None:
    """Mutate `services` to route flagged services through gluetun.

    No-ops when gluetun isn't enabled or no service has vpnRoute=true,
    so the cost on the common path is two dict lookups.
    """
    enhance = config.raw.get("contentEnhancement") or {}
    if not enhance.get("gluetun"):
        return
    routed = config.raw.get("vpnRoutedServices") or {}
    routed_keys = [k for k, v in routed.items() if v]
    if not routed_keys:
        return

    gluetun_cname = container_name_for("gluetun")
    gluetun = services.get(gluetun_cname)
    if not gluetun:
        return

    # Collect hoisted ports here (de-duplicated). gluetun may already
    # have its own ports declared via the schema (it doesn't, today,
    # but be defensive).
    hoisted: list[str] = list(gluetun.get("ports") or [])

    def _hoist(svc: dict) -> None:
        for p in svc.get("ports") or []:
            if p not in hoisted:
                hoisted.append(p)
        svc["ports"] = []
        svc["network_mode"] = f"service:{gluetun_cname}"
        svc.pop("networks", None)

    for key in routed_keys:
        cname = container_name_for(key)
        # Route the parent container itself if present. This is the
        # only one we attach the gluetun depends_on to — sub-containers
        # in a multi-container service will already wait for their
        # parent (if the schema declared dependsOn between them) or
        # at minimum start in lock-step due to the shared compose run.
        svc = services.get(cname)
        if svc is not None:
            _hoist(svc)
            depends = dict(svc.get("depends_on") or {})
            depends[gluetun_cname] = {"condition": "service_healthy"}
            svc["depends_on"] = depends
        # Sub-containers of a multi-container service (e.g. zurg,
        # zurg-rclone). Route every one whose name starts with the
        # parent's container name + '-'. This covers the case where
        # the parent isn't itself a container (rare) AND the case
        # where it is (we routed it above; siblings still need it).
        prefix = f"{cname}-"
        for cn, sub in list(services.items()):
            if cn.startswith(prefix):
                _hoist(sub)

    gluetun["ports"] = hoisted


# ---------------------------------------------------------------------
# File seeding — writes resolved compose.files content to host paths.
# ---------------------------------------------------------------------

def write_seeded_files(
    manifest: Manifest, config: Config, state: State, paths: PathResolver,
    *, dry_run: bool = False,
) -> list[Path]:
    """Resolve all compose.files entries and write them. Returns the
    list of paths written. Atomic writes via temp-file + rename."""
    written: list[Path] = []

    for service_key, meta in config.enabled_services(manifest):
        files = (meta.get("compose") or {}).get("files") or {}
        for _name, decl in files.items():
            host_path = Path(paths.resolve(decl["hostPath"], service_key=service_key))
            content = render_file_content(decl.get("content"), service_key, meta,
                                          config, state)

            if dry_run:
                log.info("[DRY RUN] Would write %d bytes to %s",
                         len(content) if isinstance(content, str) else 0, host_path)
                written.append(host_path)
                continue

            if isinstance(content, str):
                _write_atomic(host_path, content, mode=decl.get("mode"))
                log.info("Wrote seeded file %s (%d bytes)", host_path, len(content))
                written.append(host_path)
            else:
                # fromUpstream marker — TODO: HTTP-fetch the URL with
                # fallback to the inline snapshot. Stub for now.
                log.warning("Skipping %s — fromUpstream content fetch not yet "
                            "implemented in orchestrator. The file will need "
                            "to be created manually.", host_path)

    return written


def render_file_content(
    content: Any, service_key: str, meta: dict, config: Config, state: State,
) -> Any:
    """Resolve compose.files.content. String → template-substituted.
    Object with fromUpstream → return the marker dict (caller decides
    how to fetch)."""
    if isinstance(content, str):
        return substitute_template_refs(content, service_key, meta, config, state)
    return content  # fromUpstream marker, caller handles


def _write_atomic(path: Path, content: str, *, mode: Optional[str] = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8",
        dir=path.parent, prefix=".surge-", suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    os.replace(tmp_path, path)
    if mode:
        os.chmod(path, int(mode, 8))


# ---------------------------------------------------------------------
# YAML emit — minimal stdlib YAML serializer for our compose doc shape.
# Keeps the orchestrator stdlib-only without pulling in PyYAML.
# ---------------------------------------------------------------------

def to_yaml(doc: Any, indent: int = 0) -> str:
    """Tiny YAML emitter. Handles dicts, lists, strings, bools, ints.
    Suitable for our compose document shape — not a general-purpose
    YAML library."""
    pad = "  " * indent
    if isinstance(doc, dict):
        if not doc:
            return "{}"
        lines = []
        for k, v in doc.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{k}:")
                lines.append(to_yaml(v, indent + 1))
            elif isinstance(v, (dict, list)) and not v:
                lines.append(f"{pad}{k}: {to_yaml(v, 0)}")
            else:
                lines.append(f"{pad}{k}: {_yaml_scalar(v)}")
        return "\n".join(lines)
    if isinstance(doc, list):
        if not doc:
            return "[]"
        lines = []
        for item in doc:
            if isinstance(item, (dict, list)) and item:
                # First line of item carries the dash, subsequent lines
                # line up under it.
                rendered = to_yaml(item, indent + 1)
                first, *rest = rendered.split("\n", 1)
                # Strip the indent off the first line and re-prefix with "- ".
                first = first.lstrip()
                lines.append(f"{pad}- {first}")
                if rest:
                    lines.append(rest[0])
            else:
                lines.append(f"{pad}- {_yaml_scalar(item)}")
        return "\n".join(lines)
    return f"{pad}{_yaml_scalar(doc)}"


def _yaml_scalar(v: Any) -> str:
    """Render a scalar value with appropriate YAML quoting."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    # Quote if it contains characters YAML would interpret specially.
    needs_quote = (
        not s
        or s.lower() in {"true", "false", "yes", "no", "null", "~"}
        or s[0] in "!&*[]{}|>'\"%@`#,?:- "
        or "\n" in s
        or ": " in s
        or " #" in s
    )
    if needs_quote:
        # Use double-quotes; escape inner double-quotes and backslashes.
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


# ---------------------------------------------------------------------
# Docker compose driver
# ---------------------------------------------------------------------

class DockerRunner:
    """Wraps `docker compose` calls. The compose file lives in
    output_dir; all subcommands run with --project-directory pointing
    there."""

    def __init__(self, output_dir: Path, *, dry_run: bool = False):
        self.output_dir = output_dir
        self.dry_run    = dry_run

    def _run(self, args: list[str]) -> subprocess.CompletedProcess:
        cmd = ["docker", "compose", "--project-directory", str(self.output_dir),
               *args]
        log.info("$ %s", " ".join(cmd))
        if self.dry_run:
            return subprocess.CompletedProcess(cmd, 0, stdout=b"", stderr=b"")
        try:
            return subprocess.run(cmd, capture_output=True)
        except FileNotFoundError:
            # `docker` not on PATH. Caller decides how to handle —
            # for orchestrator main flow it's fatal; for backup flow
            # we just warn and proceed without the stop/start dance.
            return subprocess.CompletedProcess(
                cmd, 127,
                stdout=b"", stderr=b"docker binary not found on PATH",
            )

    def up(self, *, services: Optional[list[str]] = None) -> None:
        """Bring up containers. services=None brings everything up;
        a list restricts to those service names."""
        args = ["up", "-d"]
        if services:
            args.extend(services)
        result = self._run(args)
        if result.returncode != 0:
            log.error("docker compose up failed: %s",
                      result.stderr.decode("utf-8", errors="replace"))
            sys.exit(2)

    def down(self) -> None:
        """Stop the stack but keep volumes (no -v flag). Used during
        backup/restore so containers don't write to disk while we're
        archiving their config dirs."""
        result = self._run(["down"])
        if result.returncode != 0:
            log.warning("docker compose down returned non-zero "
                        "(stack may not have been running): %s",
                        result.stderr.decode("utf-8", errors="replace"))


# ---------------------------------------------------------------------
# Script runner — fetch + post-deploy
# ---------------------------------------------------------------------

class ScriptRunner:
    """Runs Surge's fetch-* and configure-* scripts with the right env."""

    def __init__(self, scripts_dir: Path, paths: PathResolver,
                 *, dry_run: bool = False):
        self.scripts_dir = scripts_dir
        self.paths       = paths
        self.dry_run     = dry_run

    def run(
        self, script_path: str, env: dict, *, service_key: str = "",
    ) -> tuple[int, str, str]:
        """Run a script with env vars set. Returns (returncode,
        stdout, stderr). Inherits the parent's PATH so docker / other
        binaries the script might need are available.

        service_key feeds <service> placeholder substitution in any
        token-prefixed env values (e.g. configRoot/<service>/foo.conf
        resolves to mediaRoot/sonarr/foo.conf when service_key='sonarr')."""
        full_path = self.scripts_dir / Path(script_path).name
        if not full_path.exists():
            raise FileNotFoundError(f"Script not found: {full_path}")

        merged_env = dict(os.environ)
        # Resolve any token-prefixed values in the env (configure-nzbdav.py
        # convention: paths like configRoot/<service>/rclone.conf get
        # passed as resolved host paths).
        for k, v in env.items():
            if isinstance(v, str) and any(v.startswith(t + "/") or v == t
                                          for t in KNOWN_PATH_TOKENS):
                merged_env[k] = self.paths.resolve(v, service_key=service_key)
            else:
                merged_env[k] = str(v)

        if self.dry_run:
            # Show resolved env (paths token-substituted, secrets
            # redacted) so the dry-run preview matches what the script
            # would actually receive at runtime.
            redacted = {}
            for k, v in env.items():
                resolved = merged_env.get(k, v)
                if any(s in k for s in ("KEY", "TOKEN", "PASSWORD")):
                    redacted[k] = "***REDACTED***"
                else:
                    redacted[k] = resolved
            log.info("[DRY RUN] Would run %s with env: %s",
                     full_path.name, redacted)
            return 0, "", ""

        log.info("$ python3 %s", full_path)
        result = subprocess.run(
            ["python3", str(full_path)],
            env=merged_env, capture_output=True,
        )
        return (
            result.returncode,
            result.stdout.decode("utf-8", errors="replace"),
            result.stderr.decode("utf-8", errors="replace"),
        )


def _expected_fetch_fields(producer: str, manifest: Manifest) -> list[str]:
    """Walk every service's env/script-env declarations and collect
    the field names referenced via `fromService:'<producer>'`. Used
    in dry-run mode to know which placeholder runtime values the
    fetchScript would produce, so consumers can render too."""
    fields: set[str] = set()
    for _key, meta in manifest.all_meta().items():
        compose = meta.get("compose") or {}
        env_blocks = [compose.get("env")]
        if compose.get("postDeployScript"):
            env_blocks.append(compose["postDeployScript"].get("env"))
        if compose.get("fetchScript"):
            env_blocks.append(compose["fetchScript"].get("env"))
        for sub in (compose.get("services") or {}).values():
            env_blocks.append(sub.get("env"))

        for env_block in env_blocks:
            if not env_block:
                continue
            for marker in env_block.values():
                _collect_from_service_fields(marker, producer, fields)
    return sorted(fields)


def _collect_from_service_fields(marker: Any, producer: str, out: set) -> None:
    """Recurse through a marker's gates (whenService/whenMediaServer)
    looking for fromService:<producer> at the leaves."""
    if not isinstance(marker, dict):
        return
    if marker.get("fromService") == producer and "field" in marker:
        out.add(marker["field"])
    # whenService/whenMediaServer wrap an inner marker that may carry
    # the fromService — keep walking.
    for k in ("whenService", "whenMediaServer"):
        if k in marker:
            inner = {kk: vv for kk, vv in marker.items() if kk != k}
            _collect_from_service_fields(inner, producer, out)


def run_fetch_scripts(
    manifest: Manifest, config: Config, state: State, paths: PathResolver,
    runner: ScriptRunner,
) -> None:
    """Run every enabled service's fetchScript. Captures JSON output
    and stores under state.runtime_values. Mutates state in place."""
    for service_key, meta in config.enabled_services(manifest):
        fetch = (meta.get("compose") or {}).get("fetchScript")
        if not fetch:
            continue

        env = resolve_env_dict(fetch.get("env") or {}, service_key, meta,
                               config, state)
        # Add CONFIG_PATH convention — orchestrator gives scripts the
        # resolved host configRoot/<service> path (configure-nzbdav.py
        # already documents this).
        env["CONFIG_PATH"] = paths.resolve(f"configRoot/{service_key}",
                                           service_key=service_key)

        log.info("Running fetchScript for %s (%s)", service_key, fetch["path"])
        rc, out, err = runner.run(fetch["path"], env, service_key=service_key)
        if rc != 0:
            log.error("fetchScript for %s failed (rc=%d). stderr:\n%s",
                      service_key, rc, err)
            sys.exit(3)

        # Dry-run: ScriptRunner returns ("", "") without executing. The
        # postDeployScript phase needs *some* runtime value or its
        # fromService refs will fail with runtime_required=True. Stub
        # placeholder values so the dry-run preview shows what the
        # consumer's env would look like with real fetchScript output.
        if runner.dry_run:
            for field in _expected_fetch_fields(service_key, manifest):
                state.set_runtime(service_key, field,
                                  f"<DRY-RUN:{service_key}.{field}>")
            continue

        # Capture JSON output as runtime values.
        if not out.strip():
            log.warning("fetchScript for %s produced no stdout output — "
                        "no runtime values captured", service_key)
            continue
        try:
            captured = json.loads(out)
        except json.JSONDecodeError:
            log.error("fetchScript for %s output is not valid JSON: %r",
                      service_key, out[:300])
            sys.exit(3)

        if not isinstance(captured, dict):
            log.error("fetchScript for %s output is JSON but not an object: %r",
                      service_key, captured)
            sys.exit(3)

        for field, value in captured.items():
            state.set_runtime(service_key, field, str(value))
            log.info("Captured runtime value %s.%s", service_key, field)


def run_post_deploy_scripts(
    manifest: Manifest, config: Config, state: State, paths: PathResolver,
    runner: ScriptRunner,
) -> None:
    """Run postDeployScripts for every enabled service. Order:
    services that consume fromService values run AFTER the script
    that produces them — we run fetchScripts in run_fetch_scripts()
    BEFORE this function, so by the time we get here every fromService
    reference is already resolvable."""
    for service_key, meta in config.enabled_services(manifest):
        post = (meta.get("compose") or {}).get("postDeployScript")
        if not post:
            continue

        env = resolve_env_dict(post.get("env") or {}, service_key, meta,
                               config, state, runtime_required=True)
        env["CONFIG_PATH"] = paths.resolve(f"configRoot/{service_key}",
                                           service_key=service_key)

        log.info("Running postDeployScript for %s (%s)",
                 service_key, post["path"])
        rc, out, err = runner.run(post["path"], env, service_key=service_key)
        if rc != 0:
            log.error("postDeployScript for %s failed (rc=%d). stderr:\n%s",
                      service_key, rc, err)
            sys.exit(3)
        if out.strip():
            log.debug("postDeployScript stdout:\n%s", out)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

# ---------------------------------------------------------------------
# Backup / restore — snapshot every service's persisted state into a
# single tarball so the user can recover after a host failure or move
# the stack to a different machine.
#
# What's backed up:
#   - The whole configRoot tree (every per-service config dir,
#     every seeded file like sabnzbd.ini / cinesync/.env).
#   - state.json (generated secrets + runtime-fetched values).
#   - manifest.json + config.json (so the backup is fully self-
#     describing — orchestrator from a different bundle could rebuild).
#
# What's NOT backed up:
#   - Media library content (mediaRoot/media). Backing up gigabytes of
#     downloaded TV shows is the user's job — most have a separate
#     archival strategy for media.
#   - Container images (orchestrator pulls them on restore).
#
# Stack lifecycle: containers are stopped via `docker compose down`
# before tar to avoid mid-write corruption, then restarted afterward
# (or after restore for the restore case).
# ---------------------------------------------------------------------

def do_backup(
    *, output_file: Path, manifest_path: Path, config_path: Path,
    config: "Config", state_path: Path, paths: "PathResolver",
    docker: "DockerRunner", dry_run: bool = False,
) -> None:
    """Stop stack, tar configRoot + state + manifest + config, restart."""
    import tarfile

    config_root = paths.config_root()
    if not Path(config_root).exists():
        log.error("configRoot %s doesn't exist — nothing to back up. "
                  "Has the stack ever been deployed from this machine?",
                  config_root)
        sys.exit(1)

    log.info("Backup plan: %s + %s + %s → %s",
             config_root, state_path, manifest_path, output_file)

    if dry_run:
        log.info("[DRY RUN] Would stop stack, tar above paths, restart stack")
        return

    log.info("Stopping stack so configs are quiescent during archive…")
    docker.down()

    output_file.parent.mkdir(parents=True, exist_ok=True)
    log.info("Writing %s (this may take a while for large config trees)…",
             output_file)
    try:
        with tarfile.open(output_file, "w:gz") as tar:
            # Add the configRoot tree under "configRoot/" prefix in the
            # archive — restore reads back from that prefix.
            cr_path = Path(config_root)
            tar.add(cr_path, arcname="configRoot", recursive=True)
            # Surge metadata. Each goes under "metadata/" so restore
            # knows to pull these out separately.
            for src, name in [
                (state_path,    "state.json"),
                (manifest_path, "manifest.json"),
                (config_path,   "config.json"),
            ]:
                if Path(src).exists():
                    tar.add(src, arcname=f"metadata/{name}")
                else:
                    log.warning("Skipping missing %s", src)
    except Exception as e:
        log.error("Backup failed: %s — restarting stack to leave it "
                  "in a usable state", e)
        docker.up()
        sys.exit(3)

    size_mb = output_file.stat().st_size / (1024 * 1024)
    log.info("Backup complete (%.1f MB). Restarting stack…", size_mb)
    # Use the soft-fail variant so if docker is unavailable (e.g. user
    # ran backup against a host that doesn't have docker), the backup
    # archive still gets written rather than us erroring out after the
    # tar finished. The user knows what they're doing — this is a
    # snapshot operation, not a deploy.
    try:
        docker.up()
    except SystemExit:
        log.warning("Stack restart skipped — start it manually with "
                    "`docker compose up -d` once you've sorted out docker.")


def do_restore(
    *, input_file: Path, paths: "PathResolver", state_path: Path,
    docker: "DockerRunner", dry_run: bool = False,
) -> None:
    """Stop stack, untar configRoot + state, restart."""
    import tarfile

    if not input_file.exists():
        log.error("Backup file %s not found", input_file)
        sys.exit(1)

    config_root = paths.config_root()
    log.info("Restore plan: %s → %s + %s", input_file, config_root, state_path)

    if dry_run:
        with tarfile.open(input_file, "r:gz") as tar:
            members = tar.getmembers()
            log.info("[DRY RUN] Would extract %d entries (%.1f MB on disk) "
                     "and restart stack",
                     len(members),
                     sum(m.size for m in members) / (1024 * 1024))
        return

    log.info("Stopping stack before restoring on-disk state…")
    docker.down()

    cr_path = Path(config_root)
    cr_path.mkdir(parents=True, exist_ok=True)
    state_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with tarfile.open(input_file, "r:gz") as tar:
            for member in tar.getmembers():
                # configRoot/ entries → extract under PathResolver.config_root().
                # metadata/state.json → state_path.
                # metadata/{manifest,config}.json → log only — restoring
                #   them would clobber the orchestrator's input files
                #   which the user controls.
                if member.name.startswith("configRoot/"):
                    relpath = member.name[len("configRoot/"):]
                    if not relpath:
                        continue
                    member.name = relpath
                    tar.extract(member, cr_path)
                elif member.name == "metadata/state.json":
                    extracted = tar.extractfile(member)
                    if extracted:
                        with state_path.open("wb") as out:
                            out.write(extracted.read())
                        os.chmod(state_path, 0o600)
                # Skip metadata/manifest.json and metadata/config.json
                # — those came from a specific deploy and the user's
                # current bundle's copies should win.
    except Exception as e:
        log.error("Restore failed: %s — stack remains stopped, fix the "
                  "issue and re-run --restore", e)
        sys.exit(3)

    log.info("Restore complete. Restarting stack…")
    try:
        docker.up()
    except SystemExit:
        log.warning("Stack restart skipped — start it manually with "
                    "`docker compose up -d` once you've sorted out docker.")


def do_status(
    *, output_file: Path, output_dir: Path, docker: "DockerRunner",
    dry_run: bool = False,
) -> None:
    """Snapshot the running stack to `status.json` for the wizard's
    healthcheck panel. Runs `docker compose ps --format json` and
    extracts per-service health/state into a stable shape that the
    frontend can render directly.

    Output schema (frontend reads this verbatim):
        {
          "generatedAt": "<iso-timestamp>",
          "services": [
            {
              "name": "sonarr",
              "image": "lscr.io/linuxserver/sonarr:latest",
              "state": "running" | "exited" | "restarting" | "...",
              "health": "healthy" | "unhealthy" | "starting" | "none",
              "uptime": "<docker-style duration string>",
              "ports":  ["8989/tcp -> 0.0.0.0:8989", ...],
              "exitCode": 0
            },
            ...
          ]
        }

    The frontend renders unknown enums passthrough-style ("starting →
    yellow dot, healthy → green, anything else → red"), so it's OK if
    docker adds new states later — we'll surface them as text.
    """
    import json as _json
    import datetime as _dt

    if dry_run:
        log.info("[DRY RUN] Would run `docker compose ps --format json` "
                 "and write %s", output_file)
        return

    # `ps --format json` emits one JSON-line-per-service since compose
    # v2.x; older versions emitted a single JSON array. Handle both.
    result = docker._run(["ps", "--format", "json", "--all"])  # noqa: SLF001
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        log.error("docker compose ps failed (rc=%d): %s",
                  result.returncode, stderr)
        sys.exit(2)

    raw = result.stdout.decode("utf-8", errors="replace").strip()
    services: list[dict] = []
    if raw:
        # Try array form first; fall back to JSONL.
        parsed: list[dict] = []
        try:
            data = _json.loads(raw)
            parsed = data if isinstance(data, list) else [data]
        except _json.JSONDecodeError:
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed.append(_json.loads(line))
                except _json.JSONDecodeError:
                    log.warning("Skipping unparseable ps line: %r", line[:80])

        for entry in parsed:
            # Compose ps fields vary slightly by version. Prefer the
            # camelCase-ish keys, fall back to lowercase.
            health = (entry.get("Health") or
                      entry.get("health") or "none")
            services.append({
                "name":     entry.get("Service") or entry.get("Name", "?"),
                "image":    entry.get("Image", "?"),
                "state":    entry.get("State", "unknown"),
                "health":   health.lower() if isinstance(health, str) else "none",
                "uptime":   entry.get("Status", ""),
                "ports":    [p.strip() for p in (
                                entry.get("Publishers")
                                or entry.get("Ports")
                                or "").split(",") if p.strip()] if isinstance(
                                    entry.get("Publishers")
                                    or entry.get("Ports"), str) else
                            entry.get("Publishers") or [],
                "exitCode": entry.get("ExitCode", 0),
            })

    payload = {
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "services":    services,
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(_json.dumps(payload, indent=2))
    log.info("Wrote stack status for %d service(s) to %s",
             len(services), output_file)


def main() -> int:
    parser = argparse.ArgumentParser(description="Surge deploy orchestrator")
    parser.add_argument("--manifest", required=True, type=Path,
                        help="Path to schema export JSON")
    parser.add_argument("--config", required=True, type=Path,
                        help="Path to wizard config JSON")
    parser.add_argument("--state-dir", default=Path(".surge"), type=Path,
                        help="Where state.json lives (default: ./.surge)")
    parser.add_argument("--output-dir", default=Path("surge-deploy"), type=Path,
                        help="Where compose.yml + seeded files land "
                             "(default: ./surge-deploy)")
    parser.add_argument("--scripts-dir", default=Path("scripts"), type=Path,
                        help="Where fetch-/configure-*.py scripts live "
                             "(default: ./scripts — relative to bundle root)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Resolve everything, don't write or run")
    parser.add_argument("--skip-up", action="store_true",
                        help="Write artifacts but skip docker compose up")
    parser.add_argument("--skip-scripts", action="store_true",
                        help="Don't run fetch/configure scripts")
    parser.add_argument("--verbose", action="store_true")
    # --backup / --restore are mutually-exclusive subflows that don't
    # run the deploy pipeline. Each takes a tarball path; defaults
    # land alongside state.json so backups are easy to locate.
    parser.add_argument("--backup", metavar="FILE", type=Path, nargs='?',
                        const='__default__',
                        help="Stop stack, archive configRoot + state.json into "
                             "FILE (default: .surge/backups/surge-backup-<ts>.tar.gz), "
                             "restart stack")
    parser.add_argument("--restore", metavar="FILE", type=Path,
                        help="Stop stack, restore configRoot + state.json from "
                             "FILE, restart stack")
    parser.add_argument("--status", metavar="FILE", type=Path, nargs='?',
                        const='__default__',
                        help="Snapshot live container health to FILE "
                             "(default: .surge/status.json) — upload "
                             "into the wizard's healthcheck panel")
    args = parser.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    if args.dry_run:
        log.warning("DRY_RUN — no files written, no containers started, "
                    "no scripts run.")

    # Load inputs.
    log.info("Loading manifest %s", args.manifest)
    manifest = Manifest.load(args.manifest)
    log.info("Loading config %s", args.config)
    config = Config.load(args.config)

    state_path = args.state_dir / "state.json"
    state = State.load(state_path)
    paths = PathResolver(config)

    # Backup / restore short-circuit the deploy pipeline. They're
    # whole-stack ops the user runs occasionally, not part of the
    # routine deploy flow.
    if args.backup is not None:
        if args.backup == Path('__default__'):
            from datetime import datetime
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            args.backup = args.state_dir / "backups" / f"surge-backup-{stamp}.tar.gz"
        docker = DockerRunner(args.output_dir, dry_run=args.dry_run)
        do_backup(
            output_file=args.backup,
            manifest_path=args.manifest, config_path=args.config,
            config=config, state_path=state_path, paths=paths,
            docker=docker, dry_run=args.dry_run,
        )
        return 0

    if args.restore:
        docker = DockerRunner(args.output_dir, dry_run=args.dry_run)
        do_restore(
            input_file=args.restore,
            paths=paths, state_path=state_path,
            docker=docker, dry_run=args.dry_run,
        )
        return 0

    if args.status is not None:
        if args.status == Path('__default__'):
            args.status = args.state_dir / "status.json"
        docker = DockerRunner(args.output_dir, dry_run=args.dry_run)
        do_status(
            output_file=args.status, output_dir=args.output_dir,
            docker=docker, dry_run=args.dry_run,
        )
        return 0

    enabled = config.enabled_services(manifest)
    log.info("Enabled services: %s",
             ", ".join(k for k, _ in enabled) or "(none)")
    if not enabled:
        log.error("No services enabled in config — nothing to deploy.")
        return 1

    # Phase 1: secrets.
    materialize_secrets(manifest, config, state)
    if not args.dry_run:
        state.save(state_path)
        log.info("Secrets persisted to %s", state_path)

    # Phase 2: render compose.yml + write seeded files.
    log.info("Rendering compose.yml")
    compose_doc = render_compose(manifest, config, state, paths)
    compose_yaml = "# Generated by surge_orchestrator.py — do not edit by hand.\n" + \
                   to_yaml(compose_doc) + "\n"

    output_dir: Path = args.output_dir
    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        compose_path = output_dir / "compose.yaml"
        compose_path.write_text(compose_yaml)
        log.info("Wrote %s", compose_path)
    else:
        log.info("[DRY RUN] Would write compose.yaml (%d bytes)",
                 len(compose_yaml))
        if args.verbose:
            log.debug("compose.yaml:\n%s", compose_yaml)

    log.info("Writing seeded compose.files entries")
    write_seeded_files(manifest, config, state, paths, dry_run=args.dry_run)

    if args.skip_up:
        log.info("--skip-up set; stopping after artifact generation.")
        return 0

    # Phase 3: docker compose up. In --dry-run mode this only logs the
    # command rather than executing it, but we still walk the rest of
    # the pipeline so the user can preview the full plan including
    # script execution.
    docker = DockerRunner(output_dir, dry_run=args.dry_run)
    docker.up()

    if args.skip_scripts:
        log.info("--skip-scripts set; not running fetch/configure scripts.")
        return 0

    # Phase 4 + 5: scripts. fetchScripts first (capture runtime values),
    # then postDeployScripts (consume them). In --dry-run, ScriptRunner
    # logs the would-run command + redacted env without executing.
    runner = ScriptRunner(args.scripts_dir, paths, dry_run=args.dry_run)
    run_fetch_scripts(manifest, config, state, paths, runner)
    if not args.dry_run:
        state.save(state_path)
    run_post_deploy_scripts(manifest, config, state, paths, runner)
    if not args.dry_run:
        state.save(state_path)

    if args.dry_run:
        log.info("Dry-run complete — no containers started, no state mutated.")
    else:
        log.info("Deploy complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log.warning("Interrupted")
        sys.exit(130)
