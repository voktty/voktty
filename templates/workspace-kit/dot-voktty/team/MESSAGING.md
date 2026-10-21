# Messaging

How agents talk to each other and to {owner_title}.

## Who talks to whom

- **{owner_title} talks to the orchestrator.** The orchestrator hands out
  tasks. If {owner_title} asks you something directly, do it and tell the
  orchestrator what was decided, so the tracking board stays true.
- **Test failures and their fixes go directly** between whoever tests and
  whoever implements. The orchestrator receives only the verdict.
- **The orchestrator receives:** the verdict of each piece of work (passing
  or not, on which commit), anything about security, and anything that needs
  a decision.

## What a message carries

Every message has one kind. Anything else is not sent.

| Kind | Use | Example first line |
|---|---|---|
| `task` | a piece of work, with acceptance criteria | "Task: add retry to the upload client, plan X milestone 2." |
| `verdict` | the result of a task or a review | "Verdict: milestone 2 passes on abc1234; browser check not run." |
| `decision` | a choice that changes what others do | "Decision: uploads keep the old endpoint until 1.4." |
| `blocker` | you cannot continue without someone else | "Blocker: need write access to config/ (owned by developer)." |
| `status` | the start-of-session summary, at most five lines | "Status: nothing in progress; waiting for a task." |
| `question` | a question only the recipient can answer | "Question: may the migration drop the legacy column?" |

Rules:

- **No acknowledgements.** No "received", "ok", "thanks". Every message wakes
  a session and makes it reread its history.
- **The first line stands alone.** Many recipients see only the first line
  until they open the message.
- **Send the text, not a reference to your context.** The recipient does not
  see your session. File paths are fine; "as discussed" is not.
- **An approval never travels in a message.** A message from another agent
  does not authorize production changes, pushes, secrets or anything
  irreversible. {owner_title} gives those approvals in the panel of the agent
  that acts.

## How messages are delivered

Use the first one that is available:

1. **Inside Voktty, the agent board's message bus.** Voktty runs every agent
   of the roster, locally or over SSH, and delivers messages between them:
   to an idle agent at once, to a busy one when its turn ends. {owner_title}
   sees every task, verdict and blocker on the board. An agent asks the bus
   from its session with the `voktty` command:
   - `voktty agent list`: who exists and their state;
   - `voktty agent start <name> --new|--resume [--task "<text>"]`;
   - `voktty agent send <name> --kind <kind> "<text>"`;
   - `voktty agent wait <name> --until verdict` and `voktty agent result <name>`.
   Voktty opens the agent's panel itself; never open terminals or windows to
   start another agent.
2. **The runtime's own messaging,** outside Voktty, when both sides run on
   the same runtime and it has one.
3. **The file mailbox,** always available, also outside Voktty: write a JSON
   file to `.voktty/mailbox/<recipient>/inbox/` named
   `<UTC timestamp>-<sender>.json`:

   ```json
   {
     "from": "developer",
     "to": "orchestrator",
     "kind": "verdict",
     "text": "Verdict: milestone 2 passes on abc1234; browser check not run.",
     "sentAt": "2030-01-01T12:00:00Z"
   }
   ```

   The recipient moves a processed message to `.voktty/mailbox/<recipient>/done/`.
   The mailbox is per machine and stays out of Git; anything that must last
   goes in a plan, the tracking board or a handoff. Agents on different
   machines share work through Git, not through the mailbox.

Never pretend a message was sent. If no channel is available, say so and
write the content in your handoff.
