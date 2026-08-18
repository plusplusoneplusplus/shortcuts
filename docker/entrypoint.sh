#!/bin/sh
# CoC container entrypoint: optional first-boot seeding, then `exec coc serve`.
#
# Everything here is optional and idempotent. The final `exec` keeps `coc serve`
# as the direct child of tini so SIGTERM reaches it and the queue drains.
#
# Env contract (all optional; the managed-service provisioner is the main consumer):
#   COC_INIT_CONFIG      config.yaml to copy to <dataDir>/config.yaml if none exists (seed, never overwrite)
#   COC_INIT_REPOS       comma/newline-separated git URLs (or url#branch); cloned into $COC_WORK_DIR/<name>
#                        if absent, then registered as workspaces once the server is healthy
#   COC_INIT_SKILLS_DIR  directory of extra skills copied into <dataDir>/skills (entries not already present)
#   COC_PORT             port used by the health/registration probe when --port is not in the args (default 4000)
#   COC_WORK_DIR         where repos live (default /work)
#   GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL   written to $HOME/.gitconfig if no gitconfig exists
#   COPILOT_GITHUB_TOKEN / GH_TOKEN / ANTHROPIC_API_KEY / OPENAI_API_KEY   passed straight through
#
# Args are passed verbatim to `coc serve --no-open` (the image CMD supplies
# --host 127.0.0.1 --port 4000 --data-dir /data/.coc).
set -u

log() {
    printf '[coc-entrypoint] %s\n' "$*" >&2
}

HOME="${HOME:-/data}"
WORK_DIR="${COC_WORK_DIR:-/work}"
PORT="${COC_PORT:-4000}"
DATA_DIR="${HOME}/.coc"

# Mirror --port / --data-dir from the args so the probe and seeding agree with the server.
prev=""
for arg in "$@"; do
    case "$prev" in
        --port|-p) PORT="$arg" ;;
        --data-dir|-d) DATA_DIR="$arg" ;;
    esac
    case "$arg" in
        --port=*) PORT="${arg#--port=}" ;;
        --data-dir=*) DATA_DIR="${arg#--data-dir=}" ;;
    esac
    prev="$arg"
done

mkdir -p "$DATA_DIR" 2>/dev/null || log "warning: could not create data dir $DATA_DIR"

# --- git identity ---------------------------------------------------------
if [ ! -f "$HOME/.gitconfig" ] && [ -n "${GIT_AUTHOR_NAME:-}" ] && [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
    printf '[user]\n\tname = %s\n\temail = %s\n' "$GIT_AUTHOR_NAME" "$GIT_AUTHOR_EMAIL" > "$HOME/.gitconfig" \
        && log "wrote $HOME/.gitconfig for $GIT_AUTHOR_NAME"
fi

# --- one-time seeding (config, skills) ------------------------------------
MARKER="$DATA_DIR/.docker-init-done"
if [ ! -f "$MARKER" ]; then
    if [ -n "${COC_INIT_CONFIG:-}" ]; then
        if [ -f "$DATA_DIR/config.yaml" ]; then
            log "config.yaml already exists; not overwriting with COC_INIT_CONFIG"
        elif [ -f "$COC_INIT_CONFIG" ]; then
            cp "$COC_INIT_CONFIG" "$DATA_DIR/config.yaml" && log "seeded config.yaml from $COC_INIT_CONFIG"
        else
            log "COC_INIT_CONFIG=$COC_INIT_CONFIG does not exist; skipping"
        fi
    fi

    if [ -n "${COC_INIT_SKILLS_DIR:-}" ]; then
        if [ -d "$COC_INIT_SKILLS_DIR" ]; then
            mkdir -p "$DATA_DIR/skills"
            for skill in "$COC_INIT_SKILLS_DIR"/*; do
                [ -e "$skill" ] || continue
                base=$(basename "$skill")
                if [ -e "$DATA_DIR/skills/$base" ]; then
                    log "skill $base already present; skipping"
                else
                    cp -R "$skill" "$DATA_DIR/skills/$base" && log "seeded skill $base"
                fi
            done
        else
            log "COC_INIT_SKILLS_DIR=$COC_INIT_SKILLS_DIR is not a directory; skipping"
        fi
    fi

    : > "$MARKER" 2>/dev/null || log "warning: could not write $MARKER"
fi

# --- repos: clone if absent (every boot; a failed clone is retried next boot) --
REPO_DIRS=""
if [ -n "${COC_INIT_REPOS:-}" ]; then
    mkdir -p "$WORK_DIR" 2>/dev/null || true
    for entry in $(printf '%s' "$COC_INIT_REPOS" | tr ',' '\n'); do
        [ -n "$entry" ] || continue
        url="$entry"
        branch=""
        case "$entry" in
            *#*) url="${entry%#*}"; branch="${entry#*#}" ;;
        esac
        name="${url%/}"
        name="${name##*/}"
        name="${name##*:}"
        name="${name%.git}"
        name=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
        if [ -z "$name" ] || [ "$name" = "." ] || [ "$name" = ".." ]; then
            log "cannot derive a repo name from '$entry'; skipping"
            continue
        fi
        target="$WORK_DIR/$name"
        if [ -e "$target" ]; then
            log "repo $name already present at $target"
        else
            log "cloning $url into $target"
            if [ -n "$branch" ]; then
                git clone --branch "$branch" -- "$url" "$target" || { log "clone of $url failed; will retry next boot"; continue; }
            else
                git clone -- "$url" "$target" || { log "clone of $url failed; will retry next boot"; continue; }
            fi
        fi
        REPO_DIRS="$REPO_DIRS $target"
    done
fi

# --- register repos as workspaces once the server is healthy (background) --
register_repos() {
    base="http://127.0.0.1:${PORT}"
    i=0
    until curl -sf -o /dev/null "$base/api/health"; do
        i=$((i + 1))
        if [ "$i" -ge 120 ]; then
            log "server not healthy after ${i}s; skipping workspace registration"
            return 0
        fi
        sleep 1
    done
    existing=$(curl -sf "$base/api/workspaces" 2>/dev/null || printf '')
    for dir in $REPO_DIRS; do
        if printf '%s' "$existing" | grep -qF "\"rootPath\":\"$dir\""; then
            log "workspace $dir already registered"
            continue
        fi
        name=$(basename "$dir")
        if curl -sf -o /dev/null -X POST -H 'Content-Type: application/json' \
            --data "{\"name\":\"$name\",\"rootPath\":\"$dir\"}" "$base/api/workspaces"; then
            log "registered workspace $dir"
        else
            log "failed to register workspace $dir"
        fi
    done
}
if [ -n "$REPO_DIRS" ]; then
    register_repos &
fi

exec coc serve --no-open "$@"
