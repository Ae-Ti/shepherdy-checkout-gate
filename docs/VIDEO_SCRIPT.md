# Demo video script (under 3:00)

Record on the Mac: browser on the left, terminal on the right. No music, or royalty-free music only. Show the
PayPal sandbox popup, but no real account or card data.

| Time | Scene (on screen) | Voice-over |
|---|---|---|
| 0:00–0:15 | Lumen Trails home page, then the booking page with the PayPal button | "AI coding tools can add PayPal to an app in minutes. Founders and agencies ship that code without being able to review it. This booking site was built that way. Does its checkout actually hold up?" |
| 0:15–0:35 | `git show` of the risky commit: amount sent from the button, `NEXT_PUBLIC_PAYPAL_CLIENT_SECRET` in next.config | "Here's a typical AI 'quick fix': the button now sends its own price, and the PayPal secret is exposed for debugging. It builds. It looks fine." |
| 0:35–1:05 | Terminal: `npm run loop -- --manual` → round 1 BLOCKED. Open `.gate/report.html`: red banner, "Browser asked to pay 0.01 / PayPal recorded 0.01, expected 120.00", S1 secret found in a browser chunk | "Shepherdy Checkout Gate doesn't guess from code. It sends one cent for a $120 booking and asks PayPal what it recorded. PayPal says one cent. It also finds the secret's exact value inside the JavaScript every visitor downloads. Blocked." |
| 1:05–1:35 | Terminal: fix brief with PP-01 / PP-06, agent tool calls (Read, Edit), "committed …" | "A fix agent on the Claude Agent SDK gets the failed rule IDs and PayPal's evidence. It can only edit source files in a copy that holds no secrets, and it cannot touch the gate. The verdict is still rule code, not AI." |
| 1:35–2:20 | Round 2: attacks pass; the PayPal sandbox popup opens; log in as the sandbox buyer and approve; success message | "Round two. The gate attacks again: no approval, a fake order, someone else's order, a declined payment through PayPal's negative testing. Then a real sandbox payment." |
| 2:20–2:40 | Report: green READY, "PayPal recorded 120.00", "Sandbox payment COMPLETED", history: BLOCKED → AGENT FIX → READY | "PayPal's record says COMPLETED at the server price, a retry didn't charge twice, and only then the booking became paid. READY." |
| 2:40–2:52 | `npm run gate:publish`, then the site's `/gate` page and the "Checkout verified" badge in the header | "The result is published with the site, so the founder, their client and their buyers can see what was proven. The same checks run on every pull request." |
| 2:52–2:58 | Title card: Shepherdy Checkout Gate · github link | "The agent fixes. PayPal proves. The gate decides." |

Tips
- Record the loop in one take and cut the waiting time in editing.
- Say on screen which fix mode ran: the live Claude fix agent, or `LLM_MODE=fake` (restores the last READY files).
- If the automatic sandbox login is blocked, `--manual` lets you approve in the popup (that is what the script shows).
- Keep it under 3:00; upload to YouTube as Public and paste the link into Devpost.
