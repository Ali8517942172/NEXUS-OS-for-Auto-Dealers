#!/usr/bin/env python3
"""NX1007-cloud: add the BDC handoff to the live WhatsApp Cloud Inbound
Receiver (J8MXprxVw1yhjBpp). Adds exactly ONE node and ONE new connection:
after the receiver has HMAC-verified the delivery, resolved the tenant, and
recorded the customer service window, it ALSO hands the message to the BDC
candidate (LTBExI7QzFeANeFg) via Execute Workflow, fire-and-forget
(waitForSubWorkflow:false), same pattern and reasoning as this workflow's own
'Score New Lead (Master Router)' node in the BDC candidate: the webhook
response to Meta (Respond 200 Recorded) is not held open waiting on an LLM +
Graph API round trip, and a slow or failing BDC run cannot make Meta's
retries pile up.

Nothing about the receiver's existing HMAC verification, tenant resolution,
or window recording changes. This is additive only.

Never writes to n8n. Read-only source: ops/bdc-cloud-send/live/J8MXprxVw1yhjBpp.json
Output: ops/bdc-cloud-send/patched/J8MXprxVw1yhjBpp.json
"""
import json, uuid, os

LIVE = "ops/bdc-cloud-send/live/J8MXprxVw1yhjBpp.json"
OUT = "ops/bdc-cloud-send/patched/J8MXprxVw1yhjBpp.json"
BDC_ID = "LTBExI7QzFeANeFg"


def nid():
    return uuid.uuid4().hex[:8]


def main():
    w = json.load(open(LIVE))
    conns = w["connections"]

    src = "Open Or Extend Customer Service Window"
    assert src in conns, "receiver connections changed shape, review before patching"
    existing_targets = [o["node"] for o in conns[src]["main"][0]]
    assert existing_targets == ["Respond 200 Recorded"], existing_targets

    handoff = {
        "id": nid(),
        "name": "Hand Off To BDC Agent (Cloud)",
        "type": "n8n-nodes-base.executeWorkflow",
        "typeVersion": 1.3,
        "position": [1680, 320],
        "parameters": {
            "workflowId": {
                "__rl": True, "value": BDC_ID, "mode": "id",
                "cachedResultName": "WhatsApp BDC — TENANT SCOPED CANDIDATE (do not activate)",
            },
            "workflowInputs": {
                "mappingMode": "defineBelow",
                "value": {
                    "tenant_id": "={{ $('Resolve Tenant From Phone Number ID').item.json.tenant_id }}",
                    "tenant_slug": "={{ $('Resolve Tenant From Phone Number ID').item.json.tenant_slug }}",
                    "integration_id": "={{ $('Resolve Tenant From Phone Number ID').item.json.integration_id }}",
                    "phone_number_id": "={{ $('Resolve Tenant From Phone Number ID').item.json.external_identifier }}",
                    "customer_wa_id": "={{ $('Verify Or Refuse').item.json.customer_wa_id }}",
                    "message_id": "={{ $('Verify Or Refuse').item.json.message_id }}",
                    "occurred_at": "={{ $('Verify Or Refuse').item.json.occurred_at }}",
                    "message_kind": "={{ $('Verify Or Refuse').item.json.message_kind }}",
                    "text": "={{ $('Verify Or Refuse').item.json.text }}",
                    "customer_display_name": "={{ $('Verify Or Refuse').item.json.customer_name }}",
                    "waba_id": "={{ $('Verify Or Refuse').item.json.waba_id }}",
                },
            },
            "options": {"waitForSubWorkflow": False},
        },
        "onError": "continueRegularOutput",
        "notes": (
            "Fire-and-forget on purpose, same reasoning as the BDC candidate's own "
            "'Score New Lead (Master Router)' node: this runs an LLM agent and a Graph "
            "API send; Meta already has its 200 from 'Respond 200 Recorded' (same source "
            "item, parallel branch), so the webhook must never hold that response open "
            "waiting on this. waitForSubWorkflow:false also means a slow or failing BDC "
            "run can never turn into a Meta webhook retry storm. LTBExI7QzFeANeFg must stay "
            "'active:false' until the BDC-CUTOVER-RUNBOOK's Step 4+ is executed deliberately "
            "-- until then this node's target is an inactive workflow and Execute Workflow "
            "against an inactive sub-workflow still runs it (n8n does not require the "
            "target be active), so this node is live functionality, not inert wiring, the "
            "moment this patch is deployed. Land this node's deploy in the SAME change "
            "window as BDC-CUTOVER-RUNBOOK Step 4, not before."
        ),
    }

    w["nodes"].append(handoff)
    conns[src]["main"][0].append({"node": handoff["name"], "type": "main", "index": 0})

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(w, open(OUT, "w"), indent=1)
    print("wrote", OUT, "nodes=", len(w["nodes"]))


if __name__ == "__main__":
    main()
