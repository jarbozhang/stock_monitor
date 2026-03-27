#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"
AUTH_FILE="$SCRIPT_DIR/auth.local.json"
SESSION_NAME="${ALPHAPAI_BROWSER_SESSION:-alphapai-browser-fallback}"
PHONE="${1:-${ALPHAPAI_PHONE:-}}"
PASSWORD="${2:-${ALPHAPAI_PASSWORD:-}}"

if [[ -z "$PHONE" || -z "$PASSWORD" ]] && [[ -f "$AUTH_FILE" ]]; then
  AUTH_JSON="$(python3 - <<'PY' "$AUTH_FILE"
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
obj=json.loads(p.read_text())
print(json.dumps({"phone": obj.get("phone", ""), "password": obj.get("password", "")}))
PY
)"
  FILE_PHONE="$(python3 - <<'PY' "$AUTH_JSON"
import json, sys
print(json.loads(sys.argv[1]).get("phone", ""))
PY
)"
  FILE_PASSWORD="$(python3 - <<'PY' "$AUTH_JSON"
import json, sys
print(json.loads(sys.argv[1]).get("password", ""))
PY
)"
  [[ -z "$PHONE" ]] && PHONE="$FILE_PHONE"
  [[ -z "$PASSWORD" ]] && PASSWORD="$FILE_PASSWORD"
fi

if [[ -z "$PHONE" || -z "$PASSWORD" ]]; then
  echo "Usage: refresh-auth-via-agent-browser.sh <phone> <password>" >&2
  echo "Or set ALPHAPAI_PHONE / ALPHAPAI_PASSWORD env vars." >&2
  echo "Or create $AUTH_FILE with {\"phone\":\"...\",\"password\":\"...\"}." >&2
  exit 1
fi

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser not found. Install it first: npm install -g agent-browser" >&2
  exit 1
fi

agent-browser install >/dev/null 2>&1 || true
agent-browser --session "$SESSION_NAME" open https://alphapai-web.rabyte.cn/ >/dev/null
agent-browser --session "$SESSION_NAME" wait --load networkidle >/dev/null || true
agent-browser --session "$SESSION_NAME" find text "账号密码登录" click >/dev/null || true
agent-browser --session "$SESSION_NAME" wait 800 >/dev/null || true
agent-browser --session "$SESSION_NAME" find placeholder "请输入手机号" fill "$PHONE" >/dev/null
agent-browser --session "$SESSION_NAME" find placeholder "请输入密码" fill "$PASSWORD" >/dev/null
agent-browser --session "$SESSION_NAME" press Enter >/dev/null
agent-browser --session "$SESSION_NAME" wait --text "首页" >/dev/null

AUTH_JSON="$(agent-browser --session "$SESSION_NAME" eval 'JSON.stringify({authorization: localStorage.getItem("USER_AUTH_TOKEN"), secretKey: localStorage.getItem("SECRET_KEY"), xDevice: localStorage.getItem("xDevice"), vtToken: localStorage.getItem("vt_token")})')"
AUTH_JSON="${AUTH_JSON#\"}"
AUTH_JSON="${AUTH_JSON%\"}"
AUTH_JSON="${AUTH_JSON//\\\"/\"}"
AUTH_JSON="${AUTH_JSON//\\n/}"
AUTH_JSON="${AUTH_JSON//\\\\/\\}"

python3 - "$CONFIG_FILE" "$AUTH_JSON" <<'PY'
import json, sys
from pathlib import Path
cfg_path = Path(sys.argv[1])
auth = json.loads(sys.argv[2])
if cfg_path.exists():
    cfg = json.loads(cfg_path.read_text())
else:
    cfg = {}
if auth.get('authorization'):
    cfg['authorization'] = auth['authorization']
if auth.get('secretKey'):
    cfg['secretKey'] = auth['secretKey']
if auth.get('xDevice'):
    cfg['xDevice'] = auth['xDevice']
if not cfg.get('baseUrl'):
    cfg['baseUrl'] = 'https://alphapai-web.rabyte.cn'
if not cfg.get('pageSize'):
    cfg['pageSize'] = 50
cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))
print('updated_config', cfg_path)
print('synced_after_agent_browser_login', 'yes')
print('authorization', 'ok' if bool(cfg.get('authorization')) else 'missing')
print('xDevice', 'ok' if bool(cfg.get('xDevice')) else 'missing')
print('secretKey', 'ok' if bool(cfg.get('secretKey')) else 'missing')
PY
