# Desktop Node Read

## Local Desktop Entry

The collaboration page now has a local mailbox setup command after operator
sign-in. It creates a reader service credential once per installation, stores it
under runtime/t3-desktop/mail-secrets with Windows ACL access limited to the
current user, SYSTEM and Administrators, and writes workbench-mail.json using
relative paths. The token never returns to the renderer. Repeating setup verifies
and reuses the saved token; it does not create another account per project.
Reopen the application after first setup so the existing server registration
loads the configuration. No running tasks are restarted automatically. Initial
database/bootstrap setup for a fresh machine is still separate unfinished work.

Run `C:\Users\zheng\project-workbench\launch-vacpms.bat`, then use T3's
workbench entry. This runs the built source desktop, not the installed T3 app.
The desktop component location comes from desktop-runtime.json, not a directory
name embedded in the launcher. The current source manifest points at the existing
sibling checkout; a distribution can supply its own relative component layout.
This manifest belongs to packaging, not a list of paths end users should enter.
Docker must be running; no Vite or separate SpecGraph HTTP server is needed for
the connected IPC operations. Do not run the old stack launcher for this entry.

The launcher reuses T3's Electron resolver and normal backend lifecycle. It keeps
an existing runtime/t3-desktop/workbench-mail.json discoverable automatically,
so an initialized installation does not need a manually set mail environment
variable. An explicit existing override remains respected. Missing settings do
not trigger account creation or import old test enrollment records.
It keeps
its profile at `project-workbench/runtime/t3-desktop`, separate from installed T3;
Electron userData is explicitly set to its electron-user-data subdirectory through
the shared T3 user-data resolver, before the authentication bridge and instance
lock initialize. T3CODE_HOME alone does not isolate Electron data. APPDATA is not
overridden, so provider CLIs retain their usual account configuration locations.
existing T3 chats/settings are not copied, so provider setup may be needed there.
The configured SpecGraph database is unchanged. Per-launch temporary files stay
in an owned `run-*` directory under that profile and are removed after Electron
exits; persistent profile data is retained. Closing the launcher forcibly can
interrupt that cleanup, so exit through the desktop normally.

`node --test extensions/workbench-desktop/launch.test.mjs` checks launch settings
and cleanup without starting another desktop. The actual built desktop IPC path
was separately exercised against the existing database. This is a local source
build entry, not a portable installer or automatic upstream update integration.

This external module owns bounded local stdio operations, not a general transport:
projects, current-view, spec detail, and authorized mail inspection. The T3 desktop IPC handler accepts only
these resource names and project/node identity from its main
window. Executable/config paths come from trusted host configuration, never from
renderer input. The launcher supplies VACPMS_HOME from its own location, without
user configuration. The host reads desktop-runtime.json there and resolves
executable/config relative to that directory; absolute paths also work. Legacy
direct T3 launches without this variable still use ~/project-workbench.
The current file selects the candidate binary, not a replaced installed app.
This is not a finished installation workflow.

Each read launches the configured `workbench-stdio` child with hidden windows,
sends one request, closes stdin, and waits for child exit. It creates no listener,
daemon, logs or temporary files. The Go read command reuses SpecGraph storage with
read-only PostgreSQL sessions, without migrations or project creation. Other
T3/workbench operations still use their existing transports.

The workbench page uses this desktop bridge for its actual project list,
overview/graph, and node details when the bridge is present. IPC failures do not
fall back to HTTP. HTTP and stdio reuse the same Go projections. The current
base read connection stays read-only. A separate `workbench-command-stdio` entry
supports UI-submitted node creation, execution approval with rationale, dependency
add/remove, manual completion, and the existing run preparation/binding/dispatch operations,
using existing business validation and operation-specific Cedar permissions.
It opens the existing database without migrations. Agent mail send (including
multiple recipients, reply and forward), read/ack and close use their own bound
identity through the same local command entry; the supervision panel does not
impersonate those actions. Mail inspection reuses
the existing SpecGraph API-key/session validation and workbench.manage policy.
The operator credential travels only through the owned local pipes; after sign-in
it stays in desktop-main memory until sign-out/app exit, never on disk or in
subsequent renderer requests. Each mail request is verified again, and inspection
does not change read/acknowledgment or last-used statistics. OIDC login is not
provided by this local inspection entry; existing HTTP login is unchanged.
Desktop/web typechecks passed. One real Node-to-Go-to-isolated-PostgreSQL check
passed for all three reads and observed child exit. Existing read/page checks
were reused; no new test framework was added. The installed app was
not changed or launched. Packaged desktop startup and full transport migration
remain unverified. A no-output build using the existing desktop pack configuration
completed, with existing dependency warnings for optional `x11` resolution and
Effect `import.meta` in CJS; this does not prove packaged runtime correctness.
No browser/UX acceptance was performed.

2026-09-22: actual web, server (including static client), and desktop bundles now
exist in the source checkout's standard output directories. Both workbench IPC
channels, the stdio command and configuration path are present in the desktop
artifacts; the client includes the workbench route. Startup remains unverified.
The host's scripts/lib/third-party-licenses.ts classifies exactly the two local
packages @project-workbench/ui and @project-workbench/mail as first party while
still collecting their third-party dependencies. One focused regression passed;
the built notices retain React Flow and Dagre. This additional host adaptation
must be preserved alongside the IPC hooks during upstream updates. The refreshed
t3-workbench-host.patch includes dedicated desktop IPC and web adapter files.
Shared host edits are listed in the UI package README and must still be merged;
the snapshot is not an automatic installer.

An actual Electron 44.4.2 launch was subsequently checked using installed
Playwright 1.60.0 Electron APIs (launch, firstWindow, evaluate, close). With an
isolated T3CODE_HOME and no Vite URL, the real main-window bridge read one project,
six specs and an existing spec detail through IPC. No business write was submitted.
The child process handle was captured before close; exit code was zero and the
isolated project-local data directory was removed. This verifies source-build
startup and the read path, not an installer, visual acceptance or all operations.
The existing launch-t3-workbench.bat still selects the older Vite-based workflow.
