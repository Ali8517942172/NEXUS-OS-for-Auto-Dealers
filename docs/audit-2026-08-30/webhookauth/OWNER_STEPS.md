# What Ali has to do himself

Plain language, in order. Nothing here needs programming. Where you have to
invent a password, use a long random one — 32 or more letters and digits, no
spaces, no quotes, no `#`, no `$`. A password manager's "generate" button is fine.

Do not do all three parts on the same evening. Part A and Part B are safe any
time. **Part C touches WhatsApp, which is the only way customers can reach the
business right now** — do that one late at night, and read it all the way through
before you start.

---

## Part A — Slack (5 minutes, safe any time)

The Slack command has never worked. Not "works badly" — it has run zero times
since it was built, because it asks Slack for a login token that Slack is not
able to send. But the web address it listens on is open to the whole internet,
and anyone who found it could use it to read and change customer records. So we
are turning it off.

1. Ask whoever applies the n8n changes to apply `OPERATIONS_slack.json` first.
2. Open n8n in your browser: `https://35.224.126.225.nip.io`
3. Open the workflow **Slack Command Center - AI Agent**.
4. Top right, there is an **Active** switch. Turn it **off**. Confirm if asked.
5. That's it. The address `/webhook/slack-command` now answers "not found" to
   everyone. Nothing else in the business uses it, so nothing else changes.
6. If you have a Slack app with a `/nexus` command in it, go to
   <https://api.slack.com/apps> → your app → **Slash Commands** → delete the
   `/nexus` command. This is only tidying up so nobody is confused later.

If you ever want Slack commands to actually work, that is a separate small
project — the recipe is written down at the end of `DESIGN.md`. Do not just
switch this workflow back on; it still would not work.

---

## Part B — the health probe (15 minutes, safe any time)

Right now there is an address, `/webhook/infra-probe`, that anybody on the
internet can open. It tells them the dealership's connected WhatsApp number and
the exact web address that WhatsApp messages arrive on. That is how someone
would find the address you are about to protect in Part C. It also always
reports "OK" even when WhatsApp is completely dead, which makes it useless as a
health check.

1. Have `OPERATIONS_probe.json` applied in n8n.

2. **Invent a probe password.** Write it in your password manager as
   "NEXUS probe key". Example shape (make your own, do not use this one):
   `pk_7Qh2Xv9Lm4Rt8Nc3Bz6Ws1Ye5Ku0Aj`

3. **Put it in the server settings file.** Connect to the server and open
   `/opt/nexus/.env` in a text editor. Add one new line at the bottom:

   ```
   NEXUS_PROBE_KEY=pk_7Qh2Xv9Lm4Rt8Nc3Bz6Ws1Ye5Ku0Aj
   ```

   No spaces around the `=`. No quotes. Save the file.

4. **Restart n8n so it reads the new setting.** In the same folder:

   ```
   docker compose up -d n8n
   ```

   Wait about half a minute.

5. **Check it worked.** In a browser, open
   `https://35.224.126.225.nip.io/webhook/infra-probe` with no password.
   You should now get an error saying `unauthorized` — that is correct, it means
   strangers are locked out.

   Now open, replacing the key with yours:
   `https://35.224.126.225.nip.io/webhook/infra-probe?key=pk_7Qh2Xv9Lm4Rt8Nc3Bz6Ws1Ye5Ku0Aj`

   You should get a small report saying `"verdict": "PASS"`. Notice it no longer
   shows your WhatsApp number or any addresses. That is deliberate.

6. **Bookmark that second address.** It is now a genuine health check: `PASS`
   means WhatsApp is connected and working, `FAIL` means it is not, and it tells
   you why. The system will also check itself every 15 minutes from now on and
   raise an alert the first time it fails.

**To undo Part B:** put a `#` at the start of the `NEXUS_PROBE_KEY` line in
`/opt/nexus/.env`, save, and run `docker compose up -d n8n` again.

---

## Part C — the WhatsApp address (do this at night)

This is the important one and the risky one. Read all of it first.

Today, anybody on the internet who knows the address
`/webhook/whatsapp-inbound` can make **your** WhatsApp number send a message to
**any** phone number they choose, and can create fake customer records in your
database. We are going to require a password on every message WAHA delivers.

The danger is obvious: if the password does not match, WhatsApp messages from
real customers stop being answered. So this is done in three stages, and after
each stage you check that real messages still work before going further. **In
stages 1 and 2 nothing is blocked at all** — the system only watches and reports.

### Stage 1 — install the check, switched off

