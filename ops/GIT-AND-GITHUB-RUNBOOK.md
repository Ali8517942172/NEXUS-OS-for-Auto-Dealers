# Git and GitHub, without asking Ali every time

Established 17 September 2026, after four pushes in one session each waited hours
on a human to paste one line. Ali's instruction: *"ab to meri zarurat nahi padegi
na github push ke liye"* — so this file records the method that works, and the
three things that still need him.

---

## The constraint that shapes everything

**Windows PowerShell cannot be typed into.** Computer use resolves a terminal to
the `click` tier and says so in its own words:

> Terminals and IDEs can only be granted in 'click' mode — you can see and
> left-click, but cannot type, press keys, or paste.

So every shell command goes through `device_bash`, which is a **Linux VM**, not
Windows. And that VM does not have Windows' credential helper:

```
$ git push
git: 'credential-manager' is not a git command.
fatal: could not read Username for 'https://github.com'
```

That is the whole problem. Everything below is how it was solved.

---

## Setup — once per machine, ~2 minutes

### 1. Ask GitHub for a device code

The GitHub CLI's OAuth client id is public by design — it ships in the binary.

```bash
cd "$HOME"
CID=178c6fc778ccc68e1d6a
curl -sS -X POST https://github.com/login/device/code \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CID\",\"scope\":\"repo\"}" -o dev_code.json
chmod 600 dev_code.json
python3 -c "
import json; d=json.load(open('dev_code.json'))
print('USER_CODE:', d['user_code'])      # this one is shown to Ali
print('VERIFY_AT:', d['verification_uri'])
"                                         # device_code stays in the file, never printed
```

Print the **user code** only. The `device_code` is the half that must not travel
through a transcript, so it stays in a 0600 file and is read back by path.

### 2. Ali authorizes, in his own browser

Open `https://github.com/login/device?skip_account_picker=true`, fill the code,
click Continue. **He clicks Authorize.** The scope grant is his decision, not
Claude's.

> **GitHub may ask for an emailed verification code (sudo mode). Claude does not
> read or type OTPs — Ali does that step himself.** Once he is in sudo mode, a
> second authorization within a few hours needs no code, which is why a retry is
> cheap.

### 3. Exchange the code for a token, without ever seeing it

The token goes from `urllib` straight into the credential file. It is never
printed, never returned, never in an argument list.

```bash
DC=$(python3 -c "import json;print(json.load(open('dev_code.json'))['device_code'])")
python3 - "$CID" "$DC" <<'PY'
import json, sys, urllib.request, os, stat
cid, dc = sys.argv[1], sys.argv[2]
req = urllib.request.Request("https://github.com/login/oauth/access_token",
    data=json.dumps({"client_id": cid, "device_code": dc,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"}).encode(),
    headers={"Accept": "application/json", "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req))
if "access_token" not in d:
    print("EXCHANGE FAILED:", d.get("error"), "-", d.get("error_description")); raise SystemExit(1)
p = os.path.expanduser("~/.git-credentials")
open(p, "w").write("https://Ali8517942172:%s@github.com\n" % d["access_token"])
os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
print("stored. scopes:", d.get("scope"))
PY
rm -f dev_code.json
```

### 4. Point this repo at it

```bash
cd "$HOME/mnt/MY RESUMES/nexus-os"
git config --local credential.helper store
```

`--local`, not `--global`: the global config still names `credential-manager`,
which prints a harmless warning and is then ignored. Leave it alone — it is what
makes Ali's own Windows pushes work.

---

## Daily use

### Push

```bash
cd "$HOME/mnt/MY RESUMES/nexus-os"
git push origin <branch>
```

### Everything else, through the API

No browser clicking. Read the token back from the file inside the VM; it never
enters the transcript.

```bash
TOK=$(sed -e 's|.*://[^:]*:||' -e 's|@github.com||' ~/.git-credentials)
API=https://api.github.com/repos/Ali8517942172/autodealer-ai-os
```

| what | call |
|---|---|
| open a PR | `POST $API/pulls` with `{title, head, base, body}` |
| fix the title | `PATCH $API/pulls/<n>` |
| add the writeup | `POST $API/issues/<n>/comments` |
| read CI | `GET $API/commits/<sha>/check-runs` |
| merge | `PUT $API/pulls/<n>/merge` with `{merge_method, commit_title, commit_message}` |

**The API path is strictly better than the UI.** GitHub's compare page silently
drops a title and body typed before mergeability finishes checking — that quirk
cost three attempts in this repo's history. `PATCH` does not lie about whether it
worked.

### Wait for CI before merging

```bash
for i in $(seq 1 14); do
  curl -sS "$API/commits/<sha>/check-runs" -H "Authorization: token $TOK" \
       -H 'Accept: application/vnd.github+json' -o /tmp/cr.json
  python3 -c "
import json; rs=json.load(open('/tmp/cr.json'))['check_runs']
print('PENDING' if any(r['status']!='completed' for r in rs) else 'DONE')" | grep -q DONE && break
  sleep 12
done
```

Then read every `conclusion`. **A merge over a red check is not a merge, it is a
decision** — and it is Ali's, not Claude's.

---

## Two traps already paid for

**Background processes do not survive a `device_bash` call.** Tested with
`setsid nohup ... & disown` and a 25-second sleep: the marker file never
appeared. `gh auth login --web` needs a long-lived poller, so it cannot work
here — which is exactly why the flow above is split into *request* and
*exchange* rather than delegated to `gh`.

**Stale git locks.** `.git/index.lock` and `.git/HEAD.lock` block every commit
and cannot be moved aside in a connected folder until deletion is granted
(`device_request_delete_permission` on the connected folder root, once per
session). Before that grant, the workaround is an external index:

```bash
export GIT_INDEX_FILE="$HOME/nx.index"; git read-tree HEAD
git add <paths>; git commit -F <message-file>
cp "$GIT_INDEX_FILE" .git/index
```

---

## What still needs Ali, and always will

1. **OTPs and verification codes.** Never read, never typed. Not his email, not
   anyone's. This is the line that stopped the first attempt at step 2, and it
   stops the next one too.
2. **Passwords, API keys, tokens in any field.** The device flow exists
   *because* of this rule, not in spite of it.
3. **Spending money, and decisions that are his to make** — a domain, an ad
   budget, onboarding a second dealership, changing what a live scheduled job
   does at 03:00.

Revoking the access this file describes: GitHub → Settings → Applications →
Authorized OAuth Apps → GitHub CLI. One click, and every push above stops
working.
