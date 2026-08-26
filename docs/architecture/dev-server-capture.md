# Terminal development server capture

Voktty can discover loopback development servers announced by a command in an
interactive terminal and open them in the integrated preview. Detection is a
presentation aid. It never executes terminal text and never opens the system
browser automatically.

## Ownership and lifecycle

`useTerminalSession` owns the association between PTY output and the shell
command that produced it. OSC 133 command markers begin and end a capture
generation for one terminal leaf. Block terminals use the same lifecycle when
their mode changes. PTY exit, respawn and leaf disposal clear the generation.

The capture store records only bounded metadata:

- terminal leaf and native PTY id;
- command generation;
- workspace scope and command cwd;
- normalized loopback origin;
- detection timestamp.

No terminal transcript is retained. A command ending removes its active
captures. Separate leaves and separate origins remain independent, so several
development servers can run at once.

## Detection and security

The detector accepts HTTP and HTTPS origins on `localhost`, `.localhost`,
IPv4 loopback, IPv6 loopback and wildcard bind addresses. Wildcard bind
addresses are rewritten to `localhost`. It rejects external hosts, credentials,
invalid ports and unsupported schemes. Query strings, fragments and paths are
discarded, which prevents tokens printed by local tools from entering session
state.

PTY chunks are decoded and passed to the detector only after xterm has parsed
the same bytes. This ordering lets an OSC 133 command-start marker and the first
server output share one PTY chunk without losing lifecycle ownership. ANSI
escapes are removed and a bounded tail joins URLs split across chunks.

## Preview linking

While the command is active, the status bar shows the server origins detected
for the focused terminal. Selecting one opens an integrated preview or focuses
the preview already linked to that workspace, cwd and origin. The link is part
of the serializable preview tab, so a restored workspace remembers the user's
choice. A later command announcing the same linked origin updates that preview
without creating a duplicate tab.

The preview keeps its existing iframe sandbox. Capture never calls the external
URL opener and never bypasses normal tab or workspace ownership.

## Current limits

- A remote SSH process that prints `localhost` still refers to the remote host.
  The capture is shown with its workspace association, but access requires an
  SSH tunnel that exposes the port locally.
- Only shell integrations that expose command lifecycle, plus block terminals,
  enable capture. Raw output outside an active command is ignored.
- Captured paths are intentionally reduced to the server origin. Users can
  navigate to a deeper path from the preview address bar.