1. Have `OPERATIONS_bdc.json` applied in n8n.
2. Send yourself a WhatsApp message to the dealership number from your personal
   phone. **The bot must reply as normal.** If it does not, stop and undo (see
   "If anything goes wrong" below). Nothing has been switched on yet, so this
   should simply work.

### Stage 2 — set the password, still not enforcing

3. **Invent a WhatsApp webhook password.** Save it in your password manager as
   "NEXUS WhatsApp webhook secret". Different from the probe key. Example shape:
   `ws_4Kd8Pn2Vx6Hm9Tq1Lc5Rb3Zj7Yf0Ge`

4. Open `/opt/nexus/.env` and add one line at the bottom:

   ```
   WAHA_WEBHOOK_SECRET=ws_4Kd8Pn2Vx6Hm9Tq1Lc5Rb3Zj7Yf0Ge
   ```

   Do **not** add the second line (`WAHA_WEBHOOK_ENFORCE`) yet. Save.

5. Restart n8n: `docker compose up -d n8n`. Wait 30 seconds.
   *(For that half a minute, a customer message would not get a reply. That is
   why this is a night job.)*

6. Send yourself another test WhatsApp. **The bot must still reply.** At this
   stage the system is only watching — nothing is being blocked — so if the reply
   stops here, something unrelated is wrong and you should stop.

### Stage 3 — tell WAHA to send the password

7. Open the WAHA dashboard: `http://<the server>:3000/dashboard` (whoever set up
   the server knows the exact address; it is the same container the health probe
   talks to).

8. Find the session called **default** and open its settings, where the webhook
   address `https://35.224.126.225.nip.io/webhook/whatsapp-inbound` is listed.

9. On that webhook entry there is a section for **custom headers** (some versions
   call it "Headers"). Add one:

   | Field | What to type |
   |---|---|
   | Name / Key | `X-Nexus-Webhook-Secret` |
   | Value | the password from step 3, exactly, no spaces |

   Save. Do not change the address, the events list, or anything else.

   If your WAHA dashboard has no such box, whoever runs the server can do the
   same thing by re-sending the session configuration with a `customHeaders`
   entry on the webhook. Give them the header name and the password.

10. **Now watch for a day.** In n8n, open **WhatsApp BDC AI Agent** → the three
    dots at the top → **Settings** → set **Save successful production executions**
    to **Save**. (Turn this back to "Do not save" when you are done at step 12 —
    it fills up the database.)

11. Send test WhatsApps, and let a few real customer messages come in. In n8n open
    **Executions** for this workflow, click a run, and click the **WAHA Auth Gate**
    node. In its output you want to see:

    ```
    "_gate": { "ok": true, "header_present": true, "enforcing": false }
    ```

    `ok: true` means WAHA is sending the password correctly. **If you see
    `ok: false` or `header_present: false` on real messages, the header is not
    set up right — go back to step 9 and fix it. Do not continue.** Nothing is
    being blocked yet, so there is no rush and no damage.

### Stage 4 — switch enforcement on

12. Only once every recent real message shows `ok: true`:
    open `/opt/nexus/.env`, add the second line:

    ```
    WAHA_WEBHOOK_ENFORCE=true
    ```

    Save, then `docker compose up -d n8n`, wait 30 seconds.

13. Send one more real test WhatsApp from your phone. The bot must reply.
    Then set **Save successful production executions** back to **Do not save**.

Done. From this point, a stranger who knows the address gets nothing: no reply
sent, no money spent, no records created.

### If anything goes wrong — undo, fastest first

* **Customers are not getting replies and you need it fixed right now (10
  seconds, no restart):** in n8n open **WhatsApp BDC AI Agent**, right-click the
  node called **WAHA Auth Gate**, choose **Deactivate** (disable), and **Save**.
  The check is skipped and everything works exactly as it did before. Do this
  first and investigate afterwards.
* **Slower undo:** put a `#` at the start of the `WAHA_WEBHOOK_ENFORCE` line in
  `/opt/nexus/.env`, save, `docker compose up -d n8n`. Back to watching only.
* **Full undo:** also put a `#` in front of `WAHA_WEBHOOK_SECRET`, save, restart.
* **Complete undo:** in n8n, workflow → three dots → **Versions**, and restore
  the version from before the change.

### Two things to remember afterwards

* The two passwords are now the keys to your WhatsApp channel. Keep them in the
  password manager. Never paste them into a chat, an email, or a GitHub file.
* If you ever change the WhatsApp webhook password, change it in **both** places —
  `/opt/nexus/.env` (then restart n8n) and the WAHA custom header. Change WAHA
  first, then the `.env`, or briefly turn `WAHA_WEBHOOK_ENFORCE` off while you do
  both.
